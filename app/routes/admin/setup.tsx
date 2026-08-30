import { Form, redirect } from "react-router";
import type { Route } from "./+types/setup";
import { cloudflareContext } from "../../../workers/app";
import { createAuth } from "~/infrastructure/auth/auth.server";
import { systemClock, cryptoIds } from "~/infrastructure/primitives";

/**
 * First-run administrator setup.
 *
 * **Self-closing**: it works only while zero staff profiles exist. The moment
 * the first administrator is created, every subsequent request here 404s. That
 * is what makes a public setup route safe — there is no window to race, because
 * the check and the insert happen in the same request and the guard is the
 * absence of data rather than a flag someone could flip back.
 *
 * Deliberately a route rather than a CLI script: it uses Better Auth's own
 * sign-up path, so password hashing is never reimplemented here. Two
 * implementations of password storage would be one too many.
 */

async function staffCount(env: Env): Promise<number> {
  const row = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM staff_profiles WHERE archived_at IS NULL`,
  ).first<{ n: number }>();
  return row?.n ?? 0;
}

export function meta() {
  return [{ title: "Configurazione iniziale" }, { name: "robots", content: "noindex, nofollow" }];
}

export async function loader({ context }: Route.LoaderArgs) {
  const { env } = context.get(cloudflareContext);

  // Closed forever once an administrator exists.
  if ((await staffCount(env)) > 0) {
    throw new Response("Not found", { status: 404 });
  }

  const roleSeeded = await env.DB.prepare(`SELECT id FROM roles WHERE code = 'super_admin'`).first<{
    id: string;
  }>();

  return { rolesSeeded: roleSeeded !== null };
}

export async function action({ request, context }: Route.ActionArgs) {
  const { env } = context.get(cloudflareContext);

  if ((await staffCount(env)) > 0) {
    throw new Response("Not found", { status: 404 });
  }

  const form = await request.formData();
  const name = String(form.get("name") ?? "").trim();
  const email = String(form.get("email") ?? "").trim();
  const password = String(form.get("password") ?? "");
  const confirm = String(form.get("confirm") ?? "");

  if (!name || !email) return { error: "Nome ed email sono obbligatori." };
  if (password !== confirm) return { error: "Le due password non coincidono." };
  // These accounts can change where money goes.
  if (password.length < 12) return { error: "La password deve avere almeno 12 caratteri." };

  const role = await env.DB.prepare(`SELECT id FROM roles WHERE code = 'super_admin'`).first<{
    id: string;
  }>();
  if (!role) {
    return { error: "I ruoli non sono ancora stati creati. Esegui prima `npm run db:seed`." };
  }

  const auth = createAuth(env);

  let response: Response;
  try {
    response = await auth.api.signUpEmail({
      body: { name, email, password },
      headers: request.headers,
      asResponse: true,
    });
  } catch {
    return { error: "Impossibile creare l'account. Controlla che l'email non sia già registrata." };
  }
  if (!response.ok) {
    return { error: "Impossibile creare l'account." };
  }

  const cookie = response.headers.get("Set-Cookie");
  const session = await auth.api.getSession({
    headers: new Headers({ Cookie: cookie ?? "" }),
  });
  if (!session?.user?.id) return { error: "Account creato ma sessione non disponibile." };

  const now = systemClock.now();

  // The staff profile and the role grant are what actually confer admin access.
  // A Better Auth user on its own is a customer.
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO staff_profiles (id, user_id, display_name, job_title, active, created_at, updated_at)
       VALUES (?1,?2,?3,'Amministratore',1,?4,?4)`,
    ).bind(cryptoIds.generate(), session.user.id, name, now),

    env.DB.prepare(
      `INSERT INTO user_roles (id, user_id, role_id, granted_by, granted_at)
       VALUES (?1,?2,?3,?2,?4)`,
    ).bind(cryptoIds.generate(), session.user.id, role.id, now),

    env.DB.prepare(
      `INSERT INTO audit_logs
         (id, actor_id, actor_label, action, entity_type, entity_id, after_value, created_at)
       VALUES (?1,?2,?3,'staff.bootstrap','user',?2,?4,?5)`,
    ).bind(
      cryptoIds.generate(),
      session.user.id,
      name,
      JSON.stringify({ role: "super_admin", viaFirstRunSetup: true }),
      now,
    ),
  ]);

  return redirect("/admin", cookie ? { headers: { "Set-Cookie": cookie } } : undefined);
}

export default function AdminSetup({ loaderData, actionData }: Route.ComponentProps) {
  return (
    <main id="main" className="admin-auth">
      <div className="panel stack admin-auth__panel">
        <h1>Configurazione iniziale</h1>
        <p className="small muted">
          Crea il primo amministratore. Questa pagina si disattiva automaticamente e in modo
          definitivo appena l&apos;account è creato.
        </p>

        {!loaderData.rolesSeeded ? (
          <p className="notice notice--warning">
            I ruoli non sono ancora presenti nel database. Esegui <code>npm run db:seed</code> prima
            di continuare.
          </p>
        ) : null}

        {actionData?.error ? (
          <p className="notice notice--danger" role="alert">
            {actionData.error}
          </p>
        ) : null}

        <Form method="post" className="stack">
          <div className="field">
            <label className="field__label" htmlFor="name">
              Nome e cognome
            </label>
            <input id="name" name="name" className="input" required autoComplete="name" />
          </div>

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
              minLength={12}
              autoComplete="new-password"
            />
            <span className="field__hint">
              Almeno 12 caratteri. Questo account potrà modificare i dati di pagamento.
            </span>
          </div>

          <div className="field">
            <label className="field__label" htmlFor="confirm">
              Ripeti la password
            </label>
            <input
              id="confirm"
              name="confirm"
              type="password"
              className="input"
              required
              minLength={12}
              autoComplete="new-password"
            />
          </div>

          <button type="submit" className="btn btn--primary" disabled={!loaderData.rolesSeeded}>
            Crea amministratore
          </button>
        </Form>

        <p className="caption muted">
          Attiva l&apos;autenticazione a due fattori subito dopo: è un requisito di lancio per gli
          amministratori e per chi verifica i pagamenti.
        </p>
      </div>
    </main>
  );
}
