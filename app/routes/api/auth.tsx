import type { Route } from "./+types/auth";
import { appContext } from "~/runtime/context";
import { createAuth } from "~/infrastructure/auth/auth.server";

/**
 * Better Auth's HTTP surface.
 *
 * Everything under /api/auth is handled by the library: sign-in, sign-out,
 * session, password reset. Reimplementing any of it here would mean two
 * definitions of authentication, and the wrong one would be the one enforcing
 * access.
 */
export async function loader({ request, context }: Route.LoaderArgs) {
  const { env } = context.get(appContext);
  return createAuth(env).handler(request);
}

export async function action({ request, context }: Route.ActionArgs) {
  const { env } = context.get(appContext);
  return createAuth(env).handler(request);
}
