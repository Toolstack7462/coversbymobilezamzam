import { describe, it, expect } from "vitest";

import { loadConfig, ConfigError } from "../../server/config";

/**
 * Every required variable must be reported, and reported BEFORE the config is
 * handed back.
 *
 * ── THE BUG THIS EXISTS FOR ─────────────────────────────────────────────────
 *
 * `loadConfig` collects problems into an array and throws if the array is
 * non-empty. The four database variables were read with that same `required()`
 * helper — but inside the returned object literal, which is evaluated AFTER the
 * `if (problems.length > 0) throw` line.
 *
 * So a deployment missing `DB_HOST` got a config object back with
 * `{ host: "", user: "", password: "", name: "" }` and started normally. The
 * failure then surfaced on the first query, as a MySQL access-denied error for
 * user `''@'…'` — which reads like a credentials problem on the database server
 * and sends you to hPanel to check a password that was never the issue.
 *
 * A missing variable has to fail at startup, by name. That is the difference
 * between a one-line fix and an afternoon.
 */

/*
 * The fixture is a plain record, cast at each call site.
 *
 * NodeJS.ProcessEnv is GENERATED from the Cloudflare worker env
 * (worker-configuration.d.ts), so it makes APP_ENV, DEFAULT_LOCALE,
 * SUPPORTED_LOCALES, DEFAULT_CURRENCY and STORE_TIMEZONE mandatory and pins
 * APP_BASE_URL to a union of four literal origins. None of that is true of the
 * Node server process this function actually reads, and the whole point of
 * these tests is to hand it INCOMPLETE environments. Casting is the honest
 * move; widening the generated type to suit a test would not be.
 */
type Env = Record<string, string>;
const asEnv = (env: Env) => env as unknown as NodeJS.ProcessEnv;

/** Everything `loadConfig` requires, so a test can remove exactly one thing. */
const COMPLETE = {
  NODE_ENV: "production",
  APP_BASE_URL: "https://coversbymobile.com",
  PUBLIC_MEDIA_ROOT: "/srv/media/public",
  PRIVATE_MEDIA_ROOT: "/srv/media/private",
  // Not real. Length and shape only, so the validator has something to accept.
  BETTER_AUTH_SECRET: "x".repeat(40),
  SETTINGS_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64"),
  DB_HOST: "127.0.0.1",
  DB_USER: "app",
  DB_PASSWORD: "not-a-real-password",
  DB_NAME: "shop",
} satisfies Env;

const REQUIRED_NAMES = Object.keys(COMPLETE).filter((name) => name !== "NODE_ENV");

describe("loadConfig", () => {
  it("accepts a complete environment", () => {
    const config = loadConfig(asEnv({ ...COMPLETE }));
    expect(config.database.host).toBe("127.0.0.1");
    expect(config.database.name).toBe("shop");
  });

  /**
   * One test per variable, generated from the list.
   *
   * Written this way because the defect was not "validation is missing" — it
   * was "validation runs, and four variables are read after it". A test that
   * checked one variable would have passed against the broken version.
   */
  it.each(REQUIRED_NAMES)("refuses to start when %s is missing", (name) => {
    const env: Env = { ...COMPLETE };
    delete env[name];

    expect(() => loadConfig(asEnv(env))).toThrow(ConfigError);

    try {
      loadConfig(asEnv(env));
      expect.unreachable(`loadConfig returned a config with ${name} unset`);
    } catch (error) {
      // The message must NAME the variable. "Configuration error" sends the
      // reader to a file; "DB_HOST is not set" sends them to the one field.
      expect((error as ConfigError).problems.join("\n")).toContain(name);
    }
  });

  /**
   * An empty string is not a value.
   *
   * hPanel writes an empty string when a variable is created and left blank,
   * which is a far more common state than genuinely absent.
   */
  it.each(REQUIRED_NAMES)("treats a blank %s as missing", (name) => {
    const env: Env = { ...COMPLETE, [name]: "   " };
    expect(() => loadConfig(asEnv(env))).toThrow(ConfigError);
  });

  /**
   * Never a partially-built config.
   *
   * The specific shape of the old bug: it returned successfully with empty
   * credentials. Nothing downstream can tell that apart from a database that
   * genuinely has a blank password.
   */
  it("never returns a config carrying an empty database credential", () => {
    for (const name of ["DB_HOST", "DB_USER", "DB_PASSWORD", "DB_NAME"]) {
      const env: Env = { ...COMPLETE };
      delete env[name];

      let returned: ReturnType<typeof loadConfig> | null = null;
      try {
        returned = loadConfig(asEnv(env));
      } catch {
        // Expected.
      }

      expect(returned, `loadConfig returned despite ${name} being unset`).toBeNull();
    }
  });
});
