import { Form, redirect } from "react-router";
import type { Route } from "./+types/security-2fa-verify";
import { cloudflareContext } from "../../../workers/app";
import { createAuth } from "~/infrastructure/auth/auth.server";
import {
  relayCookies,
  cookieHeaderFrom,
  hasTwoFactorChallenge,
} from "~/infrastructure/auth/cookies.server";
import { getSession } from "~/infrastructure/auth/session.server";
import { systemClock, cryptoIds } from "~/infrastructure/primitives";

/**
 * The sign-in second-factor challenge.
 *
 * Reached after a correct password when the account has a verified factor.
 * Better Auth issues a short-lived two-factor cookie at that point, NOT a
 * session — so no request between here and a correct code is authenticated,
 * and there is no window in which a password alone grants admin access.
 *
 * This route is outside the protected admin layout for that exact reason: the
 * user is not yet signed in.
 */

export function meta() {
  return [{ title: "Verifica in due passaggi" }, { name: "robots", content: "noindex, nofollow" }];
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const { env } = context.get(cloudflareContext);

  // Already fully signed in: nothing to challenge.
  const session = await getSession(request, env);
  if (session?.user?.id) throw redirect("/admin");

  /*
   * No challenge in flight: send them to the beginning.
   *
   * This page used to render for anyone who typed the address, with no
   * credential of any kind. It was not a way in — a code submitted without the
   * challenge cookie is refused whatever it is — but it offered a stranger a
   * form that can never succeed, and let unauthenticated requests reach the
   * verification endpoint. Found by the deployed smoke tests, which ask every
   * route what it does for a visitor holding nothing.
   */
  if (!hasTwoFactorChallenge(request)) throw redirect("/admin/accedi");

  return null;
}

/**
 * What the customer is told, whatever actually happened.
 *
 * A single constant so the four failure paths cannot drift into four subtly
 * different sentences — which is how a "which message did you get?" question
 * starts leaking the distinction this is here to hide.
 */
const WRONG_CODE = "Codice non valido o scaduto.";

/**
 * Records WHY a challenge failed, where only staff can see it.
 *
 * Failures are logged; successes already were. A 429 here means the account hit
 * the five-per-minute limit on `/two-factor/verify-totp` and the code was very
 * possibly correct — the single most confusing failure this screen can produce,
 * and previously invisible.
 *
 * No user id: at this point in the flow there is no session, and the two-factor
 * cookie identifies a challenge rather than a person. The row is about the
 * attempt, not the actor.
 */
async function recordFailure(
  env: Env,
  now: number,
  mode: string,
  status: number,
  detail: string | null,
): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO audit_logs
       (id, actor_id, actor_label, action, entity_type, entity_id, after_value, created_at)
     VALUES (?1, '', '', 'auth.2fa_challenge_failed', 'user', '', ?2, ?3)`,
  )
    .bind(
      cryptoIds.generate(),
      JSON.stringify({
        method: mode === "backup" ? "backup_code" : "totp",
        status,
        // 429 is the one worth naming: it is the case where the code may well
        // have been right.
        rateLimited: status === 429,
        detail,
      }),
      now,
    )
    .run();
}

export async function action({ request, context }: Route.ActionArgs) {
  const { env } = context.get(cloudflareContext);
  const form = await request.formData();
  const auth = createAuth(env);
  const now = systemClock.now();

  const mode = String(form.get("mode") ?? "totp");
  const code = String(form.get("code") ?? "").replace(/\s+/g, "");
  const next = String(form.get("next") ?? "/admin");
  const safeNext = next.startsWith("/admin") ? next : "/admin";

  if (!code) return { error: "Inserisci il codice." };

  let response: Response;
  try {
    if (mode === "backup") {
      response = await auth.api.verifyBackupCode({
        body: {
          code,
          // Never `trustDevice: true`. A backup code is the WEAKER factor - it
          // is a static string on a piece of paper - so it is the last thing
          // that should be able to buy a 30-day bypass.
        },
        headers: request.headers,
        asResponse: true,
      });
    } else {
      response = await auth.api.verifyTOTP({
        body: { code },
        headers: request.headers,
        asResponse: true,
      });
    }
  } catch (error) {
    await recordFailure(env, now, mode, 0, String(error).slice(0, 120));
    return { error: WRONG_CODE };
  }

  if (!response.ok) {
    /*
     * One message, four causes — and now a record of which.
     *
     * The message stays deliberately identical for a wrong TOTP, a wrong backup
     * code, a replayed backup code and a rate-limited account: anything more
     * specific tells an attacker which of those they achieved.
     *
     * The cost of that was paid by the merchant. A correct code submitted once
     * too often inside the sixty-second window comes back 429, which is
     * `!ok`, and the person holding the right phone is told their code is
     * wrong — with nothing anywhere to say otherwise. "It says my code is
     * invalid" and "I am being throttled" looked identical from the outside,
     * including to whoever was asked to debug it.
     *
     * So the STATUS is written to the audit log, which only staff can read.
     * Same opacity to an attacker, and the next time this happens the answer is
     * one query away instead of an afternoon of inference.
     */
    await recordFailure(env, now, mode, response.status, null);
    return { error: WRONG_CODE };
  }

  // Every cookie: answering the challenge both establishes the session and
  // clears the two-factor cookie, which is two Set-Cookie headers.
  const setCookies = relayCookies(response);
  const session = await auth.api.getSession({
    headers: new Headers({ Cookie: cookieHeaderFrom(response) }),
  });

  if (session?.user?.id) {
    await env.DB.prepare(
      `INSERT INTO audit_logs
         (id, actor_id, actor_label, action, entity_type, entity_id, after_value, created_at)
       VALUES (?1,?2,'','auth.2fa_challenge_passed','user',?2,?3,?4)`,
    )
      .bind(
        cryptoIds.generate(),
        session.user.id,
        JSON.stringify({ method: mode === "backup" ? "backup_code" : "totp" }),
        now,
      )
      .run();
  }

  return redirect(safeNext, setCookies);
}

export default function TwoFactorChallenge({ actionData }: Route.ComponentProps) {
  return (
    <main id="main" className="admin-auth">
      <div className="panel stack admin-auth__panel">
        <h1>Verifica in due passaggi</h1>
        <p className="small muted">
          Inserisci il codice a sei cifre dalla tua app di autenticazione.
        </p>

        {actionData?.error ? (
          <p className="notice notice--danger" role="alert">
            {actionData.error}
          </p>
        ) : null}

        <Form method="post" className="stack">
          <input type="hidden" name="mode" value="totp" />
          <div className="field">
            <label className="field__label" htmlFor="code">
              Codice
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
          </div>
          <button type="submit" className="btn btn--primary">
            Verifica
          </button>
        </Form>

        <details>
          <summary>Non hai il telefono?</summary>
          <p className="small muted">
            Usa uno dei codici di recupero salvati durante l&apos;attivazione. Ogni codice funziona
            una volta sola.
          </p>
          <Form method="post" className="stack">
            <input type="hidden" name="mode" value="backup" />
            <div className="field">
              <label className="field__label" htmlFor="backup">
                Codice di recupero
              </label>
              <input
                id="backup"
                name="code"
                className="input numeric"
                autoComplete="off"
                required
              />
            </div>
            <button type="submit" className="btn btn--secondary">
              Usa codice di recupero
            </button>
          </Form>
        </details>
      </div>
    </main>
  );
}
