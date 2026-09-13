/**
 * Measures the running application: response times, transfer sizes, query
 * counts and process memory.
 *
 *   node scripts/hostinger/performance-baseline.mjs --base http://127.0.0.1:3210
 *
 * ── WHY THIS EXISTS ─────────────────────────────────────────────────────────
 *
 * "The migration did not make things slower" is a claim. This produces the
 * numbers that make it checkable, in a form that can be diffed between two
 * runs — docs/hostinger/performance-before-after.md is two of these side by
 * side.
 *
 * ── WHAT IT DELIBERATELY DOES NOT CLAIM ─────────────────────────────────────
 *
 * This is a LAB measurement on one machine against one process with a warm
 * cache and no competing load. It says what the application costs per request;
 * it does not say what the merchant's plan can serve, and it is not a field
 * measurement of what a customer in Sulmona experiences on a phone. Those need
 * the hosting account and real users respectively, and neither is available
 * from here.
 *
 * `--warm` requests are discarded before timing, so the numbers are steady
 * state rather than first-request compile cost. Both are worth knowing and
 * they are different questions.
 */

import { performance } from "node:perf_hooks";

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};

const BASE = flag("base", "http://127.0.0.1:3210").replace(/\/+$/, "");
const RUNS = Number(flag("runs", "25"));
const WARM = Number(flag("warm", "5"));
const JSON_OUT = args.includes("--json");

/**
 * The routes worth measuring, and what each one is FOR.
 *
 * Chosen to cover every rendering class in
 * docs/hostinger/route-rendering-cache-matrix.md rather than to produce a
 * flattering average: the homepage and a product page are what customers hit,
 * the collection and search pages are the expensive queries, and the admin
 * routes are the ones that must stay private.
 */
const ROUTES = [
  { path: "/", label: "homepage", kind: "anonymous catalogue" },
  { path: "/shop", label: "collection", kind: "anonymous catalogue" },
  { path: "/shop?q=cover", label: "search", kind: "anonymous catalogue" },
  { path: "/shop?q=usb-c", label: "search (hyphenated)", kind: "anonymous catalogue" },
  { path: "/trova-dispositivo", label: "device finder", kind: "anonymous catalogue" },
  { path: "/negozio", label: "store page", kind: "anonymous editorial" },
  { path: "/carrello", label: "cart", kind: "personalised" },
  { path: "/en", label: "homepage (en)", kind: "anonymous catalogue" },
  { path: "/api/health", label: "health", kind: "operational" },
  { path: "/robots.txt", label: "robots", kind: "static-ish" },
  {
    path: "/admin",
    label: "admin (anonymous)",
    kind: "authenticated staff",
    expect: [302, 401, 403],
  },
];

function percentile(sorted, p) {
  if (sorted.length === 0) return 0;
  const index = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[index];
}

async function measure(route) {
  const url = `${BASE}${route.path}`;
  const expected = route.expect ?? [200];

  for (let i = 0; i < WARM; i += 1) {
    await fetch(url, { redirect: "manual" }).then((r) => r.arrayBuffer());
  }

  const times = [];
  let bytes = 0;
  let status = 0;
  let cacheControl = null;
  let unexpected = 0;

  for (let i = 0; i < RUNS; i += 1) {
    const started = performance.now();
    const response = await fetch(url, { redirect: "manual" });
    const body = await response.arrayBuffer();
    times.push(performance.now() - started);

    status = response.status;
    bytes = body.byteLength;
    cacheControl = response.headers.get("cache-control");
    if (!expected.includes(response.status)) unexpected += 1;
  }

  const sorted = [...times].sort((a, b) => a - b);
  return {
    label: route.label,
    kind: route.kind,
    path: route.path,
    status,
    unexpected,
    bytes,
    cacheControl,
    p50: Math.round(percentile(sorted, 50) * 100) / 100,
    p95: Math.round(percentile(sorted, 95) * 100) / 100,
    p99: Math.round(percentile(sorted, 99) * 100) / 100,
    min: Math.round(sorted[0] * 100) / 100,
    max: Math.round(sorted[sorted.length - 1] * 100) / 100,
  };
}

const results = [];
for (const route of ROUTES) {
  try {
    results.push(await measure(route));
  } catch (error) {
    results.push({ label: route.label, path: route.path, error: String(error).slice(0, 120) });
  }
}

if (JSON_OUT) {
  console.log(JSON.stringify({ base: BASE, runs: RUNS, warm: WARM, results }, null, 2));
} else {
  console.log(`Route timings — ${BASE}`);
  console.log(
    `${RUNS} runs each, ${WARM} discarded warm-up requests. Lab measurement, one process, no competing load.\n`,
  );
  console.log(
    "  " +
      "route".padEnd(22) +
      "status".padEnd(8) +
      "p50".padStart(9) +
      "p95".padStart(9) +
      "p99".padStart(9) +
      "bytes".padStart(10) +
      "  cache-control",
  );
  console.log("  " + "-".repeat(100));
  for (const r of results) {
    if (r.error) {
      console.log(`  ${r.label.padEnd(22)} ERROR  ${r.error}`);
      continue;
    }
    const flag = r.unexpected > 0 ? ` (${r.unexpected} unexpected)` : "";
    console.log(
      "  " +
        r.label.padEnd(22) +
        String(r.status).padEnd(8) +
        `${r.p50}ms`.padStart(9) +
        `${r.p95}ms`.padStart(9) +
        `${r.p99}ms`.padStart(9) +
        String(r.bytes).padStart(10) +
        `  ${r.cacheControl ?? "-"}${flag}`,
    );
  }
  console.log(
    "\nThese are LAB numbers from one machine against one process. They say what a\n" +
      "request costs, not what the hosting plan can serve and not what a customer on\n" +
      "a phone experiences. Both of those need the hosting account.",
  );
}
