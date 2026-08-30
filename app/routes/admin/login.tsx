import { Form, redirect } from "react-router";
import type { Route } from "./+types/login";
import { cloudflareContext } from "../../../workers/app";
import { createAuth } from "~/infrastructure/auth/auth.server";
import { getSession, loadStaffActor } from "~/infrastructure/auth/session.server";

/**
 * Staff login.
 *
 * Sits outside the protected admin layout, because a route that requires a
 * session cannot host the form that creates one.
 */

export function meta() {
  // Never indexed.
  return [{ title: "Accesso staff" }, { name: "robots", content: "noindex, nofollow" }];
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const { env } = context.get(cloudflareContext);
  const session = await getSession(request, env);

  // Already signed in AND actually staff: skip the form.
  if (session?.user?.id) {
    const actor = await loadStaffActor(env, session.user.id);
    if (actor) throw redirect("/admin");
  }

  return null;
}

export async function action({ request, context }: Route.ActionArgs) {
  const { env } = context.get(cloudflareContext);
  const form = await request.formData();

  const email = String(form.get("email") ?? "").trim();
  const password = String(form.get("password") ?? "");
  const next = String(form.get("next") ?? "/admin");

  if (!email || !password) {
    return { error: "Inserisci email e password." };
  }

  const auth = createAuth(env);

  let response: Response;
  try {
    response = await auth.api.signInEmail({
      body: { email, password },
      headers: request.headers,
      asResponse: true,
    });
  } catch {
    // Deliberately identical whether the email exists, the password is wrong,
    // or the account is disabled. Anything more specific turns this form into
    // an oracle for which addresses have accounts.
    return { error: "Credenziali non valide." };
  }

  if (!response.ok) {
    return { error: "Credenziali non valide." };
  }

  const cookie = response.headers.get("Set-Cookie");
  const session = await auth.api.getSession({
    headers: new Headers({ Cookie: cookie ?? "" }),
  });

  // A valid customer account is not staff access. Same generic message: a
  // customer probing the admin learns nothing about whether their address is
  // known to it.
  if (!session?.user?.id || !(await loadStaffActor(env, session.user.id))) {
    return { error: "Credenziali non valide." };
  }

  // Only redirect to an internal path. A next= parameter pointing off-site is
  // an open redirect.
  const safeNext = next.startsWith("/admin") ? next : "/admin";

  return redirect(safeNext, cookie ? { headers: { "Set-Cookie": cookie } } : undefined);
}

export default function AdminLogin({ actionData }: Route.ComponentProps) {
  return (
    <main id="main" className="admin-auth">
      <div className="panel stack admin-auth__panel">
        <h1>Accesso staff</h1>
        <p className="muted small">Area riservata. Accesso solo per il personale autorizzato.</p>

        {actionData?.error ? (
          <p className="notice notice--danger" role="alert">
            {actionData.error}
          </p>
        ) : null}

        <Form method="post" className="stack">
          <div className="field">
            <label className="field__label" htmlFor="email">
              Email
            </label>
            <input
              id="email"
              name="email"
              type="email"
              className="input"
              required
              autoComplete="username"
              autoFocus
            />
          </div>

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
            Accedi
          </button>
        </Form>

        <p className="caption muted">
          Non esiste registrazione pubblica per l&apos;area amministrativa. Un account viene creato
          solo da un amministratore esistente.
        </p>
      </div>
    </main>
  );
}
