/**
 * `npm run verify` — the only gate that counts.
 *
 * Runs every check in order, stops at the first failure, and reports what
 * actually happened. Nothing in this project is described as verified unless
 * this command exited 0.
 *
 * Ordered cheapest-first so a formatting slip fails in seconds rather than
 * after a four-minute browser run.
 */
import { spawnSync } from "node:child_process";

const STEPS = [
  { name: "Format check", command: "npm", args: ["run", "format:check"] },
  { name: "Lint", command: "npm", args: ["run", "lint"] },
  { name: "Typecheck", command: "npm", args: ["run", "typecheck"] },
  { name: "Locale parity", command: "npm", args: ["run", "locales:check"] },
  { name: "Migration check", command: "npm", args: ["run", "migrations:check"] },
  { name: "Unit tests", command: "npm", args: ["run", "test:unit"] },
  { name: "Integration tests", command: "npm", args: ["run", "test:integration"] },
  { name: "Build", command: "npm", args: ["run", "build"] },
  { name: "Bundle budgets", command: "npm", args: ["run", "budgets"] },
  { name: "Secret scan", command: "npm", args: ["run", "secret-scan"] },
];

const results = [];
const startedAt = Date.now();

for (const step of STEPS) {
  process.stdout.write(`\n▸ ${step.name}\n`);
  const started = Date.now();

  // `shell: true` is required on Windows, where npm is a .cmd shim that Node
  // refuses to spawn directly. It is safe HERE and only here: every command and
  // argument above is a hardcoded literal, with nothing interpolated from a
  // path, an argument or the environment.
  const result = spawnSync(step.command, step.args, {
    stdio: "inherit",
    shell: true,
  });

  const seconds = ((Date.now() - started) / 1000).toFixed(1);
  const ok = result.status === 0;
  results.push({ name: step.name, ok, seconds });

  if (!ok) {
    // Stop here. Continuing past a failure produces a wall of noise in which
    // the real cause is the easiest thing to miss.
    console.error(`\n✗ ${step.name} FAILED (exit ${result.status}) after ${seconds}s`);
    printSummary(results, startedAt, false);
    process.exit(1);
  }
}

printSummary(results, startedAt, true);

function printSummary(rows, from, passed) {
  const total = ((Date.now() - from) / 1000).toFixed(1);
  console.log("\n" + "─".repeat(52));
  for (const row of rows) {
    console.log(`  ${row.ok ? "PASS" : "FAIL"}  ${row.name.padEnd(22)} ${row.seconds}s`);
  }
  console.log("─".repeat(52));
  console.log(
    passed
      ? `  VERIFIED — ${rows.length} checks in ${total}s`
      : `  NOT VERIFIED — stopped after ${rows.length} checks (${total}s)`,
  );
  console.log(
    passed
      ? "\n  Note: this does NOT cover browser tests, deployed-preview performance,\n  or a tested backup restore. See docs/launch-checklist.md.\n"
      : "",
  );
}
