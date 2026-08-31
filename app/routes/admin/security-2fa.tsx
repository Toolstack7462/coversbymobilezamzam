import { Form, Link, useLocation } from "react-router";
import type { Route } from "./+types/security-2fa";
import { cloudflareContext } from "../../../workers/app";
import { createAuth } from "~/infrastructure/auth/auth.server";
import {
  requireStaff,
  requiresTwoFactor,
  hasVerifiedTwoFactor,
  hasStepUp,
} from "~/infrastructure/auth/session.server";
import { systemClock, cryptoIds } from "~/infrastructure/primitives";

/**
 * Two-factor status, enrolment entry point, and disable.
 *
 * Reachable by a privileged account that has NOT yet enrolled — it is on the
 * pre-enrolment allowlist, because a page that requires enrolment in order to
 * enrol would be a locked door with the key inside.
 */

export function meta() {
  return [
    { title: "Autenticazione a due fattori" },
    { name: "robots", content: "noindex, nofollow" },
  ];
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const { env } = context.get(cloudflareContext);
  const actor = await requireStaff(request, env);

  const enrolled = await hasVerifiedTwoFactor(env, actor.userId);

  const remaining = await env.DB.prepare(
    `SELECT backup_codes FROM two_factor WHERE user_id = ?1 AND verified = 1`,
  )
    .bind(actor.userId)
    .first<{ backup_codes: string | null }>();

  return {
    enrolled,
    mandatory: requiresTwoFactor(actor),
    displayName: actor.displayName,
    // The codes are encrypted by Better Auth; only whether SOME exist is shown.
    // The values themselves are displayed exactly once, at generation.
    hasBackupCodes: Boolean(remaining?.backup_codes),
  };
}

export async function action({ request, context }: Route.ActionArgs) {
  const { env } = context.get(cloudflareContext);
  const actor = await requireStaff(request, env);
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");
  const now = systemClock.now();

  if (intent !== "disable") return { error: "Azione non riconosciuta." };

  /**
   * Disabling requires the password, a current TOTP code, AND a fresh step-up.
   *
   * Turning off the second factor is exactly as sensitive as changing where
   * money goes, so it is gated the same way. A stolen session alone must not be
   * enough to remove the protection that stops a stolen session mattering.
   */
  if (!(await hasStepUp(env, actor.userId, "payment.settings", now))) {
    return {
      error:
        "Serve una conferma recente della tua identità. Vai in Impostazioni e conferma la password, poi riprova.",
    };
  }

  if (requiresTwoFactor(actor)) {
    // The role obliges enrolment, so disabling would leave the account in a
    // state the system forbids. Refuse rather than allow a privileged account
    // to sit unprotected.
    return {
      error:
        "Il tuo ruolo richiede l'autenticazione a due fattori. Per disattivarla, un amministratore deve prima rimuovere i permessi privilegiati.",
    };
  }

  const password = String(form.get("password") ?? "");
  const auth = createAuth(env);

  try {
    await auth.api.disableTwoFactor({
      body: { password },
      headers: request.headers,
    });
  } catch {
    return { error: "Password non corretta, oppure disattivazione non riuscita." };
  }

  // Every other session is revoked: if 2FA is being removed, any session that
  // was established under it should have to prove itself again.
  await env.DB.batch([
    env.DB.prepare(`DELETE FROM session WHERE user_id = ?1`).bind(actor.userId),
    env.DB.prepare(
      `INSERT INTO audit_logs
         (id, actor_id, actor_label, action, entity_type, entity_id, after_value, created_at)
       VALUES (?1,?2,?3,'auth.2fa_disabled','user',?2,?4,?5)`,
    ).bind(
      cryptoIds.generate(),
      actor.userId,
      actor.displayName,
      JSON.stringify({ sessionsRevoked: true }),
      now,
    ),
  ]);

  return {
    success: "Autenticazione a due fattori disattivata. Tutte le sessioni sono state chiuse.",
  };
}

export default function SecurityTwoFactor({ loaderData, actionData }: Route.ComponentProps) {
  const { search } = useLocation();
  const { enrolled, mandatory, hasBackupCodes } = loaderData;
  const forced = new URLSearchParams(search).get("obbligatorio") === "1";

  return (
    <div className="stack" style={{ maxWidth: "42rem" }}>
      <h1>Autenticazione a due fattori</h1>

      {forced && !enrolled ? (
        <p className="notice notice--warning" role="alert">
          Il tuo ruolo richiede l&apos;autenticazione a due fattori. Fino a quando non la attivi
          puoi solo configurarla o uscire: le altre sezioni dell&apos;amministrazione non sono
          accessibili.
        </p>
      ) : null}

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

      <section className="panel stack">
        <h2>Stato</h2>
        <p>
          {enrolled ? (
            <span className="stock--in_stock">Attiva e verificata</span>
          ) : (
            <span className="stock--low_stock">Non attiva</span>
          )}
          {mandatory ? (
            <span className="badge badge--warning"> obbligatoria per il tuo ruolo</span>
          ) : null}
        </p>

        {mandatory ? (
          <p className="small muted">
            È obbligatoria perché il tuo account può verificare pagamenti, modificare i dati di
            incasso o gestire il personale. Una password sola non basta per queste operazioni.
          </p>
        ) : null}

        {!enrolled ? (
          <p>
            <Link className="btn btn--primary" to="/admin/sicurezza/2fa/configura">
              Attiva ora
            </Link>
          </p>
        ) : (
          <div className="stack">
            <p className="small">
              Codici di recupero:{" "}
              {hasBackupCodes ? "generati" : <strong>non ancora generati</strong>}
            </p>
            <p className="cluster">
              <Link className="btn btn--secondary" to="/admin/sicurezza/codici-recupero">
                Codici di recupero
              </Link>
              <Link className="btn btn--secondary" to="/admin/sicurezza/sessioni">
                Sessioni attive
              </Link>
            </p>
          </div>
        )}
      </section>

      {enrolled && !mandatory ? (
        <section className="panel stack">
          <h2>Disattiva</h2>
          <p className="small muted">
            Richiede la password e una conferma recente dell&apos;identità. Tutte le altre sessioni
            verranno chiuse.
          </p>
          <Form method="post" className="stack">
            <input type="hidden" name="intent" value="disable" />
            <div className="field">
              <label className="field__label" htmlFor="password">
                Password
              </label>
              <input
                id="password"
                name="password"
                type="password"
                className="input"
                required
                autoComplete="current-password"
              />
            </div>
            <button type="submit" className="btn btn--secondary">
              Disattiva 2FA
            </button>
          </Form>
        </section>
      ) : null}
    </div>
  );
}
