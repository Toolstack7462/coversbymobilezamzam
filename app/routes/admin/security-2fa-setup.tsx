import { Form, redirect } from "react-router";
import { renderSVG } from "uqr";
import type { Route } from "./+types/security-2fa-setup";
import { cloudflareContext } from "../../../workers/app";
import { createAuth } from "~/infrastructure/auth/auth.server";
import { requireStaff, hasVerifiedTwoFactor } from "~/infrastructure/auth/session.server";
import { systemClock, cryptoIds } from "~/infrastructure/primitives";

/**
 * TOTP enrolment.
 *
 * Two steps in one route, because the secret must not be persisted anywhere by
 * this application between them:
 *
 *   1. POST password  -> Better Auth generates the secret and returns the URI.
 *                        The QR is rendered from it in that same response.
 *   2. POST code      -> Better Auth verifies it. Only now does the factor
 *                        count (`skipVerificationOnEnable: false`).
 *
 * The URI and the secret are NEVER logged and never stored by this project.
 * They appear in exactly one HTML response, to the authenticated user who is
 * enrolling, which is unavoidable: a QR code is a picture of the secret.
 *
 * Backup codes are deliberately NOT shown here. They are generated after
 * verification succeeds, on the recovery-codes page, so nobody walks away with
 * codes for a factor they never proved they can use.
 */

export function meta() {
  return [{ title: "Attiva 2FA" }, { name: "robots", content: "noindex, nofollow" }];
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const { env } = context.get(cloudflareContext);
  const actor = await requireStaff(request, env);

  // Already enrolled: nothing to do here.
  if (await hasVerifiedTwoFactor(env, actor.userId)) {
    throw redirect("/admin/sicurezza/2fa");
  }

  return { email: actor.email };
}

export async function action({ request, context }: Route.ActionArgs) {
  const { env } = context.get(cloudflareContext);
  const actor = await requireStaff(request, env);
  const form = await request.formData();
  const step = String(form.get("step") ?? "");
  const auth = createAuth(env);
  const now = systemClock.now();

  // ── Step 1: password -> secret + QR ──────────────────────────────────────
  if (step === "start") {
    const password = String(form.get("password") ?? "");

    try {
      const result = await auth.api.enableTwoFactor({
        body: { password },
        headers: request.headers,
      });

      const totpURI = (result as { totpURI?: string })?.totpURI;
      if (!totpURI) return { step: "start" as const, error: "Attivazione non riuscita." };

      // Rendered server-side, inline. No external request, no CDN, and the URI
      // never leaves this response.
      const qrSvg = renderSVG(totpURI, { border: 2 });

      // The base32 secret, for manual entry when a camera is unavailable.
      const manualSecret = new URL(totpURI).searchParams.get("secret") ?? "";

      return { step: "verify" as const, qrSvg, manualSecret, error: null };
    } catch {
      // Deliberately generic: this endpoint should not confirm whether a
      // password was close.
      return { step: "start" as const, error: "Password non corretta." };
    }
  }

  // ── Step 2: verify the first code ────────────────────────────────────────
  if (step === "verify") {
    const code = String(form.get("code") ?? "").replace(/\s+/g, "");

    try {
      await auth.api.verifyTOTP({
        body: {
          code,
          // NEVER `trustDevice: true`. A privileged account must not be able to
          // acquire a bypass cookie, and offering it here is the only place it
          // could be acquired.
        },
        headers: request.headers,
      });
    } catch {
      return {
        step: "verify" as const,
        error: "Codice non valido o scaduto. Controlla l'orario del telefono e riprova.",
        qrSvg: null,
        manualSecret: null,
      };
    }

    /*
     * Mark the factor VERIFIED.
     *
     * `two_factor.verified` is this project's own column, not one Better Auth
     * maintains — it exists so `requireEnrolledStaff` can distinguish "has a
     * secret" from "has proved they can use it". Better Auth's verifyTOTP
     * above confirms the code; nothing in it knows about this column.
     *
     * Without this write the column stayed 0 forever, which meant a privileged
     * account could enrol successfully and then be refused by the gate on
     * every single admin page — permanently locked out of the shop it owns,
     * with the enrolment screen reporting success. It was found the first time
     * a browser test tried to sign in and use the admin.
     *
     * Also clears the failure counter and any lockout: proving the factor is
     * exactly the event those exist to wait for.
     */
    await env.DB.batch([
      env.DB.prepare(
        `UPDATE two_factor
            SET verified = 1, failed_verification_count = 0, locked_until = NULL
          WHERE user_id = ?1`,
      ).bind(actor.userId),

      env.DB.prepare(
        `INSERT INTO audit_logs
           (id, actor_id, actor_label, action, entity_type, entity_id, after_value, created_at)
         VALUES (?1,?2,?3,'auth.2fa_enabled','user',?2,?4,?5)`,
      ).bind(
        cryptoIds.generate(),
        actor.userId,
        actor.displayName,
        // The secret is not recorded. Only that enrolment happened.
        JSON.stringify({ method: "totp", verified: true }),
        now,
      ),
    ]);

    // Straight to the recovery codes: an enrolled factor with no way back in is
    // one lost phone from a lockout.
    return redirect("/admin/sicurezza/codici-recupero?nuovo=1");
  }

  return { step: "start" as const, error: "Azione non riconosciuta." };
}

export default function TwoFactorSetup({ loaderData, actionData }: Route.ComponentProps) {
  const showVerify = actionData && "step" in actionData && actionData.step === "verify";
  const qrSvg = actionData && "qrSvg" in actionData ? actionData.qrSvg : null;
  const manualSecret = actionData && "manualSecret" in actionData ? actionData.manualSecret : null;

  return (
    <div className="stack" style={{ maxWidth: "36rem" }}>
      <h1>Attiva l&apos;autenticazione a due fattori</h1>
      {/* Which account is being enrolled - worth stating on a shared computer. */}
      <p className="small muted">{loaderData.email}</p>

      {actionData?.error ? (
        <p className="notice notice--danger" role="alert">
          {actionData.error}
        </p>
      ) : null}

      {!showVerify ? (
        <section className="panel stack">
          <h2>1. Conferma la password</h2>
          <p className="small muted">
            Ti serve un&apos;app di autenticazione sul telefono (per esempio Google Authenticator,
            Aegis o 1Password).
          </p>
          <Form method="post" className="stack">
            <input type="hidden" name="step" value="start" />
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
                autoFocus
              />
            </div>
            <button type="submit" className="btn btn--primary">
              Continua
            </button>
          </Form>
        </section>
      ) : (
        <section className="panel stack">
          <h2>2. Inquadra il codice</h2>
          <p className="small muted">
            Apri l&apos;app di autenticazione e inquadra questo codice. Poi inserisci le sei cifre
            che compaiono.
          </p>

          {qrSvg ? (
            <div
              className="totp-qr"
              /* Server-rendered SVG from a local encoder: no external request,
                 no CDN, and the secret never leaves this response. */
              dangerouslySetInnerHTML={{ __html: qrSvg }}
            />
          ) : null}

          {manualSecret ? (
            <details>
              <summary>Non riesci a inquadrare il codice?</summary>
              <p className="small">Inserisci questa chiave manualmente nell&apos;app:</p>
              <p className="numeric" style={{ wordBreak: "break-all" }}>
                <code>{manualSecret}</code>
              </p>
            </details>
          ) : null}

          <Form method="post" className="stack">
            <input type="hidden" name="step" value="verify" />
            <div className="field">
              <label className="field__label" htmlFor="code">
                Codice a sei cifre
              </label>
              <input
                id="code"
                name="code"
                className="input numeric"
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="[0-9]{6}"
                maxLength={6}
                required
                autoFocus
              />
              <span className="field__hint">
                La verifica è obbligatoria: fino ad allora la 2FA resta disattivata.
              </span>
            </div>
            <button type="submit" className="btn btn--primary">
              Verifica e attiva
            </button>
          </Form>
        </section>
      )}
    </div>
  );
}
