import { Form, redirect } from "react-router";
import type { Route } from "./+types/security-2fa-verify";
import { cloudflareContext } from "../../../workers/app";
import { createAuth } from "~/infrastructure/auth/auth.server";
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

  return null;
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
  } catch {
    return { error: "Codice non valido o scaduto." };
  }

  if (!response.ok) {
    // Deliberately identical for a wrong TOTP, a wrong backup code, a replayed
    // backup code and a locked account. Anything more specific tells an
    // attacker which of those they achieved.
    return { error: "Codice non valido o scaduto." };
  }

  const cookie = response.headers.get("Set-Cookie");
  const session = await auth.api.getSession({
    headers: new Headers({ Cookie: cookie ?? "" }),
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

  return redirect(safeNext, cookie ? { headers: { "Set-Cookie": cookie } } : undefined);
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
