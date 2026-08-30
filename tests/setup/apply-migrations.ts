import { applyD1Migrations, env } from "cloudflare:test";
import { beforeAll } from "vitest";

/**
 * Applies the project's real migration files to the test D1 before any test
 * runs. TEST_MIGRATIONS is injected by vitest.workers.config.ts from
 * db/migrations - the same files Wrangler applies in production.
 */
beforeAll(async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
});
