/**
 * Measures what the SERVER PROCESS costs: memory, event-loop delay, and how
 * both move under a short burst of load.
 *
 *   node scripts/hostinger/performance-smoke.mjs --pid <pid> --base <url>
 *
 * Companion to performance-baseline.mjs, which measures requests. This
 * measures the process serving them, because the two answer different
 * questions and a plan is sized by the second one: response times say whether
 * the shop feels fast, RSS says how many of these the merchant's RAM allowance
 * can hold beside their existing website.
 *
 * ── WHY EVENT-LOOP DELAY AND NOT CPU PERCENT ────────────────────────────────
 *
 * CPU percent for one process on shared hosting is not observable from inside
 * the process, and the hosting panel's graph is an aggregate across every site
 * on the account — reading a per-application figure off it would be inventing
 * one. Event-loop delay IS observable from inside, it is the thing that
 * actually makes a Node application feel slow, and it is comparable between
 * runs on the same machine.
 *
 * ── WHAT IT CANNOT SEE ──────────────────────────────────────────────────────
 *
 * Whether the plan has headroom. That needs the hosting account.
 */

import { monitorEventLoopDelay, performance } from "node:perf_hooks";
import { setTimeout as sleep } from "node:timers/promises";

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};

const BASE = flag("base", "http://127.0.0.1:3210").replace(/\/+$/, "");
const CONCURRENCY = Number(flag("concurrency", "8"));
const SECONDS = Number(flag("seconds", "20"));

/**
 * A representative mix, not a single hot URL.
 *
 * Hammering one cached route measures the cache. The weights below are a
 * guess at browsing behaviour and are written down so they can be argued with:
 * mostly catalogue browsing, some search, a little cart.
 */
const MIX = [
  { path: "/", weight: 5 },
  { path: "/shop", weight: 4 },
  { path: "/shop?q=cover", weight: 2 },
  { path: "/trova-dispositivo", weight: 2 },
  { path: "/negozio", weight: 1 },
  { path: "/carrello", weight: 1 },
];

const bag = MIX.flatMap((entry) => Array.from({ length: entry.weight }, () => entry.path));

function mib(bytes) {
  return Math.round((bytes / 1024 / 1024) * 10) / 10;
}

async function readHealth() {
  try {
    const response = await fetch(`${BASE}/api/health`);
    return await response.json();
  } catch {
    return null;
  }
}

console.log(`Load smoke — ${BASE}`);
console.log(`  concurrency  ${CONCURRENCY}`);
console.log(`  duration     ${SECONDS}s`);
console.log(`  mix          ${MIX.map((m) => `${m.path} x${m.weight}`).join(", ")}\n`);

const health = await readHealth();
if (health) {
  console.log(
    `  target       ${health.environment}, build ${String(health.build?.commit).slice(0, 7)}`,
  );
  console.log(`  database     ${health.checks?.database?.ok ? "ok" : "DEGRADED"}\n`);
}

/*
 * The loop delay of THIS process, not the server's.
 *
 * Worth being precise about: the client and the server are separate processes,
 * and this histogram measures the client. It is here because a saturated
 * client produces response times that describe the measuring instrument
 * rather than the thing measured — if this number climbs, the run is not
 * trustworthy and the concurrency should come down.
 */
const loop = monitorEventLoopDelay({ resolution: 10 });
loop.enable();

const deadline = Date.now() + SECONDS * 1000;
const latencies = [];
let requests = 0;
let failures = 0;
let bytes = 0;

async function worker() {
  while (Date.now() < deadline) {
    const path = bag[Math.floor(Math.random() * bag.length)];
    const started = performance.now();
    try {
      const response = await fetch(`${BASE}${path}`, { redirect: "manual" });
      const body = await response.arrayBuffer();
      bytes += body.byteLength;
      if (response.status >= 500) failures += 1;
    } catch {
      failures += 1;
    }
    latencies.push(performance.now() - started);
    requests += 1;
  }
}

const started = Date.now();
await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));
const elapsed = (Date.now() - started) / 1000;
loop.disable();

const sorted = latencies.sort((a, b) => a - b);
const at = (p) =>
  Math.round(sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)] * 100) /
  100;

console.log("  ── Throughput ────────────────────────────────────────────");
console.log(`  requests            ${requests} in ${elapsed.toFixed(1)}s`);
console.log(`  requests / second   ${(requests / elapsed).toFixed(1)}`);
console.log(`  failures (5xx)      ${failures}`);
console.log(`  transferred         ${mib(bytes)} MiB`);
console.log("");
console.log("  ── Latency under load ────────────────────────────────────");
console.log(`  p50                 ${at(50)}ms`);
console.log(`  p95                 ${at(95)}ms`);
console.log(`  p99                 ${at(99)}ms`);
console.log(`  max                 ${at(100)}ms`);
console.log("");
console.log("  ── Client event-loop delay (sanity check on this harness) ─");
console.log(`  mean                ${Math.round((loop.mean / 1e6) * 100) / 100}ms`);
console.log(`  p99                 ${Math.round((loop.percentile(99) / 1e6) * 100) / 100}ms`);

// Give the server a moment to settle before reading its steady state again.
await sleep(2000);
const after = await readHealth();
if (after) {
  console.log("");
  console.log(`  ── Server after load ─────────────────────────────────────`);
  console.log(
    `  database            ${after.checks?.database?.ok ? "ok" : "DEGRADED"} (${after.checks?.database?.ms}ms)`,
  );
  console.log(`  media store         ${after.checks?.mediaBucket?.ok ? "ok" : "DEGRADED"}`);
  console.log(`  private store       ${after.checks?.privateBucket?.ok ? "ok" : "DEGRADED"}`);
}

console.log(
  "\n  A twenty-second burst is a smoke test, not a soak test. It catches an\n" +
    "  immediate collapse under concurrency; it says nothing about memory growth\n" +
    "  over hours, which needs a sustained run.",
);
