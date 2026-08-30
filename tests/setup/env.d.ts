import type { D1Migration } from "@cloudflare/vitest-pool-workers";

/**
 * `cloudflare:test` types `env` as `Cloudflare.Env`, so the test-only binding is
 * added by augmenting that namespace rather than the `cloudflare:test` module.
 */
declare global {
  namespace Cloudflare {
    interface Env {
      /** Injected by vitest.workers.config.ts from db/migrations. */
      TEST_MIGRATIONS: D1Migration[];
    }
  }
}

export {};
