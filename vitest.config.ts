import { defineConfig } from "vitest/config";

// Two projects, because they answer different questions.
//
// `unit` runs the domain layer in plain Node. It is fast and has no bindings,
// which is the point: if a domain rule needs D1 to be tested, the rule is in the
// wrong layer.
//
// `workers` runs inside workerd via @cloudflare/vitest-pool-workers, against a
// real D1 with the real migrations applied. Repository behaviour, batch
// rollback, conditional writes and RBAC are only meaningful there - a mocked
// database would happily accept the oversell this project exists to prevent.
export default defineConfig({
  test: {
    projects: ["./vitest.unit.config.ts", "./vitest.workers.config.ts"],
  },
});
