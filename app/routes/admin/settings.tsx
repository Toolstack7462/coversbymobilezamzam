import { Form } from "react-router";
import type { Route } from "./+types/settings";
import { cloudflareContext } from "../../../workers/app";
import {
  requireStaff,
  getSession,
  grantStepUp,
  hasStepUp,
  consumeStepUp,
} from "~/infrastructure/auth/session.server";
import { createAuth } from "~/infrastructure/auth/auth.server";
import {
  systemClock,
  cryptoIds,
  aesGcmEncryptor,
  maskIdentifier,
} from "~/infrastructure/primitives";
import { gateStatuses, type SettingsMap } from "~/domain/content/gates";
import { SETTING_GROUPS, uncoveredKeys, type SettingField } from "~/lib/setting-fields";
import { breadcrumbsFor } from "~/lib/admin-nav";
import { PageHeader } from "~/components/admin/admin-shell";

/**
 * Merchant settings, and payment-method configuration.
 *
 * Two very different levels of risk share this screen, and they are treated
 * differently:
 *
 *   - Ordinary settings (shop name, hours, phone) need `settings.write`.
 *   - **Payment identifiers need `payment.settings` AND step-up**, because an
 *     attacker who quietly changes the IBAN redirects every future payment.
 *     That is the highest-value target in the application.
 */

/**
 * Grouping and labelling now come from `~/lib/setting-fields`, which describes
 * each setting in the merchant's words. This screen previously grouped by the
 * dotted key prefix and labelled every field with the key itself — a shopkeeper
 * was shown a form field called `business.vat_number`.
 */

export function meta() {
  return [{ title: "Impostazioni" }, { name: "robots", content: "noindex, nofollow" }];
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const { env } = context.get(cloudflareContext);
  const actor = await requireStaff(request, env, "settings.read");
  const now = systemClock.now();

  const [settingsResult, methods] = await Promise.all([
    env.DB.prepare(
      `SELECT key, value, category, gates_feature, description_it
         FROM store_settings ORDER BY category, key`,
    ).all<{
      key: string;
      value: string;
      category: string;
      gates_feature: number;
      description_it: string | null;
    }>(),
    env.DB.prepare(
      `SELECT id, code, name_it, active, beneficiary_name, account_identifier_masked,
              reservation_minutes, instructions_it
         FROM payment_methods WHERE archived_at IS NULL ORDER BY sort_order`,
    ).all<{
      id: string;
      code: string;
      name_it: string;
      active: number;
      beneficiary_name: string | null;
      account_identifier_masked: string | null;
      reservation_minutes: number;
      instructions_it: string | null;
    }>(),
  ]);

  const map: SettingsMap = Object.fromEntries(settingsResult.results.map((r) => [r.key, r.value]));

  return {
    settings: settingsResult.results,
    methods: methods.results,
    gates: gateStatuses(map),
    canWrite: actor.permissions.includes("settings.write"),
    canWritePayments: actor.permissions.includes("payment.settings"),
    paymentStepUp: actor.permissions.includes("payment.settings")
      ? await hasStepUp(env, actor.userId, "payment.settings", now)
      : false,
  };
}

export async function action({ request, context }: Route.ActionArgs) {
  const { env } = context.get(cloudflareContext);
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");
  const now = systemClock.now();

  // ── Step-up for payment configuration ────────────────────────────────────
  if (intent === "payment-step-up") {
    const actor = await requireStaff(request, env, "payment.settings");
    const password = String(form.get("password") ?? "");
    const auth = createAuth(env);
    try {
      const response = await auth.api.signInEmail({
        body: { email: actor.email, password },
        headers: request.headers,
        asResponse: true,
      });
      if (!response.ok) return { error: "Password non corretta." };
    } catch {
      return { error: "Password non corretta." };
    }
    const session = await getSession(request, env);
    await grantStepUp(
      env,
      actor.userId,
      session?.session?.id ?? "unknown",
      "payment.settings",
      now,
      cryptoIds.generate(),
    );
    return { success: "Identità confermata." };
  }

  // ── Ordinary settings ────────────────────────────────────────────────────
  if (intent === "save-settings") {
    const actor = await requireStaff(request, env, "settings.write");
    const statements: D1PreparedStatement[] = [];

    /*
     * Collect the submitted values FIRST, last-wins.
     *
     * Two reasons, both of which were bugs in the previous version of this
     * loop:
     *
     * 1. An unchecked checkbox submits NOTHING. Reading the form directly meant
     *    a merchant could switch pickup on but never off — the absent field was
     *    read as "unchanged" rather than "false", and the setting silently kept
     *    its old value. Each boolean is now preceded by a hidden "false", so
     *    the pair always submits; last-wins collapses them correctly.
     *
     * 2. The old loop issued one SELECT per field inside the iteration, so
     *    saving this form meant roughly thirty sequential round trips to D1.
     *    The current values are now read in a single query.
     */
    const submitted = new Map<string, string>();
    for (const [field, raw] of form.entries()) {
      if (!field.startsWith("setting:")) continue;
      submitted.set(field.slice("setting:".length), String(raw).trim());
    }

    const currentRows = await env.DB.prepare(`SELECT key, value FROM store_settings`).all<{
      key: string;
      value: string;
    }>();
    const current = new Map(currentRows.results.map((row) => [row.key, row.value]));

    for (const [key, value] of submitted) {
      const existing = current.get(key);
      // An unknown key is ignored rather than inserted: settings are created by
      // migrations, so a key that is not there is a typo or a stale form, not a
      // new setting someone meant to add from a browser.
      if (existing === undefined || existing === value) continue;

      statements.push(
        env.DB.prepare(`UPDATE store_settings SET value = ?1, updated_at = ?2 WHERE key = ?3`).bind(
          value,
          now,
          key,
        ),
        env.DB.prepare(
          `INSERT INTO audit_logs
             (id, actor_id, actor_label, action, entity_type, entity_id, before_value, after_value, created_at)
           VALUES (?1,?2,?3,'settings.update','store_setting',?4,?5,?6,?7)`,
        ).bind(
          cryptoIds.generate(),
          actor.userId,
          actor.displayName,
          key,
          JSON.stringify({ value: existing }),
          JSON.stringify({ value }),
          now,
        ),
      );
    }

    if (statements.length > 0) await env.DB.batch(statements);
    return { success: `Impostazioni aggiornate (${statements.length / 2}).` };
  }

  // ── Payment method configuration ─────────────────────────────────────────
  if (intent === "save-payment-method") {
    const actor = await requireStaff(request, env, "payment.settings");

    // CONSUME, do not merely check: two concurrent edits cannot share one
    // step-up.
    if (!(await consumeStepUp(env, actor.userId, "payment.settings", now))) {
      return { error: "Autenticazione aggiuntiva richiesta o scaduta." };
    }

    const id = String(form.get("methodId") ?? "");
    const beneficiary = String(form.get("beneficiaryName") ?? "").trim();
    const identifier = String(form.get("accountIdentifier") ?? "").trim();
    const instructions = String(form.get("instructions") ?? "").trim();
    const active = form.get("active") === "on";

    const before = await env.DB.prepare(
      `SELECT code, active, beneficiary_name, account_identifier_masked
         FROM payment_methods WHERE id = ?1`,
    )
      .bind(id)
      .first<{
        code: string;
        active: number;
        beneficiary_name: string | null;
        account_identifier_masked: string | null;
      }>();
    if (!before) return { error: "Metodo non trovato." };

    // A method cannot be switched on without somewhere for the money to go.
    if (
      active &&
      before.code !== "pay_at_pickup" &&
      !identifier &&
      !before.account_identifier_masked
    ) {
      return { error: "Non puoi attivare un metodo senza un identificativo di pagamento." };
    }

    const statements: D1PreparedStatement[] = [];

    if (identifier) {
      const encryptor = aesGcmEncryptor(env.SETTINGS_ENCRYPTION_KEY);
      const encrypted = await encryptor.encrypt(identifier);
      const masked = maskIdentifier(identifier);

      statements.push(
        env.DB.prepare(
          `UPDATE payment_methods
              SET account_identifier_encrypted = ?1, account_identifier_masked = ?2,
                  beneficiary_name = ?3, instructions_it = ?4, active = ?5, updated_at = ?6
            WHERE id = ?7`,
        ).bind(
          encrypted,
          masked,
          beneficiary || null,
          instructions || null,
          active ? 1 : 0,
          now,
          id,
        ),
      );
    } else {
      statements.push(
        env.DB.prepare(
          `UPDATE payment_methods
              SET beneficiary_name = ?1, instructions_it = ?2, active = ?3, updated_at = ?4
            WHERE id = ?5`,
        ).bind(beneficiary || null, instructions || null, active ? 1 : 0, now, id),
      );
    }

    // Audited with MASKED values only. A full IBAN in the audit table is the
    // same disclosure as logging it.
    statements.push(
      env.DB.prepare(
        `INSERT INTO audit_logs
           (id, actor_id, actor_label, action, entity_type, entity_id, before_value, after_value, created_at)
         VALUES (?1,?2,?3,'payment.settings.update','payment_method',?4,?5,?6,?7)`,
      ).bind(
        cryptoIds.generate(),
        actor.userId,
        actor.displayName,
        id,
        JSON.stringify({
          active: before.active === 1,
          beneficiary: before.beneficiary_name,
          identifier: before.account_identifier_masked,
        }),
        JSON.stringify({
          active,
          beneficiary: beneficiary || null,
          identifier: identifier ? maskIdentifier(identifier) : before.account_identifier_masked,
          identifierChanged: Boolean(identifier),
        }),
        now,
      ),
    );

    await env.DB.batch(statements);
    return { success: "Metodo di pagamento aggiornato." };
  }

  return { error: "Azione non riconosciuta." };
}

export default function AdminSettings({ loaderData, actionData }: Route.ComponentProps) {
  const { settings, methods, gates, canWrite, canWritePayments, paymentStepUp } = loaderData;

  const valueOf = new Map(settings.map((setting) => [setting.key, setting.value]));

  // Anything a migration added but `setting-fields.ts` does not describe still
  // has to be editable: a value the merchant can see gating a feature, with no
  // way to set it, is worse than an ugly label.
  const undescribed = uncoveredKeys(settings.map((setting) => setting.key));

  return (
    <>
      <PageHeader
        title="Impostazioni"
        description="I dati del negozio. Un campo vuoto nasconde una funzione: non produce mai un segnaposto."
        breadcrumbs={breadcrumbsFor("/admin/impostazioni")}
      />

      {actionData && "error" in actionData && actionData.error ? (
        <p className="notice notice--danger" role="alert">
          {actionData.error}
        </p>
      ) : null}
      {actionData && "success" in actionData && actionData.success ? (
        <p className="notice notice--info" role="status">
          {actionData.success}
        </p>
      ) : null}

      <Form method="post" className="stack">
        <input type="hidden" name="intent" value="save-settings" />

        {SETTING_GROUPS.map((group) => (
          <fieldset key={group.slug} className="panel stack">
            <legend>
              <h2>{group.title}</h2>
            </legend>
            <p className="small muted">{group.blurb}</p>

            {group.fields.map((field) => (
              <SettingInput
                key={field.key}
                field={field}
                value={valueOf.get(field.key) ?? ""}
                disabled={!canWrite}
              />
            ))}
          </fieldset>
        ))}

        {undescribed.length > 0 ? (
          <fieldset className="panel stack">
            <legend>
              <h2>Altre impostazioni</h2>
            </legend>
            <p className="small muted">
              Impostazioni tecniche senza una descrizione. Modificatele solo se sapete a cosa
              servono.
            </p>
            {undescribed.map((key) => (
              <div className="field" key={key}>
                <label className="field__label" htmlFor={key}>
                  <code>{key}</code>
                </label>
                <input
                  id={key}
                  name={`setting:${key}`}
                  className="input"
                  defaultValue={valueOf.get(key) ?? ""}
                  disabled={!canWrite}
                />
              </div>
            ))}
          </fieldset>
        ) : null}

        {canWrite ? (
          <button type="submit" className="btn btn--primary">
            Salva impostazioni
          </button>
        ) : (
          <p className="small muted">
            Serve il permesso <code>settings.write</code> per modificare.
          </p>
        )}
      </Form>

      <section className="stack">
        <h2>Metodi di pagamento</h2>
        <p className="notice notice--warning small">
          L&apos;IBAN è il dato più sensibile del sistema: chi lo modifica dirotta tutti i pagamenti
          futuri. Viene cifrato, non compare mai nei log e ogni modifica è registrata.
          <br />
          Usa <strong>sempre</strong> un conto aziendale, mai un conto personale.
        </p>

        {!canWritePayments ? (
          <p className="small muted">
            Serve il permesso <code>payment.settings</code>.
          </p>
        ) : !paymentStepUp ? (
          <Form method="post" className="panel cluster">
            <input type="hidden" name="intent" value="payment-step-up" />
            <div className="field">
              <label className="field__label" htmlFor="pay-stepup">
                Conferma la password per modificare i dati di pagamento
              </label>
              <input
                id="pay-stepup"
                name="password"
                type="password"
                className="input"
                required
                autoComplete="current-password"
              />
            </div>
            <button type="submit" className="btn btn--primary">
              Conferma
            </button>
          </Form>
        ) : null}

        {methods.map((method) => (
          <details key={method.id} className="panel">
            <summary>
              <strong>{method.name_it}</strong>{" "}
              <span className={method.active === 1 ? "badge" : "badge badge--muted"}>
                {method.active === 1 ? "attivo" : "disattivato"}
              </span>{" "}
              {method.account_identifier_masked ? (
                <span className="numeric small muted">{method.account_identifier_masked}</span>
              ) : (
                <span className="small muted">nessun identificativo</span>
              )}
            </summary>

            <Form method="post" className="stack">
              <input type="hidden" name="intent" value="save-payment-method" />
              <input type="hidden" name="methodId" value={method.id} />

              <div className="field">
                <label className="field__label" htmlFor={`ben-${method.id}`}>
                  Beneficiario
                </label>
                <input
                  id={`ben-${method.id}`}
                  name="beneficiaryName"
                  className="input"
                  defaultValue={method.beneficiary_name ?? ""}
                  disabled={!canWritePayments || !paymentStepUp}
                />
              </div>

              <div className="field">
                <label className="field__label" htmlFor={`iban-${method.id}`}>
                  IBAN / identificativo
                </label>
                {/* Never pre-filled with the real value: the decrypted
                    identifier does not belong in an ordinary page render. */}
                <input
                  id={`iban-${method.id}`}
                  name="accountIdentifier"
                  className="input numeric"
                  placeholder={method.account_identifier_masked ?? "non configurato"}
                  disabled={!canWritePayments || !paymentStepUp}
                  autoComplete="off"
                />
                <span className="field__hint">
                  Lascia vuoto per non modificarlo. Il valore attuale non viene mai mostrato per
                  intero.
                </span>
              </div>

              <div className="field">
                <label className="field__label" htmlFor={`instr-${method.id}`}>
                  Istruzioni per il cliente
                </label>
                <textarea
                  id={`instr-${method.id}`}
                  name="instructions"
                  className="input"
                  rows={3}
                  defaultValue={method.instructions_it ?? ""}
                  disabled={!canWritePayments || !paymentStepUp}
                />
              </div>

              <label className="cluster">
                <input
                  type="checkbox"
                  name="active"
                  defaultChecked={method.active === 1}
                  disabled={!canWritePayments || !paymentStepUp}
                />
                <span>Attivo (mostrato al cliente in cassa)</span>
              </label>

              <button
                type="submit"
                className="btn btn--primary"
                disabled={!canWritePayments || !paymentStepUp}
              >
                Salva metodo
              </button>
            </Form>
          </details>
        ))}
      </section>

      <section className="stack">
        <h2>Stato delle funzioni</h2>
        <ul className="small stack">
          {gates.map((gate) => (
            <li key={gate.feature}>
              {gate.enabled ? "ATTIVA" : "NASCOSTA"} — <strong>{gate.feature}</strong>
              {gate.missingKeys.length > 0 ? (
                <>
                  {" "}
                  (mancano <code>{gate.missingKeys.join(", ")}</code>)
                </>
              ) : null}
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}

/**
 * One setting.
 *
 * Three deliberate choices, each of which is the opposite of what a form
 * builder would do by default:
 *
 *   - The help text is always visible, never a tooltip or a placeholder.
 *     Placeholder-as-label disappears the moment someone types, which is
 *     exactly when they were about to check what the field wanted.
 *   - `example` is rendered as a placeholder and never as a value, so nothing
 *     can be saved by accident. It reads as a format, not as data.
 *   - The consequence of leaving it blank is stated on the field itself. The
 *     storefront hides features rather than printing placeholders, so a blank
 *     field silently removes something; saying which turns an invisible
 *     behaviour into an informed choice.
 */
function SettingInput({
  field,
  value,
  disabled,
}: {
  field: SettingField;
  value: string;
  disabled: boolean;
}) {
  const id = `setting-${field.key}`;
  const describedBy = `${id}-help`;
  const filled = value.trim() !== "";

  if (field.type === "boolean") {
    return (
      <div className="field">
        {/*
          A hidden "false" before the checkbox, sharing its name. An unchecked
          box submits nothing at all, so without this the setting could be
          turned on and never off — and the failure is silent, which is the
          worst way for a save to fail.
        */}
        <input type="hidden" name={`setting:${field.key}`} value="false" />
        <label className="field__checkbox" htmlFor={id}>
          <input
            id={id}
            type="checkbox"
            name={`setting:${field.key}`}
            value="true"
            defaultChecked={value === "true"}
            disabled={disabled}
            aria-describedby={describedBy}
          />
          <span>{field.label}</span>
        </label>
        <span className="field__hint" id={describedBy}>
          {field.help}
        </span>
      </div>
    );
  }

  return (
    <div className="field">
      <label className="field__label" htmlFor={id}>
        {field.label}
        {field.required ? (
          <span className="badge badge--warning" title="Serve prima di poter vendere">
            {" "}
            obbligatorio
          </span>
        ) : null}
      </label>

      {field.type === "textarea" ? (
        <textarea
          id={id}
          name={`setting:${field.key}`}
          className="input"
          rows={3}
          defaultValue={value}
          disabled={disabled}
          aria-describedby={describedBy}
          {...(field.example ? { placeholder: field.example } : {})}
        />
      ) : (
        <input
          id={id}
          name={`setting:${field.key}`}
          className="input"
          type={field.type}
          defaultValue={value}
          disabled={disabled}
          aria-describedby={describedBy}
          {...(field.example ? { placeholder: field.example } : {})}
        />
      )}

      <span className="field__hint" id={describedBy}>
        {field.help}
        {field.consequence && !filled ? (
          <>
            {" "}
            <strong>Ora è vuoto:</strong> {field.consequence}
          </>
        ) : null}
      </span>
    </div>
  );
}
