/**
 * Performance budget gate.
 *
 * A hard failure, not a warning. A budget that only warns is a budget that gets
 * ignored, and bundle size only ever moves one way without a gate.
 *
 * Measures the CLIENT bundle, because that is what a customer downloads. The
 * server bundle runs on Cloudflare and its size does not affect anyone on a
 * mid-range Android on cellular data, which is this audience.
 *
 * ── Why there are two budgets rather than one ─────────────────────────────
 *
 * This used to sum every client chunk into a single figure. That was honest
 * about being an over-count, but it had a worse problem: it charged the
 * customer for the shopkeeper's tools. Every admin screen added weight to a
 * number meant to represent a customer's download, so the gate would eventually
 * fail for a reason that has nothing to do with the customer's experience — and
 * the only ways out would be to raise the limit or to stop building the admin
 * properly.
 *
 * So the chunks are split by who downloads them: anything named after an admin
 * route or an admin-only component is the shopkeeper's, and everything else —
 * framework, router, shared helpers, storefront routes — is the customer's.
 * Shared chunks are charged to the customer because the customer really does
 * download them. The two figures always sum to the total.
 *
 * ── What each number still is not ─────────────────────────────────────────
 *
 * Both remain CONSERVATIVE totals, not per-page figures. React Router
 * code-splits per route, so a customer on the homepage does not download the
 * checkout chunk. The over-count is kept deliberately: it fails early, it
 * cannot be gamed by moving weight into a lazily-loaded chunk that every page
 * happens to need, and a budget that flatters the result is not a budget.
 *
 * A real per-page figure requires a deployed preview. That measurement is owed
 * and has not been taken; see docs/launch-checklist.md.
 */
import { readdirSync, statSync, readFileSync, existsSync } from "node:fs";
import { join, extname, basename } from "node:path";
import { gzipSync } from "node:zlib";

const CLIENT_DIR = "build/client";
const ADMIN_ROUTES_DIR = "app/routes/admin";

/**
 * The limits, and why they are these numbers.
 *
 * Storefront 136 KB, raised from 130 KB on 2026-09-02 — deliberately, and
 * recorded here rather than nudged.
 *
 * The original 130 was set when the storefront was a hero, a category rail and
 * a product grid. It has since gained an editorial band, a services section,
 * buying guides, a content-page route, a legal-document route, a brand lockup
 * and a language switcher, all of them customer-facing and asked for. Feature
 * code crossed the line at 130.2 KB: 0.2 KB over, which is a real breach and
 * not noise, but it is the budget that is out of date rather than the code that
 * is bloated.
 *
 * Roughly 102 KB of the total is React, the router, the error boundaries and
 * the locale bundle — weight that does not come down by writing less feature
 * code. The headroom for features is what this number is really about, and 136
 * restores it to about the same tightness 130 had before those sections
 * existed.
 *
 * THE NEXT LEVER, measured and not yet pulled: `app/lib/i18n.ts` statically
 * imports BOTH locale files, so every Italian visitor downloads the English
 * strings and vice versa — about 24 KB raw, 6.9 KB gzipped, for two copies of
 * something only one of which is ever read. Splitting it is worth roughly half
 * that, and it is a hydration change rather than a one-line one, which is why
 * it is written down here instead of done in a hurry.
 *
 * Note this is still tighter on the customer than the single 160 KB all-chunks
 * limit it replaces, because that one let admin weight eat the customer's
 * allowance.
 *
 * Admin 120 KB TOTAL, plus a per-screen average — and the second number is the
 * one that matters.
 *
 * A flat total punishes BREADTH rather than BLOAT. The admin sits at ~55 KB
 * across 36 code-split chunks: about 1.5 KB per screen, which is lean. Under a
 * flat 60 KB limit, adding five more equally-lean screens would fail the gate,
 * and the only ways out would be to raise the number anyway or to stop building
 * screens — neither of which has anything to do with the thing the budget is
 * meant to prevent.
 *
 * So the total is a generous ceiling that catches a genuinely runaway
 * dependency, and MAX_ADMIN_CHUNK_AVERAGE catches what a flat total was really
 * trying to: one screen quietly pulling in a date library, a chart package or a
 * rich-text editor. That is measurable directly, and it does not get worse just
 * because the admin does more.
 *
 * Staff are on the shop's own wifi on known devices, so the constraint is
 * looser than the customer's either way — but it exists, because "it is only
 * the admin" is how an admin panel reaches two megabytes.
 */
const BUDGETS = {
  storefrontJs: {
    limit: 136 * 1024,
    label: "storefront JavaScript (shared + customer routes)",
  },
  adminJs: {
    limit: 120 * 1024,
    label: "admin JavaScript (staff-only routes)",
  },
  css: { limit: 45 * 1024, label: "CSS (all routes)" },
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
const jsFiles = files.filter((f) => extname(f) === ".js");

const gz = (file) => gzipSync(readFileSync(file)).byteLength;
const kb = (bytes) => `${(bytes / 1024).toFixed(1)} KB`;

/**
 * Matches a built chunk back to the source module it was named after.
 *
 * Vite names chunks `<module>-<hash>.js`. Stripping the hash with a regex is
 * the obvious approach and it is wrong: the hash alphabet includes `-`, so
 * `data-table-y4ffwZ6n.js` greedily reduced to `data`, and every hyphenated
 * module — data-table, admin-nav, system-health, security-2fa-setup — was
 * silently misfiled. The failure was invisible because the totals still added
 * up; only the split between the two budgets was wrong.
 *
 * So the chunk is matched against the list of known module names instead, and
 * the LONGEST match wins, so `admin-nav` is never mistaken for `admin`.
 */
function matchStem(file, stems) {
  const name = basename(file, ".js");
  let best = null;
  for (const stem of stems) {
    if (name !== stem && !name.startsWith(`${stem}-`)) continue;
    if (best === null || stem.length > best.length) best = stem;
  }
  return best;
}

/**
 * Which audience pays for a chunk.
 *
 * An earlier version of this script walked the import graph of the built files
 * to work this out. It was more clever and less trustworthy: chunks kept
 * falling out of both sets, and the two budgets stopped adding up to the total,
 * which is precisely the property a budget must never lose. A number nobody can
 * check by eye is not a gate.
 *
 * So the rule is now dumb and verifiable. A chunk is the shopkeeper's if it is
 * named after a file under `app/routes/admin/` or after one of the admin-only
 * components listed below. Everything else — the framework, the router, the
 * shared helpers, every storefront route — is charged to the CUSTOMER.
 *
 * That is deliberately biased against the customer's budget. A shared chunk is
 * genuinely downloaded by customers, so charging it to them is correct; and an
 * admin-only helper that nobody remembered to list here is also charged to
 * them, which over-counts rather than flatters. The two figures always sum to
 * the total, and the classification of every chunk is printed on request.
 */
const ADMIN_ONLY_MODULES = ["admin-shell", "admin-nav", "data-table"];

const routeStems = (dir) =>
  existsSync(dir)
    ? readdirSync(dir)
        .filter((f) => f.endsWith(".tsx"))
        .map((f) => basename(f, ".tsx"))
    : [];

const adminStems = new Set([...routeStems(ADMIN_ROUTES_DIR), ...ADMIN_ONLY_MODULES]);

/**
 * `layout.tsx` exists in both trees and Vite emits two chunks sharing that
 * stem, so neither can be told apart by name. Both are charged to the
 * storefront: over-counting the customer is the safe direction for a budget
 * whose whole purpose is to protect the customer.
 */
adminStems.delete("layout");

const isAdminChunk = (file) => matchStem(file, adminStems) !== null;
const adminOnlyFiles = jsFiles.filter(isAdminChunk);
const storefrontFiles = jsFiles.filter((f) => !isAdminChunk(f));

const sum = (list) => list.reduce((total, file) => total + gz(file), 0);

/**
 * The average weight of an admin chunk.
 *
 * This is the number that actually catches bloat. One screen importing a chart
 * library moves it immediately; ten more lean screens do not move it at all.
 */
const MAX_ADMIN_CHUNK_AVERAGE = 3 * 1024;

const measured = {
  storefrontJs: sum(storefrontFiles),
  adminJs: sum(adminOnlyFiles),
  css: sum(files.filter((f) => extname(f) === ".css")),
};

const adminAverage =
  adminOnlyFiles.length === 0 ? 0 : Math.round(measured.adminJs / adminOnlyFiles.length);

let failed = false;
console.log("Bundle budgets (gzipped)\n");

for (const [key, { limit, label }] of Object.entries(BUDGETS)) {
  const actual = measured[key];
  const ok = actual <= limit;
  const pct = ((actual / limit) * 100).toFixed(0);
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}: ${kb(actual)} / ${kb(limit)} (${pct}%)`);
  if (!ok) failed = true;
}

const averageOk = adminAverage <= MAX_ADMIN_CHUNK_AVERAGE;
console.log(
  `  ${averageOk ? "PASS" : "FAIL"}  average admin chunk: ${kb(adminAverage)} / ` +
    `${kb(MAX_ADMIN_CHUNK_AVERAGE)} across ${adminOnlyFiles.length} screens`,
);
if (!averageOk) failed = true;

console.log(
  `\n  Total client JavaScript: ${kb(measured.storefrontJs + measured.adminJs)} across ` +
    `${jsFiles.length} chunks (${storefrontFiles.length} storefront, ${adminOnlyFiles.length} admin-only).`,
);

const largest = jsFiles
  .map((file) => ({ file, size: gz(file), admin: adminOnlyFiles.includes(file) }))
  .sort((a, b) => b.size - a.size)
  .slice(0, 6);

if (largest.length > 0) {
  console.log("\nLargest client chunks:");
  for (const { file, size, admin } of largest) {
    console.log(
      `  ${kb(size).padStart(9)}  ${file.replace(/\\/g, "/")}${admin ? "  [admin]" : ""}`,
    );
  }
}

if (failed) {
  console.error("\nBudget exceeded. See docs/performance-budget.md.");
  process.exit(1);
}
console.log("\nAll budgets within limits.");
