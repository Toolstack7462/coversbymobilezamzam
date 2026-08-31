import { defineConfig, devices } from "@playwright/test";

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
const BASE_URL = `http://127.0.0.1:${PORT}`;

export default defineConfig({
  testDir: "tests/browser",
  // Every spec here asserts on rendered output; none mutate shared state, so
  // they can run together.
  fullyParallel: true,

  // A test that only passes on the third attempt is a flaky test, and a flaky
  // test that is allowed to retry locally is a flaky test nobody ever fixes.
  retries: process.env.CI ? 1 : 0,

  // `.only` left in a file silently narrows CI to one test.
  forbidOnly: !!process.env.CI,

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
    {
      name: "desktop",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 800 } },
    },
    {
      // The real target device for this shop's customers, and the viewport
      // where the admin tables collapse into cards.
      name: "mobile",
      use: { ...devices["Pixel 7"] },
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
      "npm run build",
      `npx wrangler d1 migrations apply ${DB} --local --persist-to ${PERSIST_TO}`,
      `node scripts/import/seed.mjs --persist-to ${PERSIST_TO}`,
      `npx wrangler dev --port ${PORT} --local --persist-to ${PERSIST_TO}`,
    ].join(" && "),
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    stdout: "pipe",
    stderr: "pipe",
  },
});
