/**
 * What the deployed Worker actually spends on CPU.
 *
 * The free plan allows **10ms of CPU per invocation** — for an HTTP request and
 * for a Cron Trigger alike. Not wall time: a request that waits 400ms for D1
 * and R2 spends almost none of that on CPU, so response time says nothing about
 * whether a request is near the limit.
 *
 * Going over does not slow a request down. It terminates it, returning
 * Cloudflare error 1102 to the customer, and shows up here as an `exceededCpu`
 * outcome.
 *
 * A single invocation over the limit does NOT prove this, and a run of them
 * passing does not prove the opposite. Cloudflare's documented behaviour is
 * that an isolate has "some built-in flexibility to allow for cases where your
 * Worker infrequently runs over the configured limit", and terminates only once
 * a Worker "starts hitting the limit consistently". So a peak above 10ms is a
 * warning about what happens under sustained traffic, not a fault you can watch
 * happen on a quiet preview.
 *
 * Reads the JSON stream that `wrangler tail` produces:
 *
 *   npx wrangler tail --env preview --format json > tail.jsonl
 *   # …drive traffic against the deployed URL…
 *   node scripts/verify/cpu-report.mjs tail.jsonl
 *
 * Two steps rather than one because tailing and driving traffic have to happen
 * at the same time, and because the traffic worth measuring is real traffic —
 * a script hitting its own list of URLs measures the list, not the shop.
 */
import { readFileSync } from "node:fs";

// The free-plan ceiling. Exceeding it terminates the request.
const LIMIT_MS = 10;
// Anything past this is not failing yet but has no room for a slow day.
const WARN_MS = 7;

const path = process.argv[2];
if (!path) {
  console.error("Usage: node scripts/verify/cpu-report.mjs <tail.jsonl>");
  process.exit(1);
}

/*
 * `wrangler tail --format json` pretty-prints each event, so this is a stream
 * of concatenated multi-line objects rather than one JSON document or one
 * object per line. Split on a closing brace in the first column, which is where
 * each object ends and nothing else appears.
 */
const events = readFileSync(path, "utf8")
  .split(/^\}$/m)
  .map((chunk) => chunk.trim())
  .filter((chunk) => chunk.startsWith("{"))
  .map((chunk) => {
    try {
      return JSON.parse(`${chunk}\n}`);
    } catch {
      // A tail that was cut off mid-object leaves one unparseable tail chunk.
      return null;
    }
  })
  .filter(Boolean);

if (events.length === 0) {
  console.error(`No complete events in ${path}. Was the tail running while traffic ran?`);
  process.exit(1);
}

/** Group by what was being served, not by individual URL. */
function label(event) {
  if (event.event?.cron) return `cron ${event.event.cron}`;
  const url = event.event?.request?.url;
  if (!url) return "(unknown)";

  const { pathname } = new URL(url);
  // Collapse the varying part so a route is one row rather than many.
  return pathname
    .replace(/^\/en(?=\/|$)/, "/en")
    .replace(/\/prodotti\/[^/]+/, "/prodotti/:slug")
    .replace(/\/ordine\/[^/]+/, "/ordine/:n")
    .replace(/\/traccia\/[^/]+/, "/traccia/:token")
    .replace(/\/assets\/.*/, "/assets/*");
}

const byRoute = new Map();
for (const event of events) {
  const key = label(event);
  if (!byRoute.has(key)) byRoute.set(key, []);
  byRoute.get(key).push({
    cpu: Number(event.cpuTime ?? 0),
    wall: Number(event.wallTime ?? 0),
    outcome: event.outcome,
  });
}

const rows = [...byRoute.entries()]
  .map(([route, samples]) => {
    const cpu = samples.map((sample) => sample.cpu).sort((a, b) => a - b);
    return {
      route,
      n: samples.length,
      max: cpu[cpu.length - 1],
      median: cpu[Math.floor(cpu.length / 2)],
      wall: Math.round(samples.reduce((sum, s) => sum + s.wall, 0) / samples.length),
      bad: samples.filter((sample) => sample.outcome !== "ok").length,
    };
  })
  .sort((a, b) => b.max - a.max);

console.log(`\nCPU per invocation — free-plan limit is ${LIMIT_MS}ms\n`);
console.log(
  `  ${"route".padEnd(34)} ${"n".padStart(4)} ${"max".padStart(6)} ${"med".padStart(5)} ${"wall".padStart(6)}`,
);
console.log(
  `  ${"-".repeat(34)} ${"-".repeat(4)} ${"-".repeat(6)} ${"-".repeat(5)} ${"-".repeat(6)}`,
);

for (const row of rows) {
  const flag = row.max >= LIMIT_MS ? " OVER" : row.max >= WARN_MS ? " near" : "";
  console.log(
    `  ${row.route.padEnd(34)} ${String(row.n).padStart(4)} ${`${row.max}ms`.padStart(6)} ` +
      `${`${row.median}`.padStart(5)} ${`${row.wall}ms`.padStart(6)}${flag}` +
      (row.bad > 0 ? `  ${row.bad} NOT ok` : ""),
  );
}

const worst = rows[0];
const overLimit = rows.filter((row) => row.max >= LIMIT_MS);
const nearLimit = rows.filter((row) => row.max >= WARN_MS && row.max < LIMIT_MS);
const failures = events.filter((event) => event.outcome !== "ok");

console.log(`\n  ${events.length} invocations, worst ${worst.max}ms on ${worst.route}`);
console.log(`  headroom: ${LIMIT_MS - worst.max}ms\n`);

if (failures.length > 0) {
  const terminated = failures.filter((event) => event.outcome === "exceededCpu");
  console.error(`  ${failures.length} invocation(s) did not end "ok":`);
  for (const event of failures.slice(0, 5)) {
    console.error(`    ${event.outcome}  ${label(event)}`);
  }
  if (terminated.length > 0) {
    // Not a warning any more. These requests were killed and the customer got
    // a Cloudflare error page instead of the shop.
    console.error(
      `\n  ${terminated.length} were TERMINATED for exceeding CPU. Customers saw error 1102.`,
    );
  }
  console.error("");
}

if (overLimit.length > 0) {
  console.error("OVER THE FREE-PLAN LIMIT — these requests are being terminated:\n");
  for (const row of overLimit) console.error(`  ${row.route} — ${row.max}ms`);
  console.error("");
  process.exit(1);
}

if (nearLimit.length > 0) {
  console.log(`Within the limit, but ${nearLimit.length} route(s) are above ${WARN_MS}ms and have`);
  console.log("little room left. Worth knowing before traffic, not after.\n");
}
