import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

/**
 * MariaDB integration tests.
 *
 * A separate project from `unit` and `workers` because these need the Node
 * runtime and a live server, and because they must be able to FAIL LOUDLY when
 * the database is absent rather than being skipped. A suite that silently
 * skips is how "all tests pass" gets reported for a database nobody connected
 * to.
 *
 * Start the server with `npm run mariadb:start` first, or point TEST_DB_* at
 * any MariaDB of the target version.
 */
export default defineConfig({
  resolve: {
    alias: {
      "~": fileURLToPath(new URL("./app", import.meta.url)),
      "@db": fileURLToPath(new URL("./db", import.meta.url)),
    },
  },
  test: {
    name: "mariadb",
    include: ["tests/mariadb/**/*.test.ts"],
    environment: "node",
    // One file at a time. These tests share one schema and truncate tables
    // between cases; running two files in parallel would have them deleting
    // each other's fixtures, and the resulting failure would look like a
    // concurrency bug in the application rather than in the test setup.
    fileParallelism: false,
    sequence: { concurrent: false },
    testTimeout: 30_000,
    hookTimeout: 120_000,
  },
});
