import adminStyles from "~/styles/admin.css?url";
import { AdminLanguageSwitcher } from "~/components/admin/language-switcher";
import { adminTranslator } from "~/lib/admin-i18n";
import { adminLocaleFromMatches } from "~/lib/admin-locale";
import { useAdminTranslator } from "~/components/admin/use-admin-translator";
import { Form, redirect } from "react-router";
import type { LinksFunction } from "react-router";
import type { Route } from "./+types/staff-accept";
import { PasswordField } from "~/components/admin/password-field";
import { MIN_PASSWORD_LENGTH, PASSWORD_REQUIREMENTS } from "~/domain/users/password-policy";
import adminFormStyles from "~/styles/admin-forms.css?url";
import { appContext } from "~/runtime/context";
import { createAuth } from "~/infrastructure/auth/auth.server";
import { allSetCookies, cookieHeaderFrom } from "~/infrastructure/auth/cookies.server";
import { systemClock, cryptoIds } from "~/infrastructure/primitives";
import {
  acceptInvitation,
  AcceptInvitationInput,
  hashToken,
} from "~/application/commands/staff-invitations";

/**
 * Invitation acceptance.
 *
 * PUBLIC by necessity — the invitee has no account yet, so it sits outside the
 * protected layout. The token in the URL is the only credential, which is why
 * it is single-use, expiring, scoped to one email address, and stored hashed.
 */

export function meta({ matches }: Route.MetaArgs) {
  const t = adminTranslator(adminLocaleFromMatches(matches));
  return [{ title: t("Accetta l'invito") }, { name: "robots", content: "noindex, nofollow" }];
}

export async function loader({ params, context }: Route.LoaderArgs) {
  const { env } = context.get(appContext);
  const now = systemClock.now();

  const invitation = await env.DB.prepare(
    `SELECT email, status, expires_at FROM staff_invitations WHERE token_hash = ?1`,
  )
    .bind(await hashToken(params.token))
    .first<{ email: string; status: string; expires_at: number }>();

  // One response for missing, used, revoked and expired. An unauthenticated
  // caller with a guessed token learns nothing about which it was.
  if (!invitation || invitation.status !== "pending" || invitation.expires_at <= now) {
    return { valid: false as const, email: null };
  }

  // The address is shown so the invitee can confirm the invitation is for them.
  // It cannot be changed: the account is created against this address.
  return { valid: true as const, email: invitation.email };
}

export async function action({ request, params, context }: Route.ActionArgs) {
  const { env } = context.get(appContext);
  const form = await request.formData();

  const password = String(form.get("password") ?? "");
  const confirm = String(form.get("confirm") ?? "");
  if (password !== confirm) return { error: "Le due password non coincidono." };

  const parsed = AcceptInvitationInput.safeParse({
    token: params.token,
    name: String(form.get("name") ?? ""),
    password,
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Dati non validi." };
  }

  const auth = createAuth(env);

  const result = await acceptInvitation(parsed.data, {
    env,
    clock: systemClock,
    ids: cryptoIds,
    createAccount: async ({ name, email, password: pw }) => {
      try {
        const response = await auth.api.signUpEmail({
          body: { name, email, password: pw },
          headers: request.headers,
          asResponse: true,
        });
        if (!response.ok) return { ok: false as const, detail: "signup_rejected" };
        const cookie = allSetCookies(response).join("\n");
        const session = await auth.api.getSession({
          headers: new Headers({ Cookie: cookieHeaderFrom(response) }),
        });
        if (!session?.user?.id) return { ok: false as const, detail: "no_session" };
        return { ok: true as const, userId: session.user.id, setCookie: cookie };
      } catch {
        return { ok: false as const, detail: "signup_threw" };
      }
    },
  });

  if (!result.ok) {
    return {
      error:
        result.reason === "invalid_or_expired"
          ? "Invito non valido, già usato o scaduto."
          : "Impossibile creare l'account. Contatta chi ti ha invitato.",
    };
  }

  // A privileged invitee lands on enrolment. The layout enforces it on every
  // request anyway; this just avoids a pointless bounce.
  return redirect(
    result.mustEnrolTwoFactor ? "/admin/sicurezza/2fa?obbligatorio=1" : "/admin",
    cookieHeaders(result.setCookie),
  );
}

/**
 * The form control styles.
 *
 * Registered outside routes/admin/layout.tsx — an invited colleague has no
 * staff session yet — so admin.css never loads here.
 */
export const links: LinksFunction = () => [
  { rel: "stylesheet", href: adminFormStyles },
  // admin.css too: this screen is outside the admin layout, and the language
  // switcher it now carries is styled there.
  { rel: "stylesheet", href: adminStyles },
];

export default function AcceptInvite({ loaderData, actionData }: Route.ComponentProps) {
  const t = useAdminTranslator();
  if (!loaderData.valid) {
    return (
      <main id="main" className="admin-auth">
        <div className="panel stack admin-auth__panel">
          <div className="admin-auth__language">
            <AdminLanguageSwitcher />
          </div>
          <h1>{t("Invito non valido")}</h1>
          <p className="muted">
            {t(
              "Questo invito non è valido, è già stato usato o è scaduto. Chiedi a chi ti ha invitato di crearne uno nuovo.",
            )}
          </p>
        </div>
      </main>
    );
  }

  return (
    <main id="main" className="admin-auth">
      <div className="panel stack admin-auth__panel">
        <div className="admin-auth__language">
          <AdminLanguageSwitcher />
        </div>
        <h1>{t("Accetta l'invito")}</h1>
        <p className="small muted">
          {t("Stai creando un account per ")}
          <strong>{loaderData.email}</strong>
          {t(". Scegli tu la password: nessun altro la conosce.")}
        </p>

        {actionData?.error ? (
          <p className="notice notice--danger" role="alert">
            {t(actionData.error)}
          </p>
        ) : null}

        <Form method="post" className="stack">
          <div className="field">
            <label className="field__label" htmlFor="name">
              {t("Nome e cognome")}
            </label>
            <input id="name" name="name" className="input" required autoComplete="name" />
          </div>

          <PasswordField
            id="password"
            name="password"
            label={t("Password")}
            autoComplete="new-password"
            required
            minLength={MIN_PASSWORD_LENGTH}
            requirements={PASSWORD_REQUIREMENTS.map((rule) => t(rule))}
          />

          <PasswordField
            id="confirm"
            name="confirm"
            label={t("Ripeti la password")}
            autoComplete="new-password"
            required
            minLength={MIN_PASSWORD_LENGTH}
          />

          <button type="submit" className="btn btn--primary">
            {t("Crea account")}
          </button>
        </Form>

        <p className="caption muted">
          {t(
            "Se il tuo ruolo lo richiede, subito dopo ti verrà chiesto di attivare l'autenticazione a due fattori.",
          )}
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
