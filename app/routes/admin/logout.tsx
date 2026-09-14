import { adminTranslator } from "~/lib/admin-i18n";
import { adminLocaleFromMatches } from "~/lib/admin-locale";
import { redirect } from "react-router";
import type { Route } from "./+types/logout";
import { appContext } from "~/runtime/context";
import { createAuth } from "~/infrastructure/auth/auth.server";
import { relayCookies } from "~/infrastructure/auth/cookies.server";

/**
 * Sign-out is POST-only.
 *
 * A GET logout can be triggered by any image tag or prefetch on a page the
 * user visits, which is a nuisance rather than a vulnerability - but it is an
 * avoidable one.
 */
export function meta({ matches }: Route.MetaArgs) {
  const t = adminTranslator(adminLocaleFromMatches(matches));
  return [{ title: t("Uscita") }, { name: "robots", content: "noindex, nofollow" }];
}

export async function action({ request, context }: Route.ActionArgs) {
  const { env } = context.get(appContext);
  const auth = createAuth(env);

  const response = await auth.api.signOut({ headers: request.headers, asResponse: true });

  return redirect("/admin/accedi", {
    // Signing out clears the session AND any two-factor cookie: more than one
    // Set-Cookie, and leaving one behind means a cookie the browser keeps
    // sending for an account that has left.
    ...(relayCookies(response) ?? { headers: new Headers() }),
  });
}

export async function loader() {
  return redirect("/admin");
}
