import { Form, Link, useLocation } from "react-router";
import type { Route } from "./+types/security-backup-codes";
import { cloudflareContext } from "../../../workers/app";
import { createAuth } from "~/infrastructure/auth/auth.server";
import { requireStaff, hasVerifiedTwoFactor } from "~/infrastructure/auth/session.server";
import { systemClock, cryptoIds } from "~/infrastructure/primitives";

/**
 * Backup codes.
 *
 * Shown EXACTLY ONCE, at generation, and never again. Better Auth stores them
 * encrypted; this project never decrypts them for display, never writes them to
 * a log, and never sends them by email.
 *
 * Email recovery is deliberately absent. Until transactional email is genuinely
 * configured and its deliverability proven, an emailed recovery path is a
 * promise that fails at the worst moment — and a mailbox is a weaker factor
 * than the one it would be bypassing.
 */

export function meta() {
  return [{ title: "Codici di recupero" }, { name: "robots", content: "noindex, nofollow" }];
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const { env } = context.get(cloudflareContext);
  const actor = await requireStaff(request, env);

  const enrolled = await hasVerifiedTwoFactor(env, actor.userId);
  const row = await env.DB.prepare(`SELECT backup_codes FROM two_factor WHERE user_id = ?1`)
    .bind(actor.userId)
    .first<{ backup_codes: string | null }>();

  return { enrolled, hasCodes: Boolean(row?.backup_codes) };
}

export async function action({ request, context }: Route.ActionArgs) {
  const { env } = context.get(cloudflareContext);
  const actor = await requireStaff(request, env);
  const form = await request.formData();
  const now = systemClock.now();

  const password = String(form.get("password") ?? "");
  const auth = createAuth(env);

  /**
   * Regeneration requires the password.
   *
   * Anyone who can generate a fresh set can bypass the authenticator, so this
   * is as sensitive as the factor itself. Generating also INVALIDATES the
   * previous set — a code that was written on a card months ago must stop
   * working the moment a new card is printed.
   */
  let codes: string[];
  try {
    const result = await auth.api.generateBackupCodes({
      body: { password },
      headers: request.headers,
    });
    codes = (result as { backupCodes?: string[] })?.backupCodes ?? [];
  } catch {
    return { error: "Password non corretta." };
  }

  if (codes.length === 0) {
    return { error: "Generazione non riuscita. Riprova." };
  }

  await env.DB.prepare(
    `INSERT INTO audit_logs
       (id, actor_id, actor_label, action, entity_type, entity_id, after_value, created_at)
     VALUES (?1,?2,?3,'auth.backup_codes_generated','user',?2,?4,?5)`,
  )
    .bind(
      cryptoIds.generate(),
      actor.userId,
      actor.displayName,
      // The COUNT is auditable; the codes themselves are not recorded anywhere.
      JSON.stringify({ count: codes.length, previousInvalidated: true }),
      now,
    )
    .run();

  return { codes, error: null };
}

export default function BackupCodes({ loaderData, actionData }: Route.ComponentProps) {
  const { search } = useLocation();
  const justEnrolled = new URLSearchParams(search).get("nuovo") === "1";
  const { enrolled, hasCodes } = loaderData;
  const codes = actionData && "codes" in actionData ? actionData.codes : null;

  return (
    <div className="stack" style={{ maxWidth: "40rem" }}>
      <h1>Codici di recupero</h1>

      {justEnrolled && !codes ? (
        <p className="notice notice--info" role="status">
          Autenticazione a due fattori attivata. Genera ora i codici di recupero: ti servono se
          perdi il telefono.
        </p>
      ) : null}

      {actionData && "error" in actionData && actionData.error ? (
        <p className="notice notice--danger" role="alert">
          {actionData.error}
        </p>
      ) : null}

      {!enrolled ? (
        <p className="notice notice--warning">
          Attiva prima l&apos;autenticazione a due fattori.{" "}
          <Link to="/admin/sicurezza/2fa">Vai alla configurazione</Link>.
        </p>
      ) : null}

      {codes ? (
        <section className="panel stack">
          <h2>I tuoi codici</h2>
          <p className="notice notice--warning">
            <strong>Questi codici non verranno mostrati di nuovo.</strong> Salvali adesso in un
            posto sicuro — un gestore di password, o su carta lontano dal computer. Ogni codice
            funziona <strong>una volta sola</strong>.
          </p>

          <ol className="backup-codes numeric">
            {codes.map((code) => (
              <li key={code}>
                <code>{code}</code>
              </li>
            ))}
          </ol>

          {/*
            An acknowledgement, not a dismissal. Navigating away is possible,
            but the page does not pretend the codes are recoverable later.
          */}
          <Form method="get" action="/admin/sicurezza/2fa" className="stack">
            <label className="cluster">
              <input type="checkbox" name="saved" required />
              <span>Confermo di aver salvato i codici in un posto sicuro.</span>
            </label>
            <button type="submit" className="btn btn--primary">
              Ho salvato i codici
            </button>
          </Form>
        </section>
      ) : enrolled ? (
        <section className="panel stack">
          <h2>{hasCodes ? "Rigenera i codici" : "Genera i codici"}</h2>
          <p className="small muted">
            {hasCodes
              ? "Rigenerare ANNULLA immediatamente i codici precedenti. Fallo se pensi che siano stati visti da qualcun altro, o se li hai finiti."
              : "Servono per accedere se perdi il telefono. Vengono mostrati una volta sola."}
          </p>
          <Form method="post" className="stack">
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
            <button type="submit" className="btn btn--primary">
              {hasCodes ? "Rigenera codici" : "Genera codici"}
            </button>
          </Form>
        </section>
      ) : null}

      <p className="caption muted">
        Non esiste un recupero via email. Se perdi sia il telefono sia i codici, un altro
        amministratore deve reimpostare il tuo secondo fattore.
      </p>
    </div>
  );
}
