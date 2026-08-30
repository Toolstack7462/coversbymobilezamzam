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

const CATEGORY_LABELS: Record<string, string> = {
  business: "Dati aziendali",
  store: "Negozio",
  contact: "Contatti",
  fulfilment: "Consegna e ritiro",
  tax: "Fiscale",
};

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

    for (const [field, raw] of form.entries()) {
      if (!field.startsWith("setting:")) continue;
      const key = field.slice("setting:".length);
      const value = String(raw).trim();

      const existing = await env.DB.prepare(`SELECT value FROM store_settings WHERE key = ?1`)
        .bind(key)
        .first<{ value: string }>();
      if (!existing || existing.value === value) continue;

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
          JSON.stringify({ value: existing.value }),
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

  const byCategory = settings.reduce<Record<string, typeof settings>>((acc, setting) => {
    (acc[setting.category] ??= []).push(setting);
    return acc;
  }, {});

  return (
    <div className="stack">
      <h1>Impostazioni</h1>

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

      <p className="notice notice--info small">
        Un campo lasciato vuoto <strong>non</strong> viene mostrato sul sito con un segnaposto: la
        funzione che dipende da quel campo resta semplicemente nascosta.
      </p>

      <Form method="post" className="stack">
        <input type="hidden" name="intent" value="save-settings" />

        {Object.entries(byCategory).map(([category, items]) => (
          <fieldset key={category} className="panel stack">
            <legend>
              <h2>{CATEGORY_LABELS[category] ?? category}</h2>
            </legend>
            {items.map((setting) => (
              <div className="field" key={setting.key}>
                <label className="field__label" htmlFor={setting.key}>
                  {setting.key}
                  {setting.gates_feature === 1 ? (
                    <span className="badge"> nasconde una funzione se vuoto</span>
                  ) : null}
                </label>
                <input
                  id={setting.key}
                  name={`setting:${setting.key}`}
                  className="input"
                  defaultValue={setting.value}
                  disabled={!canWrite}
                />
                {setting.description_it ? (
                  <span className="field__hint">{setting.description_it}</span>
                ) : null}
              </div>
            ))}
          </fieldset>
        ))}

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
    </div>
  );
}
