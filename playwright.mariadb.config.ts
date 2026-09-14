import { defineConfig, devices } from "@playwright/test";
import { randomUUID } from "node:crypto";

import { ADMIN } from "./tests/browser/helpers/admin-session";

/**
 * The admin suite, against the TARGET runtime.
 *
 *   npm run test:e2e:mariadb
 *
 * ── WHY A SEPARATE CONFIG AND NOT ANOTHER PROJECT ───────────────────────────
 *
 * `playwright.config.ts` starts `wrangler dev`, which runs `npm run build`.
 * This one starts the Node server, which runs `npm run build:hostinger`. Both
 * builds write to `build/client` and `build/server`, so two web servers in one
 * config would race to overwrite each other's output and the loser would serve
 * a Worker bundle from Node, or the reverse. Not a hypothetical: the Node build
 * disappeared mid-session exactly this way while the D1 suite was running.
 *
 * One config, one runtime, one build directory at a time. Run them one after
 * the other, never together.
 *
 * ── WHAT THIS ANSWERS ───────────────────────────────────────────────────────
 *
 * Every performance number and every schema test in this migration was taken
 * against MariaDB, but the admin BROWSER suite ran against `wrangler dev` and
 * D1 the whole way through. So the screens a merchant actually uses had never
 * been rendered from the database they will be served from. That gap is named
 * as "not done" in three documents; this closes it.
 *
 * It runs `admin.spec.ts` — every screen, the navigation, the axe sweep, and
 * the create-a-product flow. Not the whole suite: the workflow tests assert
 * behaviour, and behaviour that differs between two SQL engines would already
 * have failed the 37 MariaDB integration tests. What has never been exercised
 * is the RENDERING path — loaders, translated SQL, real driver types — and
 * that is what these screens do on every one of their queries.
 *
 * ── THE DATABASE ────────────────────────────────────────────────────────────
 *
 * `zamzam_e2e`, dropped and rebuilt on every run from the MariaDB migrations
 * and the same demo seed the D1 suite uses, translated statement by statement.
 * It is never `zamzam_staging`: that one holds the migrated real catalogue, and
 * the seeder refuses any `--reset` target whose name lacks "e2e" or "test".
 */

const PORT = Number(process.env.MARIADB_E2E_PORT ?? 3211);
const BASE_URL = `http://127.0.0.1:${PORT}`;

/**
 * Fresh every run, and never written down.
 *
 * The same reasoning as `playwright.config.ts`: a signing key that lives in the
 * repository is a signing key, whatever the file is called. Sessions signed
 * with these last exactly as long as the throwaway database beside them.
 */
const throwaway = () => `${randomUUID()}${randomUUID()}`;

export default defineConfig({
  testDir: "tests/browser",
  fullyParallel: true,

  // One worker. A second Node process is not the point of this run, and the
  // whole reason it exists is to avoid measuring contention instead of the
  // runtime.
  workers: 1,

  retries: process.env.CI ? 1 : 0,
  forbidOnly: !!process.env.CI,

  // The install-and-enrol flow may wait out several thirty-second TOTP windows.
  timeout: 180_000,
  reporter: [["list"]],

  use: {
    baseURL: BASE_URL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    locale: "it-IT",
    timezoneId: "Europe/Rome",
  },

  projects: [
    { name: "setup", testMatch: /auth\.setup\.ts/ },
    {
      name: "mariadb",
      testMatch: /admin\.spec\.ts/,
      use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 800 } },
      dependencies: ["setup"],
    },
  ],

  webServer: {
    /*
     * Build, prepare the database, then serve — in that order, in one command,
     * because Playwright starts a web server rather than a pipeline.
     *
     * `--reset` drops and recreates `zamzam_e2e`. Every run therefore starts
     * with no administrator, which is what lets `auth.setup.ts` exercise the
     * real first-run install: the setup route closes itself permanently once
     * an account exists, so a re-used database makes the flow untestable.
     */
    command: [
      "npm run build:hostinger",
      "node scripts/hostinger/seed-mariadb.mjs --database zamzam_e2e --reset",
      "node build/server-node/index.js",
    ].join(" && "),
    url: `${BASE_URL}/api/health`,
    reuseExistingServer: false,
    timeout: 240_000,
    stdout: "pipe",
    stderr: "pipe",
    env: {
      NODE_ENV: "development",
      APP_ENV: "test",
      APP_BASE_URL: BASE_URL,
      HOST: "127.0.0.1",
      PORT: String(PORT),
      TRUSTED_HOSTS: `127.0.0.1:${PORT},localhost:${PORT}`,

      DB_HOST: process.env.TEST_DB_HOST ?? "127.0.0.1",
      DB_PORT: String(process.env.TEST_DB_PORT ?? 3399),
      DB_NAME: "zamzam_e2e",
      DB_USER: process.env.TEST_DB_USER ?? "root",
      DB_PASSWORD: process.env.TEST_DB_PASSWORD ?? "",
      DB_SSL: "off",
      DB_CONNECTION_LIMIT: "8",

      PUBLIC_MEDIA_ROOT: ".local/e2e/public",
      PRIVATE_MEDIA_ROOT: ".local/e2e/private",

      BETTER_AUTH_SECRET: throwaway(),
      SETTINGS_ENCRYPTION_KEY: throwaway(),
      /*
       * The same token `tests/browser/helpers/admin-session.ts` submits.
       *
       * Imported rather than copied: two literals that must match and live in
       * different files stop matching, and the symptom is an install that
       * silently refuses on a page nobody looks at.
       */
      INITIAL_ADMIN_SETUP_TOKEN: ADMIN.setupToken,
      TOTP_ISSUER: "Covers by Mobile Zam Zam (e2e)",
    },
  },
});
