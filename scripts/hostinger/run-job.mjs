/**
 * Runs one scheduled job from the command line.
 *
 *   node scripts/hostinger/run-job.mjs expire-reservations
 *
 * ── WHEN TO USE THIS INSTEAD OF THE HTTP ENDPOINT ───────────────────────────
 *
 * Use it when Hostinger's cron can run `node` (capability check C-4). It opens
 * its own small connection pool, does the work and exits, so nothing depends on
 * the web application being up — which is the property that matters at 3am
 * when the thing that is broken is the web application.
 *
 * The trade is a second process and a second pool for the length of the run.
 * `DB_CONNECTION_LIMIT` is deliberately not honoured here: this takes TWO
 * connections regardless, because a job runner that can consume the web
 * application's whole connection budget is a job runner that takes the shop
 * down every five minutes. Budget those two in
 * docs/hostinger/process-and-resource-budget.md.
 *
 * If cron cannot run node, use the curl launcher against `POST /api/jobs/run`
 * instead. Both paths call the same `runJob`.
 */

import process from "node:process";

/*
 * From tools.js, never from index.js.
 *
 * `build/server-node/index.js` calls `main()` at module scope. Importing it to
 * borrow `runJob` would start a second HTTP server on the application's port
 * every time cron fires.
 */
import { createMariaDb, JOB_NAMES, runJob } from "../../build/server-node/tools.js";

const name = process.argv[2] ?? "expire-reservations";

if (!JOB_NAMES.includes(name)) {
  console.error(`Unknown job "${name}". Known jobs: ${JOB_NAMES.join(", ")}`);
  process.exit(2);
}

function required(key) {
  const value = process.env[key];
  if (value === undefined || value === "") {
    console.error(
      `${key} is not set. This runner reads the same environment as the application; ` +
        `a cron job that does not inherit it will fail here rather than silently ` +
        `connect to the wrong database.`,
    );
    process.exit(1);
  }
  return value;
}

/*
 * The password is the one variable allowed to be empty.
 *
 * It has to be DEFINED — an unset variable means the cron job did not inherit
 * the environment, and connecting anyway would reach whatever database the
 * defaults point at. But a local MariaDB with a blank root password is a real
 * configuration, and refusing it would mean this runner could never be
 * exercised anywhere it is safe to exercise it.
 */
if (process.env.DB_PASSWORD === undefined) {
  console.error("DB_PASSWORD is not set (set it to an empty string for a passwordless server).");
  process.exit(1);
}

const db = createMariaDb({
  host: required("DB_HOST"),
  port: Number(process.env.DB_PORT ?? 3306),
  user: required("DB_USER"),
  password: process.env.DB_PASSWORD,
  database: required("DB_NAME"),
  // Two: one for the work, one spare so a slow release cannot deadlock a
  // single-connection pool against itself.
  connectionLimit: 2,
});

let exitCode = 0;
try {
  const result = await runJob(name, { db });
  console.log(
    `[job] ${result.job} ${result.ok ? "ok" : "FAILED"} in ${result.ms}ms ` +
      JSON.stringify(result.detail ?? result.error),
  );
  // A non-zero exit is how cron's mail and hPanel's job history report a
  // failure. Reporting success for a job that threw is how a broken sweeper
  // goes unnoticed for a month.
  if (!result.ok) exitCode = 1;
} catch (error) {
  console.error(`[job] ${name} crashed:`, error);
  exitCode = 1;
} finally {
  await db.close();
}

process.exit(exitCode);
