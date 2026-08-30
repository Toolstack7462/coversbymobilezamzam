import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: {
    alias: {
      "~": fileURLToPath(new URL("./app", import.meta.url)),
      "@db": fileURLToPath(new URL("./db", import.meta.url)),
    },
  },
  test: {
    name: "unit",
    environment: "node",
    include: ["tests/unit/**/*.test.ts"],
    // A domain test that reaches for a binding has escaped its layer.
    globals: false,
  },
});
