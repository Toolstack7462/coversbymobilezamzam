import { Form, redirect } from "react-router";
import type { Route } from "./+types/setup";
import { cloudflareContext } from "../../../workers/app";
import { createAuth } from "~/infrastructure/auth/auth.server";
import { allSetCookies, cookieHeaderFrom } from "~/infrastructure/auth/cookies.server";
import { systemClock, cryptoIds } from "~/infrastructure/primitives";
import {
  bootstrapAdmin,
  BootstrapAdminInput,
  isInstalled,
} from "~/application/commands/bootstrap-admin";

/**
 * First-run administrator setup.
 *
 * The guard is an ATOMIC CLAIM on a singleton row, taken before anything is
 * created — not a "count staff profiles" read, which two concurrent requests
 * can both pass. See docs/initial-admin-bootstrap.md.
 *
 * Access additionally requires INITIAL_ADMIN_SETUP_TOKEN, a high-entropy secret
 * submitted through this POST form. It is never placed in a URL, never logged,
 * and never echoed back into the rendered HTML after submission.
 */

export function meta() {
  return [{ title: "Configurazione iniziale" }, { name: "robots", content: "noindex, nofollow" }];
}

export async function loader({ context }: Route.LoaderArgs) {
  const { env } = context.get(cloudflareContext);

  // Closed permanently once installation has completed.
  if (await isInstalled(env)) {
    throw new Response("Not found", { status: 404 });
  }

  const roleSeeded = await env.DB.prepare(`SELECT id FROM roles WHERE code = 'super_admin'`).first<{
    id: string;
  }>();

  return {
    rolesSeeded: roleSeeded !== null,
    // Whether a token is configured at all - never the token itself.
    tokenConfigured: Boolean(
      env.INITIAL_ADMIN_SETUP_TOKEN && env.INITIAL_ADMIN_SETUP_TOKEN.trim().length >= 24,
    ),
    turnstileSiteKey: env.TURNSTILE_SITE_KEY ?? null,
  };
}

export async function action({ request, context }: Route.ActionArgs) {
  const { env } = context.get(cloudflareContext);

  if (await isInstalled(env)) {
    throw new Response("Not found", { status: 404 });
  }

  const form = await request.formData();
  const password = String(form.get("password") ?? "");
  const confirm = String(form.get("confirm") ?? "");

  if (password !== confirm) return { error: "Le due password non coincidono." };

  const parsed = BootstrapAdminInput.safeParse({
    name: String(form.get("name") ?? ""),
    email: String(form.get("email") ?? ""),
    password,
    setupToken: String(form.get("setupToken") ?? ""),
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Dati non validi." };
  }

  // Turnstile, when configured. Verified SERVER-side: a token that only passes
  // in the browser proves nothing.
  if (env.TURNSTILE_SECRET_KEY) {
    const turnstileToken = String(form.get("cf-turnstile-response") ?? "");
    const verification = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        secret: env.TURNSTILE_SECRET_KEY,
        response: turnstileToken,
        remoteip: request.headers.get("CF-Connecting-IP") ?? undefined,
      }),
    });
    const outcome = (await verification.json()) as { success?: boolean };
    if (!outcome.success) return { error: "Verifica anti-bot non superata." };
  }

  const auth = createAuth(env);

  const result = await bootstrapAdmin(parsed.data, {
    env,
    clock: systemClock,
    ids: cryptoIds,
    ipAddress: request.headers.get("CF-Connecting-IP"),
    // Better Auth owns password hashing. There is no second implementation.
    createAccount: async ({ name, email, password: pw }) => {
      try {
        const response = await auth.api.signUpEmail({
          body: { name, email, password: pw },
          headers: request.headers,
          asResponse: true,
        });
        if (!response.ok) return { ok: false as const, detail: "signup_rejected" };

        const session = await auth.api.getSession({
          headers: new Headers({ Cookie: cookieHeaderFrom(response) }),
        });
        if (!session?.user?.id) return { ok: false as const, detail: "no_session" };

        // Joined with newlines: the caller splits them back into separate
        // Set-Cookie headers. Reading only the first would drop whichever
        // cookie Better Auth happened to send second.
        return {
          ok: true as const,
          userId: session.user.id,
          setCookie: allSetCookies(response).join("\n"),
        };
      } catch {
        return { ok: false as const, detail: "signup_threw" };
      }
    },
  });

  if (!result.ok) {
    // Messages are deliberately non-specific about the token. "Wrong token" and
    // "already installed" read the same to an unauthenticated caller.
    const messages: Record<string, string> = {
      not_configured:
        "La configurazione iniziale non è abilitata su questo ambiente. Imposta INITIAL_ADMIN_SETUP_TOKEN.",
      invalid_token: "Token di installazione non valido.",
      rate_limited: "Troppi tentativi. Riprova più tardi.",
      already_installed: "Installazione già completata.",
      concurrent_install: "Installazione già in corso o completata.",
      roles_missing: "I ruoli non sono ancora stati creati. Esegui prima `npm run db:seed`.",
      account_creation_failed:
        "Impossibile creare l'account. Controlla che l'email non sia già registrata.",
    };
    return { error: messages[result.reason] ?? "Installazione non riuscita." };
  }

  return redirect("/admin/sicurezza/2fa", cookieHeaders(result.setCookie));
}

export default function AdminSetup({ loaderData, actionData }: Route.ComponentProps) {
  const { rolesSeeded, tokenConfigured, turnstileSiteKey } = loaderData;
  const ready = rolesSeeded && tokenConfigured;

  return (
    <main id="main" className="admin-auth">
      <div className="panel stack admin-auth__panel">
        <h1>Configurazione iniziale</h1>
        <p className="small muted">
          Crea il primo amministratore. Questa pagina si disattiva in modo definitivo appena
          l&apos;installazione è completata.
        </p>

        {!rolesSeeded ? (
          <p className="notice notice--warning">
            I ruoli non sono ancora presenti nel database. Esegui <code>npm run db:seed</code> prima
            di continuare.
          </p>
        ) : null}

        {!tokenConfigured ? (
          <p className="notice notice--warning">
            <code>INITIAL_ADMIN_SETUP_TOKEN</code> non è configurato, oppure è troppo corto (minimo
            24 caratteri). Senza token questa pagina si rifiuta di funzionare: non si apre mai senza
            autorizzazione.
          </p>
        ) : null}

        {actionData?.error ? (
          <p className="notice notice--danger" role="alert">
            {actionData.error}
          </p>
        ) : null}

        <Form method="post" className="stack" autoComplete="off">
          <div className="field">
            <label className="field__label" htmlFor="setupToken">
              Token di installazione
            </label>
            {/*
              type=password so it is not shoulder-surfed, and the value is NEVER
              written back into the response - a rejected attempt returns an
              empty field rather than echoing the guess.
            */}
            <input
              id="setupToken"
              name="setupToken"
              type="password"
              className="input"
              required
              autoComplete="off"
              disabled={!ready}
            />
            <span className="field__hint">
              Fornito da chi ha configurato l&apos;ambiente. Non compare mai in un URL o in un log.
            </span>
          </div>

          <div className="field">
            <label className="field__label" htmlFor="name">
              Nome e cognome
            </label>
            <input
              id="name"
              name="name"
              className="input"
              required
              autoComplete="name"
              disabled={!ready}
            />
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
              disabled={!ready}
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
              disabled={!ready}
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
              disabled={!ready}
            />
          </div>

          {turnstileSiteKey ? (
            <div className="cf-turnstile" data-sitekey={turnstileSiteKey} />
          ) : null}

          <button type="submit" className="btn btn--primary" disabled={!ready}>
            Crea amministratore
          </button>
        </Form>

        <p className="caption muted">
          Subito dopo ti verrà chiesto di attivare l&apos;autenticazione a due fattori: è
          obbligatoria per gli amministratori.
        </p>
      </div>
    </main>
  );
}

/**
 * Splits the newline-joined cookie list back into real Set-Cookie headers.
 *
 * The bootstrap command returns cookies as one string because its result type
 * is a plain value, not a Response. Passing that string straight into a single
 * `Set-Cookie` header would send a header containing a newline — which is
 * either rejected or, worse, treated as header injection.
 */
function cookieHeaders(joined: string | null): { headers: Headers } | undefined {
  const cookies = (joined ?? "").split("\n").filter((c) => c.trim() !== "");
  if (cookies.length === 0) return undefined;

  const headers = new Headers();
  for (const cookie of cookies) headers.append("Set-Cookie", cookie);
  return { headers };
}
