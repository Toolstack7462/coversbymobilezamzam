/**
 * Build and deploy the PREVIEW environment.
 *
 * ── Why this script exists at all ────────────────────────────────────────────
 *
 * `wrangler deploy --env preview` looks like the obvious command and is WRONG
 * for this project. The Cloudflare Vite plugin resolves the environment at
 * BUILD time and writes a flattened `build/server/wrangler.json` with no `env`
 * key at all; `wrangler deploy` then reads that file. So `--env preview` finds
 * no environment to select and silently deploys the BASE configuration —
 * pointing at the base D1 database, with `APP_ENV: "development"`, and no
 * indication that anything went wrong.
 *
 * That is a deploy that succeeds while doing the wrong thing, which is the
 * worst kind. The environment is selected with `CLOUDFLARE_ENV` before the
 * build, and this script is here so that fact lives in the repository rather
 * than in somebody's memory.
 *
 * A plain `CLOUDFLARE_ENV=preview npm run build` does not work on Windows,
 * where npm runs scripts through cmd and the `VAR=value command` form is not
 * understood. A four-line Node script beats adding a dependency to set one
 * environment variable.
 *
 *   node scripts/deploy/preview.mjs           build only
 *   node scripts/deploy/preview.mjs --deploy  build, verify, then deploy
 */
import { spawnSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";

const ENVIRONMENT = "preview";
const EXPECTED_WORKER = "italian-tech-atelier-commerce-preview";
const GENERATED_CONFIG = "build/server/wrangler.json";

const shouldDeploy = process.argv.includes("--deploy");

function run(command, args, extraEnv = {}) {
  const result = spawnSync(command, args, {
    stdio: "inherit",
    // Windows needs a shell to resolve `npx`/`npm` shims; every argument here
    // is a hardcoded literal, so nothing user-supplied reaches it.
    shell: true,
    env: { ...process.env, ...extraEnv },
  });
  if (result.status !== 0) {
    console.error(`\n${command} ${args.join(" ")} failed with code ${result.status}.`);
    process.exit(result.status ?? 1);
  }
}

console.log(`Building for CLOUDFLARE_ENV=${ENVIRONMENT}…\n`);
run("npx", ["react-router", "build"], { CLOUDFLARE_ENV: ENVIRONMENT });

/*
 * Verify the build actually resolved the environment we asked for.
 *
 * This is the check that would have caught the silent-base-deploy above, and it
 * runs on every deploy rather than on the days somebody remembers to look.
 */
if (!existsSync(GENERATED_CONFIG)) {
  console.error(`\nNo ${GENERATED_CONFIG}. The Cloudflare Vite plugin did not run.`);
  process.exit(1);
}

const config = JSON.parse(readFileSync(GENERATED_CONFIG, "utf8"));
const problems = [];

if (config.name !== EXPECTED_WORKER) {
  problems.push(`Worker name is "${config.name}", expected "${EXPECTED_WORKER}".`);
}
if (config.vars?.APP_ENV !== ENVIRONMENT) {
  problems.push(`APP_ENV is "${config.vars?.APP_ENV}", expected "${ENVIRONMENT}".`);
}

// The single most damaging possible mistake: a preview Worker bound to a
// database that is not the preview database.
const database = config.d1_databases?.[0]?.database_name;
if (database !== "ita-commerce-preview-db") {
  problems.push(`D1 binding is "${database}", expected "ita-commerce-preview-db".`);
}

const buckets = (config.r2_buckets ?? []).map((b) => b.bucket_name);
for (const expected of ["ita-commerce-preview-media", "ita-commerce-preview-proofs"]) {
  if (!buckets.includes(expected)) problems.push(`R2 bucket "${expected}" is not bound.`);
}

/*
 * The plugin records which environment it resolved. This is a far better check
 * than scanning the file for the word "production" — which was the first
 * version of this guard, and which failed instantly because the plugin also
 * records the LIST of defined environments, production among them. A guard that
 * cries wolf gets deleted; this one asks the question directly.
 */
if (config.configPath && config.targetEnvironment !== ENVIRONMENT) {
  problems.push(
    `Plugin resolved targetEnvironment "${config.targetEnvironment}", expected "${ENVIRONMENT}".`,
  );
}

// No RESOURCE may carry a production-ish name. Checked against the names
// themselves rather than the whole file, so plugin metadata cannot trip it.
//
// `prod` matches `production` too, so one alternative covers both. The first
// version wrote `prod\b` and, through a shell-escaping mistake, emitted a
// literal backspace character instead of a word boundary — a regex that could
// never match, so the guard was silently dead. Caught by the lint rule against
// control characters in regular expressions.
const resourceNames = [config.name, database, ...buckets].filter(Boolean);
for (const name of resourceNames) {
  if (/prod|live/i.test(name)) {
    problems.push(`Resource "${name}" looks like a production resource. Refusing to deploy.`);
  }
}

if (problems.length > 0) {
  console.error("\nThe build did NOT resolve the preview environment:\n");
  for (const problem of problems) console.error(`  - ${problem}`);
  console.error("\nRefusing to deploy. See docs/cloudflare/preview-deployment.md.");
  process.exit(1);
}

console.log(`\nBuild verified:`);
console.log(`  worker    ${config.name}`);
console.log(`  APP_ENV   ${config.vars.APP_ENV}`);
console.log(`  database  ${database}`);
console.log(`  buckets   ${buckets.join(", ")}`);
console.log(`  crons     ${(config.triggers?.crons ?? []).join(", ") || "none"}`);
console.log(`  workers.dev ${config.workers_dev === true ? "enabled" : "disabled"}`);

if (!shouldDeploy) {
  console.log("\nBuild only. Pass --deploy to publish.");
  process.exit(0);
}

console.log("\nDeploying…\n");
// No `--env`: the generated config has no environments, and passing one would
// be the mistake this script exists to prevent.
run("npx", ["wrangler", "deploy"]);
