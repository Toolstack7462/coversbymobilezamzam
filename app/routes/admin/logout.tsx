import { redirect } from "react-router";
import type { Route } from "./+types/logout";
import { cloudflareContext } from "../../../workers/app";
import { createAuth } from "~/infrastructure/auth/auth.server";

/**
 * Sign-out is POST-only.
 *
 * A GET logout can be triggered by any image tag or prefetch on a page the
 * user visits, which is a nuisance rather than a vulnerability - but it is an
 * avoidable one.
 */
export async function action({ request, context }: Route.ActionArgs) {
  const { env } = context.get(cloudflareContext);
  const auth = createAuth(env);

  const response = await auth.api.signOut({ headers: request.headers, asResponse: true });

  return redirect("/admin/accedi", {
    headers: { "Set-Cookie": response.headers.get("Set-Cookie") ?? "" },
  });
}

export async function loader() {
  return redirect("/admin");
}
