/**
 * Runs the same measurements twice — cache off, cache on — and prints the
 * difference.
 *
 *   npm run performance:compare
 *
 * ── WHY ONE SCRIPT AND NOT TWO RUNS BY HAND ─────────────────────────────────
 *
 * A before/after comparison is only worth anything if the two halves differ in
 * exactly one thing. Two runs done by hand differ in whatever else was
 * happening on the machine, in how warm the InnoDB buffer pool was, and in
 * whichever browser tab was open at the time. This starts both servers from
 * the same build against the same database, in the same minute, with one
 * environment variable different between them, and it reports both halves
 * whether or not the second one is faster.
 *
 * ── WHAT IT STILL CANNOT CONTROL ────────────────────────────────────────────
 *
 * It is one machine running Windows with other processes on it. The ordering
 * is fixed (off first) rather than randomised, so a machine that gets busier
 * during the run flatters the first half and penalises the second. Run it
 * twice with `--reverse` if a result looks too good.
 */

import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";

import { startLocalServer, DEV_JOB_SECRET } from "./local-server.mjs";

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};

const SECONDS = Number(flag("seconds", "20"));
const CONCURRENCY = Number(flag("concurrency", "8"));
const RUNS = Number(flag("runs", "25"));
const OUT = flag("out", "test-results/performance");

fs.mkdirSync(OUT, { recursive: true });

function runScript(script, scriptArgs) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [script, ...scriptArgs], {
      stdio: ["ignore", "pipe", "inherit"],
    });
    let out = "";
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (text) => {
      out += text;
    });
    child.on("exit", (code) => {
      if (code !== 0) {
        reject(new Error(`${script} exited ${code}`));
        return;
      }
      try {
        resolve(JSON.parse(out));
      } catch (error) {
        reject(new Error(`${script} did not produce JSON: ${error.message}\n${out.slice(0, 400)}`));
      }
    });
  });
}

/** Reads the process's own memory, which is the number the plan is sized by. */
async function processMemory(pid) {
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
      ["-NoProfile", "-Command", `(Get-Process -Id ${pid}).WorkingSet64`],
      { stdio: ["ignore", "pipe", "ignore"] },
    );
    let out = "";
    child.stdout.on("data", (text) => {
      out += text;
    });
    child.on("exit", () => {
      const bytes = Number(out.trim());
      resolve(Number.isFinite(bytes) && bytes > 0 ? Math.round(bytes / 1024 / 1024) : null);
    });
  });
}

async function half(label, env) {
  console.log(`\n── ${label} ──────────────────────────────────────────────`);
  const server = await startLocalServer({ env });
  try {
    console.log(`  server pid ${server.pid}`);
    const idleMb = await processMemory(server.pid);

    const routes = await runScript("scripts/hostinger/performance-baseline.mjs", [
      "--base",
      server.base,
      "--runs",
      String(RUNS),
      "--json",
    ]);
    console.log(`  per-route timings: ${routes.results.length} routes`);

    const load = await runScript("scripts/hostinger/performance-smoke.mjs", [
      "--base",
      server.base,
      "--seconds",
      String(SECONDS),
      "--concurrency",
      String(CONCURRENCY),
      "--json",
    ]);
    console.log(`  load: ${load.throughput} req/s, ${load.failures} failures`);

    const loadedMb = await processMemory(server.pid);

    let stats = null;
    try {
      const response = await fetch(`${server.base}/api/cache-stats`, {
        headers: { "x-job-secret": DEV_JOB_SECRET },
      });
      if (response.ok) stats = await response.json();
    } catch {
      // The endpoint is only mounted when the job secret is configured.
    }

    return { label, env, routes, load, idleMb, loadedMb, stats };
  } finally {
    await server.stop();
  }
}

const halves = args.includes("--reverse")
  ? [
      ["cache on", { RESPONSE_CACHE: "on" }],
      ["cache off", { RESPONSE_CACHE: "off" }],
    ]
  : [
      ["cache off", { RESPONSE_CACHE: "off" }],
      ["cache on", { RESPONSE_CACHE: "on" }],
    ];

const measured = [];
for (const [label, env] of halves) {
  measured.push(await half(label, env));
}

const off = measured.find((m) => m.label === "cache off");
const on = measured.find((m) => m.label === "cache on");

const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const file = path.join(OUT, `compare-${stamp}.json`);
fs.writeFileSync(
  file,
  JSON.stringify({ seconds: SECONDS, concurrency: CONCURRENCY, measured }, null, 2),
);

const pct = (before, after) =>
  before === 0 ? "—" : `${(((after - before) / before) * 100).toFixed(1)}%`;

console.log("\n\n── Per-route p50, cache off → cache on ───────────────────────");
console.log(
  "  " + "route".padEnd(22) + "off".padStart(10) + "on".padStart(10) + "change".padStart(10),
);
console.log("  " + "-".repeat(52));
for (const before of off.routes.results) {
  const after = on.routes.results.find((r) => r.path === before.path);
  if (!after || before.error || after.error) continue;
  console.log(
    "  " +
      before.label.padEnd(22) +
      `${before.p50}ms`.padStart(10) +
      `${after.p50}ms`.padStart(10) +
      pct(before.p50, after.p50).padStart(10),
  );
}

console.log(`\n── Under ${CONCURRENCY} concurrent clients for ${SECONDS}s ──────────────`);
const rows = [
  ["throughput (req/s)", off.load.throughput, on.load.throughput],
  ["p50 (ms)", off.load.p50, on.load.p50],
  ["p95 (ms)", off.load.p95, on.load.p95],
  ["p99 (ms)", off.load.p99, on.load.p99],
  ["failures", off.load.failures, on.load.failures],
  ["RSS idle (MB)", off.idleMb, on.idleMb],
  ["RSS after load (MB)", off.loadedMb, on.loadedMb],
];
for (const [name, a, b] of rows) {
  console.log(
    "  " +
      String(name).padEnd(22) +
      String(a).padStart(10) +
      String(b).padStart(10) +
      (typeof a === "number" && typeof b === "number" ? pct(a, b).padStart(10) : ""),
  );
}

if (on.stats) {
  console.log("\n── Cache behaviour during the loaded half ────────────────────");
  console.log(`  hit rate     ${on.stats.hitRate}`);
  console.log(`  entries      ${on.stats.entries}`);
  console.log(`  bytes held   ${(on.stats.bytes / 1024 / 1024).toFixed(2)} MiB`);
  console.log(`  refusals     ${JSON.stringify(on.stats.refusals)}`);
}

console.log(`\n  Raw results: ${file}`);
console.log(
  "  Lab measurement, one machine, one process, warm database. It says what the\n" +
    "  cache is worth in THIS configuration. It is not a Hostinger measurement and\n" +
    "  it is not a field measurement of what a customer experiences.",
);
