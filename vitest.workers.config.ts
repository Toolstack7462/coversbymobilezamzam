import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-pool-workers";

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
          bindings: { TEST_MIGRATIONS: migrations },
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
