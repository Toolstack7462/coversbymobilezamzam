declare module "cloudflare:test" {
  import type { D1Migration } from "@cloudflare/vitest-pool-workers";

  interface ProvidedEnv extends Env {
    TEST_MIGRATIONS: D1Migration[];
  }
}
