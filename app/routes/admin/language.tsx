import { redirect } from "react-router";
import type { Route } from "./+types/language";
import { ADMIN_LANGUAGE_COOKIE, adminLanguageReturnTo } from "~/lib/admin-locale";

export function loader() {
  return redirect("/admin");
}

/** Available on the login page too; this changes language, never authentication. */
export async function action({ request }: Route.ActionArgs) {
  const origin = request.headers.get("Origin");
  if (request.method !== "POST" || origin !== new URL(request.url).origin) {
    return new Response(null, { status: 403 });
  }
  const form = await request.formData();
  const locale = form.get("language");
  if (locale !== "it" && locale !== "en") return new Response(null, { status: 400 });
  return redirect(adminLanguageReturnTo(form.get("returnTo")), {
    status: 303,
    headers: {
      "Set-Cookie": `${ADMIN_LANGUAGE_COOKIE}=${locale}; Path=/admin; Max-Age=15552000; HttpOnly; Secure; SameSite=Lax`,
      "Cache-Control": "private, no-store",
    },
  });
}
