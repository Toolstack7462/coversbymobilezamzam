/**
 * Wraps the Cloudflare test bindings in the runtime-neutral ports.
 *
 * The workers test suite runs inside workerd against a real D1 with the real
 * migrations applied, which is exactly what it should keep doing — that suite's
 * job is to prove the CLOUDFLARE path still works, and it stays meaningful only
 * for as long as it exercises the same code the Worker serves.
 *
 * What changed is that the application no longer takes a `D1Database`. It takes
 * a `SqlDatabase`, and these helpers are the one place the test bindings are
 * adapted, rather than sixty adaptations scattered through the suite.
 *
 * `testDb()` returns a database that is genuinely D1 underneath, so nothing
 * here weakens what the tests prove.
 */

import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { D1SqlDatabase } from "~/infrastructure/db/d1";
import { R2ObjectStore } from "~/infrastructure/storage/r2";
import { createD1Db } from "~/infrastructure/db/client";
import { user, session, account, verification, twoFactor } from "@db/schema";
import { setAuthDatabaseFactory } from "~/infrastructure/auth/database";
import type { SqlDatabase } from "~/infrastructure/db/sql";
import type { AppEnv } from "~/runtime/context";

/** The D1 binding, behind the port. */
export function testDb(env: { DB: D1Database }): SqlDatabase {
  return new D1SqlDatabase(env.DB);
}

/**
 * The whole test environment, behind the ports.
 *
 * Memoised per binding object. Better Auth's adapter is rebuilt from `env` on
 * each `createAuth`, and a fresh `AppEnv` per call would hand out a fresh
 * `SqlDatabase` each time — harmless, but it makes `expect(a).toBe(b)` on a
 * database surprising, and surprising is not what a test helper should be.
 */
const cache = new WeakMap<object, AppEnv>();

export function testAppEnv(env: Env): AppEnv {
  const hit = cache.get(env);
  if (hit) return hit;

  const wrapped: AppEnv = {
    ...env,
    // The vars are optional in the generated `Env` because the restore-test
    // environment omits some of them. In a test they are always present, and
    // the fallbacks say what the test environment is rather than pretending.
    APP_ENV: env.APP_ENV ?? "development",
    APP_BASE_URL: env.APP_BASE_URL ?? "http://localhost:5173",
    DEFAULT_LOCALE: env.DEFAULT_LOCALE ?? "it",
    SUPPORTED_LOCALES: env.SUPPORTED_LOCALES ?? "it,en",
    DEFAULT_CURRENCY: env.DEFAULT_CURRENCY ?? "EUR",
    STORE_TIMEZONE: env.STORE_TIMEZONE ?? "Europe/Rome",
    DB: new D1SqlDatabase(env.DB),
    MEDIA: new R2ObjectStore(env.MEDIA),
    PRIVATE_FILES: new R2ObjectStore(env.PRIVATE_FILES),
  };

  cache.set(env, wrapped);
  return wrapped;
}

/**
 * Configures Better Auth's database the way the Worker entry point does.
 *
 * A test that calls `createAuth` directly bypasses `fetch`, so nothing has
 * chosen a database yet — and `createAuth` refuses to guess rather than
 * defaulting to one, because a default would be the wrong dialect in half the
 * deployments. Call this in `beforeEach`.
 *
 * It builds the SAME adapter workers/app.ts builds, over the same real D1, so
 * the test still exercises the deployed configuration rather than a stand-in.
 */
export function installTestAuthDatabase(env: { DB: D1Database }): void {
  setAuthDatabaseFactory(() =>
    drizzleAdapter(createD1Db(env.DB), {
      provider: "sqlite",
      schema: { user, session, account, verification, twoFactor },
    }),
  );
}
