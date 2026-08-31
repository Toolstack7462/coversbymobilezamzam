import { defineConfig, devices } from "@playwright/test";
import { randomUUID } from "node:crypto";

/**
 * Browser tests.
 *
 * This file did not exist until now, while `package.json` had declared
 * `"test:e2e": "playwright test"` for some time. The script would simply have
 * failed if anyone ran it — and nobody did, because it is not part of
 * `npm run verify`. That is exactly how a project comes to believe it has
 * browser coverage it does not have, so the honest fix is this config plus real
 * specs, not deleting the script.
 *
 * **These tests are deliberately NOT in `npm run verify`.** They need a built
 * app, a local D1 with migrations applied, and roughly a minute of browser
 * startup. Putting that in the gate every developer runs on every change would
 * make the gate something people skip. `verify` stays fast and honest about
 * what it does not cover; this runs separately and in CI.
 *
 * Run: `npm run test:e2e` (add `--ui` to watch it).
 */

const PORT = 5273;
const DB = "ita-commerce";
const PERSIST_TO = ".wrangler/e2e";
/** Mirrors ADMIN.setupToken in tests/browser/helpers/admin-session.ts. */
const SETUP_TOKEN = "test-setup-token-che-non-e-un-segreto-reale";
/**
 * Generated per run rather than written down — see the note in
 * vitest.workers.config.ts. Sessions signed with it live only as long as the
 * throwaway database beside them.
 */
const AUTH_SECRET = randomUUID() + randomUUID();
const BASE_URL = `http://127.0.0.1:${PORT}`;

export default defineConfig({
  testDir: "tests/browser",
  fullyParallel: true,

  /*
   * Two workers, not the six Playwright picks by default.
   *
   * Everything behind this suite is ONE `wrangler dev` process backed by ONE
   * SQLite file. Six browsers hammering it does not test the application; it
   * tests the harness, and it lost: the server died partway through a run and
   * Playwright reported "50 passed" while quietly not running thirty-seven
   * tests, plus a spurious 500 from a route that passes in isolation.
   *
   * A summary that says "passed" while a third of the suite never ran is worse
   * than a slow suite. Two workers finish in about three minutes and finish
   * every time.
   */
  workers: 2,

  // A test that only passes on the third attempt is a flaky test, and a flaky
  // test that is allowed to retry locally is a flaky test nobody ever fixes.
  retries: process.env.CI ? 1 : 0,

  // `.only` left in a file silently narrows CI to one test.
  forbidOnly: !!process.env.CI,

  /*
   * Three minutes, not the default thirty seconds.
   *
   * The sign-in flow may have to wait out several thirty-second TOTP windows:
   * codes are single-use, enrolment is immediately followed by a login
   * challenge, and the challenge retries across windows rather than weakening
   * replay protection to be fast. Ninety seconds was borderline — it passed,
   * then timed out on the next run, which is the worst kind of limit.
   *
   * Only the setup project spends this; everything after it finishes in
   * seconds because it reuses the saved session.
   */
  timeout: 180_000,

  reporter: process.env.CI ? [["github"], ["list"]] : [["list"]],

  use: {
    baseURL: BASE_URL,
    // Traces only on a failure that survived its retry: they are large, and
    // the ones from a passing run are never opened.
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    // The storefront is Italian; a browser claiming otherwise would exercise a
    // path no real customer of this shop takes.
    locale: "it-IT",
    timezoneId: "Europe/Rome",
  },

  projects: [
    /*
     * Installs the shop and enrols in two-factor once, saving the cookies for
     * everything that follows.
     *
     * Each admin test used to do this for itself, which broke the moment
     * Playwright split the describes across workers: the TOTP secret lives in
     * module scope, and the second worker could not answer a challenge for an
     * account it had never enrolled. Running it once as a dependency is both
     * more reliable and closer to how a shop actually works — install once,
     * stay signed in.
     */
    { name: "setup", testMatch: /auth\.setup\.ts/ },

    {
      name: "desktop",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 800 } },
      dependencies: ["setup"],
    },
    {
      // The real target device for this shop's customers, and the viewport
      // where the admin tables collapse into cards.
      name: "mobile",
      use: { ...devices["Pixel 7"] },
      dependencies: ["setup"],
    },
  ],

  webServer: {
    /*
     * The built app, not the dev server: dev-mode HMR wrappers and unminified
     * output are not what anyone ships, and testing them proves less.
     *
     * The database is a throwaway in `.wrangler/e2e`, migrated and seeded on
     * every run. It is deliberately separate from the developer's own local D1
     * — a browser suite that mutates the data someone is working with is a
     * suite people stop running. Both steps are idempotent, so this is safe to
     * repeat and works from a clean checkout.
     */
    command: [
      /*
       * A FRESH database every run.
       *
       * The two-factor secret is displayed exactly once, during enrolment, and
       * never again — which is correct for a real account and means the setup
       * project can only capture it on a first install. Re-running against a
       * database that already has an enrolled administrator leaves the suite
       * unable to answer its own challenge.
       *
       * Wiping is safe because this database is only ever the browser suite's:
       * `npm run dev` uses .wrangler/state, which is untouched.
       */
      `node -e "require('node:fs').rmSync('${PERSIST_TO}',{recursive:true,force:true})"`,
      "npm run build",
      `npx wrangler d1 migrations apply ${DB} --local --persist-to ${PERSIST_TO}`,
      `node scripts/import/seed.mjs --persist-to ${PERSIST_TO}`,
      /*
       * Secrets are passed inline rather than through a .dev.vars file: there is
       * nothing to create before running the suite, nothing lands in git, and
       * every value is visibly a test one.
       *
       * BETTER_AUTH_SECRET is required — without it account creation fails, and
       * the install page reports only "could not create the account", which is
       * correct for a merchant and unhelpful for whoever is debugging the
       * suite. That cost an hour; it is now impossible to hit.
       */
      `npx wrangler dev --port ${PORT} --local --persist-to ${PERSIST_TO}` +
        ` --var INITIAL_ADMIN_SETUP_TOKEN:${SETUP_TOKEN}` +
        ` --var BETTER_AUTH_SECRET:${AUTH_SECRET}` +
        ` --var APP_BASE_URL:${BASE_URL}` +
        ` --var APP_ENV:test`,
    ].join(" && "),
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    stdout: "pipe",
    stderr: "pipe",
  },
});
