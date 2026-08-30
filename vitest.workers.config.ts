import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineWorkersProject, readD1Migrations } from "@cloudflare/vitest-pool-workers/config";

const here = path.dirname(fileURLToPath(import.meta.url));

export default defineWorkersProject(async () => {
  // The same migration files Wrangler applies in production. Tests that run
  // against a hand-written CREATE TABLE prove nothing about the schema that
  // actually ships.
  const migrations = await readD1Migrations(path.join(here, "db/migrations"));

  return {
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
      poolOptions: {
        workers: {
          // Isolated storage gives every test a clean database and rolls back
          // afterwards, so tests cannot leak state into each other.
          isolatedStorage: true,
          singleWorker: true,
          wrangler: { configPath: "./wrangler.jsonc" },
          miniflare: {
            bindings: { TEST_MIGRATIONS: migrations },
          },
        },
      },
    },
  };
});
