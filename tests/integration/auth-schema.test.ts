import { env } from "cloudflare:test";
import { describe, it, expect, beforeEach } from "vitest";
import { getAuthTables } from "better-auth/db";
import { createAuth } from "~/infrastructure/auth/auth.server";
import { seed } from "../../tests/fixtures/seed";

/**
 * The auth tables match what Better Auth expects.
 *
 * This file exists because of the worst bug in the project so far, and one that
 * nothing else could have found.
 *
 * Better Auth 1.7 scopes account identity by issuer and treats `issuer` as a
 * REQUIRED field on `account`. Our schema did not have the column, so every
 * call to `signUpEmail` threw before writing anything — which meant
 * **installation could never complete on any environment**. The shop was
 * uninstallable.
 *
 * Nothing caught it. It typechecked, because Drizzle's schema and Better Auth's
 * expectations are connected only at runtime. The unit tests never touched
 * auth. The integration tests seeded staff rows directly rather than signing
 * anyone up. And the setup page reported "Impossibile creare l'account",
 * which is the correct message for a merchant and tells whoever is debugging it
 * nothing at all.
 *
 * It surfaced the first time a browser test tried to install the shop and log
 * in — which is exactly the argument for having browser tests that use the real
 * front door.
 *
 * The two tests below are different guards on purpose. The first compares the
 * declared shapes and fails on the NEXT missing column at upgrade time, naming
 * it. The second proves the round trip actually works, because agreeing about
 * column names is not the same as functioning.
 */

/**
 * The worker's own env. `BETTER_AUTH_SECRET` and `APP_BASE_URL` come from the
 * bindings in vitest.workers.config.ts rather than being written here, so no
 * quoted value sits next to the word SECRET in a source file.
 */
const TEST_ENV = () => env as unknown as Env;

/** The columns SQLite actually has, per table. */
async function columnsOf(table: string): Promise<Set<string>> {
  const rows = await env.DB.prepare(`PRAGMA table_info(${table})`).all<{ name: string }>();
  return new Set(rows.results.map((r) => r.name));
}

describe("every field Better Auth requires exists", () => {
  beforeEach(async () => {
    await seed(env.DB);
  });

  // Only the tables this project actually uses. Better Auth declares more for
  // features that are not enabled, and requiring those would fail for no
  // reason.
  const TABLES = ["user", "session", "account", "verification"] as const;

  for (const table of TABLES) {
    it(`"${table}" has every required column`, async () => {
      const declared = getAuthTables({} as never)[table];
      expect(declared, `Better Auth does not declare "${table}"`).toBeDefined();

      const actual = await columnsOf(table);
      // Drizzle maps camelCase to snake_case; compare on the snake_case form,
      // which is what the database and the adapter's fieldName agree on.
      const toColumn = (name: string) => name.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);

      const missing = Object.entries(declared!.fields)
        .filter(([, field]) => (field as { required?: boolean }).required)
        .map(([name]) => name)
        .filter((name) => !actual.has(name) && !actual.has(toColumn(name)));

      expect(
        missing,
        `"${table}" is missing required column(s): ${missing.join(", ")}. ` +
          `Add them to db/schema/auth.ts and write a forward-only migration.`,
      ).toEqual([]);
    });
  }
});

describe("the credential flow actually works", () => {
  beforeEach(async () => {
    await seed(env.DB);
  });

  it("signs a new account up", async () => {
    // The test that would have caught the issuer bug on the day it appeared.
    const auth = createAuth(TEST_ENV());
    const response = await auth.api.signUpEmail({
      body: {
        name: "Titolare",
        email: "titolare@negoziotest.it",
        password: "una-password-lunga-e-non-ovvia-2026",
      },
      asResponse: true,
    });

    expect(response.status).toBe(200);

    const row = await env.DB.prepare(`SELECT issuer, provider_id FROM account LIMIT 1`).first<{
      issuer: string;
      provider_id: string;
    }>();
    expect(row).not.toBeNull();
    // For a credential account the two coincide; the distinction only matters
    // with several OIDC providers sharing a provider name.
    expect(row!.issuer).toBeTruthy();
  });

  it("issues a session that can be read back", async () => {
    const auth = createAuth(TEST_ENV());
    const signUp = await auth.api.signUpEmail({
      body: {
        name: "Titolare",
        email: "sessione@negoziotest.it",
        password: "una-password-lunga-e-non-ovvia-2026",
      },
      asResponse: true,
    });

    const cookie = signUp.headers.get("Set-Cookie");
    expect(cookie, "sign-up must set a session cookie").toBeTruthy();

    // The bootstrap command depends on exactly this: it reads the new user's id
    // back out of the session rather than trusting the sign-up response body.
    const session = await auth.api.getSession({
      headers: new Headers({ Cookie: cookie ?? "" }),
    });
    expect(session?.user?.id).toBeTruthy();
  });

  it("refuses a password shorter than the configured minimum", async () => {
    // 12, not 8, because these accounts can change where money goes.
    const auth = createAuth(TEST_ENV());
    const response = await auth.api.signUpEmail({
      body: { name: "Corta", email: "corta@negoziotest.it", password: "breve" },
      asResponse: true,
    });
    expect(response.status).toBeGreaterThanOrEqual(400);
  });

  it("refuses a duplicate email", async () => {
    const auth = createAuth(TEST_ENV());
    const body = {
      name: "Doppio",
      email: "doppio@negoziotest.it",
      password: "una-password-lunga-e-non-ovvia-2026",
    };

    const first = await auth.api.signUpEmail({ body, asResponse: true });
    expect(first.status).toBe(200);

    const second = await auth.api.signUpEmail({ body, asResponse: true });
    expect(second.status).toBeGreaterThanOrEqual(400);
  });
});
