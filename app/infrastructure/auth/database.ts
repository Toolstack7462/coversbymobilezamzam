/**
 * The Better Auth database, supplied by the runtime.
 *
 * ── WHY THIS IS NOT `createDb(env.DB)` ANY MORE ─────────────────────────────
 *
 * Better Auth talks to the database through Drizzle, and Drizzle's dialects are
 * not interchangeable: `drizzle-orm/d1` needs a `D1Database`, `drizzle-orm/mysql2`
 * needs a mysql2 pool, and the table objects each accepts come from a different
 * builder. The `SqlDatabase` port cannot paper over that, because the adapter
 * does not take SQL — it takes a query builder.
 *
 * So the CHOICE is made once, at the edge, by whichever entry point is running,
 * and handed in. `workers/app.ts` builds the D1 one; `server/index.ts` builds
 * the MariaDB one. `createAuth` receives it and never learns which.
 *
 * The alternative — a `provider` string and a conditional import inside
 * `createAuth` — would put `mysql2` in the Worker bundle and `drizzle-orm/d1`
 * in the Node one, and would make the auth layer the thing that knows where it
 * is deployed. That is precisely the coupling this migration is removing.
 */

import type { BetterAuthOptions } from "better-auth";

/**
 * What `betterAuth({ database })` wants.
 *
 * Typed from Better Auth's own options rather than restated, so an upgrade that
 * changes the shape is a compile error here rather than a runtime one on the
 * first sign-in after a deployment.
 */
export type AuthDatabase = BetterAuthOptions["database"];

/**
 * A holder, set once per runtime, and shared across module instances.
 *
 * A property of the PROCESS rather than of a request: on Node one pool serves
 * every request, and on Workers the adapter is rebuilt per request anyway
 * because the binding is.
 *
 * ── WHY IT HANGS OFF globalThis ─────────────────────────────────────────────
 *
 * On the Node deployment this module is loaded TWICE — once inside the React
 * Router server build, which `createAuth` is bundled into, and once inside the
 * compiled Express entry, which sets the factory. A plain module-level `let`
 * meant the entry set one copy and `createAuth` read the other, so every admin
 * route failed with "No auth database has been configured" while the server
 * had, in fact, configured one.
 *
 * Same shape and same reason as `appContext` in app/runtime/context.ts. Both
 * are symptoms of having two entry points, which is what this migration adds,
 * and both are invisible on Cloudflare where there is only one bundle.
 */
const HOLDER_KEY = Symbol.for("covers-by-mobile.auth-database");

type Holder = typeof globalThis & { [HOLDER_KEY]?: () => AuthDatabase };
const holder = globalThis as Holder;

export function setAuthDatabaseFactory(factory: () => AuthDatabase): void {
  holder[HOLDER_KEY] = factory;
}

export function authDatabase(): AuthDatabase {
  const configured = holder[HOLDER_KEY];
  if (!configured) {
    throw new Error(
      "No auth database has been configured. The entry point must call " +
        "setAuthDatabaseFactory() before handling a request — see workers/app.ts " +
        "and server/index.ts.",
    );
  }
  return configured();
}
