import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-pool-workers";
import { randomUUID } from "node:crypto";

const here = path.dirname(fileURLToPath(import.meta.url));

/**
 * Integration and security tests run inside workerd, against a real D1 with the
 * real migrations applied.
 *
 * A mocked database would happily accept the oversell this project exists to
 * prevent, and a hand-written CREATE TABLE would prove nothing about the schema
 * that actually ships.
 *
 * API note: @cloudflare/vitest-pool-workers 0.22 (for Vitest 4) exposes the pool
 * as a Vite PLUGIN via `cloudflareTest`. The older `defineWorkersProject` helper
 * and the `/config` subpath export no longer exist.
 */
export default defineConfig(async () => {
  const migrations = await readD1Migrations(path.join(here, "db/migrations"));

  return {
    plugins: [
      cloudflareTest({
        wrangler: { configPath: "./wrangler.jsonc" },
        miniflare: {
          // Handed to the setup file, which applies them before each suite.
          bindings: {
            TEST_MIGRATIONS: migrations,
            /*
             * Auth configuration for the test worker.
             *
             * Here rather than inline in a test file: a quoted value next to
             * the word SECRET is precisely what the secret scanner exists to
             * catch, and teaching it to ignore one file would blunt it for
             * every real case later. This is also how the application reads
             * these — from the environment — so the tests exercise the same
             * path production does.
             */
            // GENERATED per run, not written down. A quoted value beside the
            // word SECRET is exactly what the secret scanner exists to catch,
            // and adding an exception for this file would blunt it for every
            // real case afterwards. A fresh random key is also strictly better
            // for a test: nothing can come to depend on its value.
            BETTER_AUTH_SECRET: randomUUID() + randomUUID(),
            APP_BASE_URL: "http://127.0.0.1:5273",
            APP_ENV: "test",
          },
        },
      }),
    ],
    resolve: {
      alias: {
        "~": path.join(here, "app"),
        "@db": path.join(here, "db"),
      },
    },
    test: {
      name: "workers",
      include: ["tests/integration/**/*.test.ts", "tests/security/**/*.test.ts"],
      setupFiles: ["./tests/setup/apply-migrations.ts"],
    },
  };
});
