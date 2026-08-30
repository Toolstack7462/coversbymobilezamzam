import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";

export default tseslint.config(
  {
    ignores: [
      "node_modules/**",
      "build/**",
      "dist/**",
      ".react-router/**",
      ".wrangler/**",
      "coverage/**",
      "playwright-report/**",
      "test-results/**",
      "db/migrations/**",
      "worker-configuration.d.ts",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.{ts,tsx}"],
    plugins: { "react-hooks": reactHooks },
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/consistent-type-imports": [
        "error",
        { prefer: "type-imports", fixStyle: "inline-type-imports" },
      ],
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",

      // Money is integer minor units. A float creeping into a total is the kind
      // of bug that is invisible until a customer is charged the wrong amount.
      "no-restricted-globals": [
        "error",
        {
          name: "parseFloat",
          message: "Money is integer minor units. See docs/invariants.md INVARIANT 1.",
        },
      ],
      // Dates must be constructed through the Clock port so tests can freeze
      // time and so reservation expiry is deterministic.
      "no-restricted-syntax": [
        "error",
        {
          selector: "NewExpression[callee.name='Date'][arguments.length=0]",
          message: "Use the Clock port instead of new Date(). See docs/invariants.md INVARIANT 10.",
        },
      ],
    },
  },
  {
    // Infrastructure, scripts and tests are allowed the real clock.
    files: [
      "app/infrastructure/**/*.ts",
      "scripts/**/*.{ts,mjs,js}",
      "tests/**/*.ts",
      "workers/**/*.ts",
    ],
    rules: { "no-restricted-syntax": "off" },
  },
  {
    // Node scripts and hooks: plain Node globals, not the Workers runtime.
    files: ["scripts/**/*.mjs", ".claude/hooks/**/*.mjs", "*.config.{js,ts}"],
    languageOptions: {
      globals: {
        process: "readonly",
        console: "readonly",
        URL: "readonly",
        Buffer: "readonly",
        __dirname: "readonly",
      },
    },
    rules: { "@typescript-eslint/no-explicit-any": "off" },
  },
);
