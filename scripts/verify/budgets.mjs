/**
 * Performance budget gate.
 *
 * A hard failure, not a warning. A budget that only warns is a budget that gets
 * ignored, and bundle size only ever moves one way without a gate.
 *
 * Measures the CLIENT bundle, because that is what a customer downloads. The
 * server bundle runs on Cloudflare and its size does not affect anyone on a
 * mid-range Android on cellular data, which is this audience.
 */
import { readdirSync, statSync, readFileSync, existsSync } from "node:fs";
import { join, extname } from "node:path";
import { gzipSync } from "node:zlib";

const CLIENT_DIR = "build/client";

const BUDGETS = {
  js: { limit: 160 * 1024, label: "initial JavaScript" },
  css: { limit: 45 * 1024, label: "CSS" },
};

if (!existsSync(CLIENT_DIR)) {
  console.error(`No client build at ${CLIENT_DIR}. Run "npm run build" first.`);
  process.exit(1);
}

function walk(dir) {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

const files = walk(CLIENT_DIR);

function gzippedTotal(extension) {
  return files
    .filter((f) => extname(f) === extension)
    .reduce((total, file) => total + gzipSync(readFileSync(file)).byteLength, 0);
}

const measured = {
  js: gzippedTotal(".js"),
  css: gzippedTotal(".css"),
};

const kb = (bytes) => `${(bytes / 1024).toFixed(1)} KB`;

let failed = false;
console.log("Bundle budgets (gzipped)\n");

for (const [key, { limit, label }] of Object.entries(BUDGETS)) {
  const actual = measured[key];
  const ok = actual <= limit;
  const pct = ((actual / limit) * 100).toFixed(0);
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}: ${kb(actual)} / ${kb(limit)} (${pct}%)`);
  if (!ok) failed = true;
}

const largest = files
  .filter((f) => extname(f) === ".js")
  .map((f) => ({ file: f, size: gzipSync(readFileSync(f)).byteLength }))
  .sort((a, b) => b.size - a.size)
  .slice(0, 5);

if (largest.length > 0) {
  console.log("\nLargest client chunks:");
  for (const { file, size } of largest) {
    console.log(`  ${kb(size).padStart(9)}  ${file.replace(/\\/g, "/")}`);
  }
}

if (failed) {
  console.error("\nBudget exceeded. See docs/performance-budget.md.");
  process.exit(1);
}
console.log("\nAll budgets within limits.");
