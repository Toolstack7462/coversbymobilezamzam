/**
 * A sustained run, to tell a grown heap apart from a leak.
 *
 *   npm run performance:soak -- --minutes 30
 *
 * ── WHY THE SMOKE TEST CANNOT ANSWER THIS ───────────────────────────────────
 *
 * performance-smoke.mjs measured RSS going from 105.9 MB to 233.1 MB in twenty
 * seconds and not coming back. That is consistent with V8 holding on to a heap
 * it has grown — the ordinary, harmless case — and it is equally consistent
 * with a leak. Twenty seconds cannot distinguish them, and the honest thing
 * written in the baseline document was that it had not been distinguished.
 *
 * This runs long enough to. A leak shows as memory that keeps climbing after
 * the working set has settled; a grown heap shows as a step up followed by a
 * flat line with a saw-tooth on it as the collector runs.
 *
 * ── HOW IT DECIDES ──────────────────────────────────────────────────────────
 *
 * The first third is discarded as warm-up. A least-squares fit over the rest
 * gives megabytes per hour of drift. That number is reported whatever it is —
 * there is no pass/fail threshold here, because the right threshold depends on
 * a memory allowance nobody has told us yet, and inventing one would turn a
 * measurement into a reassurance.
 *
 * Latency is bucketed per interval too. Memory that stays flat while p95 walks
 * upwards is a different problem — an unbounded queue, a growing table scan —
 * and it would be invisible in an average taken over the whole run.
 */

import { setInterval, clearInterval } from "node:timers";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { performance } from "node:perf_hooks";

import { startLocalServer, DEV_JOB_SECRET } from "./local-server.mjs";

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};

const MINUTES = Number(flag("minutes", "30"));
const CONCURRENCY = Number(flag("concurrency", "2"));
const SAMPLE_SECONDS = Number(flag("sample", "30"));
const OUT = flag("out", "test-results/performance");

/**
 * A steady browsing mix, deliberately gentler than the smoke test.
 *
 * A soak is not a stress test. Saturating the process would measure the queue
 * rather than the memory, and a leak found only at saturation is a leak nobody
 * can act on. This is roughly what a small shop's continuous traffic looks
 * like, sustained for as long as it takes to see a trend.
 *
 * The cart is in the mix on purpose: it is the one route that always renders,
 * so a leak that only shows on cache misses is still exercised once the
 * catalogue pages are all warm.
 */
const MIX = [
  { path: "/", weight: 4 },
  { path: "/shop", weight: 3 },
  { path: "/shop?q=cover", weight: 2 },
  { path: "/trova-dispositivo", weight: 1 },
  { path: "/carrello", weight: 2 },
];
const bag = MIX.flatMap((entry) => Array.from({ length: entry.weight }, () => entry.path));

async function processMemoryMb(pid) {
  if (process.platform !== "win32") {
    try {
      const status = fs.readFileSync(`/proc/${pid}/status`, "utf8");
      const rss = /VmRSS:\s+(\d+)\s+kB/.exec(status);
      return rss ? Math.round(Number(rss[1]) / 1024) : null;
    } catch {
      return null;
    }
  }
  return new Promise((resolve) => {
    const child = spawn(
      "powershell.exe",
      [
        "-NoProfile",
        "-Command",
        `$p = Get-Process -Id ${pid}; "$($p.WorkingSet64) $($p.PrivateMemorySize64) $($p.Threads.Count) $($p.HandleCount)"`,
      ],
      { stdio: ["ignore", "pipe", "ignore"] },
    );
    let out = "";
    child.stdout.on("data", (text) => {
      out += text;
    });
    child.on("exit", () => {
      const [rss, priv, threads, handles] = out.trim().split(/\s+/).map(Number);
      resolve(
        Number.isFinite(rss)
          ? {
              rssMb: Math.round(rss / 1024 / 1024),
              privateMb: Math.round(priv / 1024 / 1024),
              threads,
              handles,
            }
          : null,
      );
    });
  });
}

/** Least squares over (minutes, megabytes). Returns MB per hour. */
function driftPerHour(samples) {
  if (samples.length < 3) return null;
  const n = samples.length;
  const meanX = samples.reduce((a, s) => a + s.minute, 0) / n;
  const meanY = samples.reduce((a, s) => a + s.rssMb, 0) / n;
  let num = 0;
  let den = 0;
  for (const s of samples) {
    num += (s.minute - meanX) * (s.rssMb - meanY);
    den += (s.minute - meanX) ** 2;
  }
  if (den === 0) return null;
  return Math.round((num / den) * 60 * 10) / 10;
}

console.log(`Soak — ${MINUTES} minutes, ${CONCURRENCY} concurrent clients\n`);

const server = await startLocalServer({ env: { RESPONSE_CACHE: "on" } });
console.log(`  server pid ${server.pid} on ${server.base}\n`);

const started = Date.now();
const deadline = started + MINUTES * 60_000;
const samples = [];
let requests = 0;
let failures = 0;
let bucket = [];

async function worker() {
  while (Date.now() < deadline) {
    const url = `${server.base}${bag[Math.floor(Math.random() * bag.length)]}`;
    const begun = performance.now();
    try {
      const response = await fetch(url, { redirect: "manual" });
      await response.arrayBuffer();
      if (response.status >= 500) failures += 1;
    } catch {
      failures += 1;
    }
    bucket.push(performance.now() - begun);
    requests += 1;
  }
}

let sampling = true;
const sampler = setInterval(() => {
  void (async () => {
    const memory = await processMemoryMb(server.pid);
    // A sample already in flight when the run ends would otherwise report the
    // memory of a process that has exited: 0 MB, and a tidy false conclusion.
    if (memory === null || !sampling) return;
    const times = bucket.sort((a, b) => a - b);
    bucket = [];
    const at = (p) =>
      times.length === 0
        ? null
        : Math.round(times[Math.min(times.length - 1, Math.ceil((p / 100) * times.length) - 1)]);
    const sample = {
      minute: Math.round(((Date.now() - started) / 60_000) * 100) / 100,
      ...memory,
      requests: times.length,
      p50: at(50),
      p95: at(95),
    };
    samples.push(sample);
    console.log(
      `  ${String(sample.minute).padStart(6)}m  ` +
        `rss ${String(sample.rssMb).padStart(4)} MB  ` +
        `private ${String(sample.privateMb).padStart(4)} MB  ` +
        `threads ${String(sample.threads).padStart(3)}  ` +
        `handles ${String(sample.handles).padStart(5)}  ` +
        `p50 ${String(sample.p50).padStart(4)}ms  p95 ${String(sample.p95).padStart(5)}ms  ` +
        `${sample.requests} req`,
    );
  })();
}, SAMPLE_SECONDS * 1000);

await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));
sampling = false;
clearInterval(sampler);

const elapsedMinutes = (Date.now() - started) / 60_000;

let stats = null;
try {
  const response = await fetch(`${server.base}/api/cache-stats`, {
    headers: { "x-job-secret": DEV_JOB_SECRET },
  });
  if (response.ok) stats = await response.json();
} catch {
  // Optional.
}

await server.stop();

const settled = samples.slice(Math.floor(samples.length / 3));
const drift = driftPerHour(settled);
const first = settled[0];
const last = settled[settled.length - 1];

fs.mkdirSync(OUT, { recursive: true });
const file = path.join(OUT, `soak-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
fs.writeFileSync(
  file,
  JSON.stringify(
    { minutes: MINUTES, concurrency: CONCURRENCY, requests, failures, samples, stats, drift },
    null,
    2,
  ),
);

console.log("\n  ── Result ────────────────────────────────────────────────");
console.log(`  duration            ${elapsedMinutes.toFixed(1)} minutes`);
console.log(`  requests            ${requests.toLocaleString()}`);
console.log(`  failures (5xx)      ${failures}`);
if (first && last) {
  console.log(`  RSS at ${String(first.minute).padStart(5)}m       ${first.rssMb} MB`);
  console.log(`  RSS at ${String(last.minute).padStart(5)}m       ${last.rssMb} MB`);
  console.log(`  threads             ${first.threads} → ${last.threads}`);
  console.log(`  handles             ${first.handles} → ${last.handles}`);
  console.log(`  p95 first → last    ${first.p95}ms → ${last.p95}ms`);
}
console.log(`  drift (settled)     ${drift === null ? "not enough samples" : `${drift} MB/hour`}`);
if (stats) {
  console.log(`  cache hit rate      ${stats.hitRate}`);
  console.log(`  cache bytes held    ${(stats.bytes / 1024 / 1024).toFixed(2)} MiB`);
}
console.log(`\n  Raw samples: ${file}`);
console.log(
  "\n  There is no pass mark here on purpose. The drift figure is what it is;\n" +
    "  whether it fits depends on a memory allowance the hosting account has not\n" +
    "  yet told us. A figure near zero with a flat handle count is a process that\n" +
    "  is not accumulating; a steady climb in either is one that is.",
);
