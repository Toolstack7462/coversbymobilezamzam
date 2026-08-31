/**
 * FTS-safe database export.
 *
 * ── Why the ordinary backup does not work ────────────────────────────────────
 *
 * `wrangler d1 export` refuses outright on this database:
 *
 *     D1 Export error: cannot export databases with Virtual Tables (fts5)
 *
 * So the shop's only backup command stops working the moment full-text search
 * is added — and it stops working with an error that sounds like a limitation
 * rather than a data-loss risk. A database nobody can export is a database
 * nobody can restore.
 *
 * ── The way through ──────────────────────────────────────────────────────────
 *
 * The FTS index is DERIVED. It holds no fact that is not already in
 * `product_translations`, `product_variants` and `brands`, and it is rebuilt
 * from them by triggers. So it does not need backing up — it needs recreating.
 *
 * This exports the authoritative ordinary tables and nothing else:
 *
 *   1. Ask the live database which tables exist.
 *   2. Drop the FTS virtual tables and their shadow tables (`_data`, `_idx`,
 *      `_docsize`, `_config`) — SQLite will not let anything write to those
 *      directly anyway.
 *   3. Drop `product_search_map`, because the triggers rebuild it, and
 *      importing it first would collide with the rows they insert.
 *   4. Export the rest with `--table`, DATA ONLY (`--no-schema`).
 *   5. Reorder the INSERTs so parent rows land before the rows referencing them.
 *
 * Schema comes from the migrations on restore, which is the point: a restore
 * that recreates the schema from migrations proves the migrations are the
 * source of truth, rather than proving a dump can be replayed.
 *
 * ── Why step 5 is not optional ───────────────────────────────────────────────
 *
 * D1's own export writes tables in alphabetical order and opens the file with
 * `PRAGMA defer_foreign_keys=TRUE`, which is meant to make that safe. It does
 * not, because deferred foreign keys are only checked at COMMIT and the import
 * runs the file in batches rather than in one transaction. So every statement
 * commits and is checked on the spot, and the restore dies part-way:
 *
 *     FOREIGN KEY constraint failed: SQLITE_CONSTRAINT_FOREIGNKEY
 *
 * `role_permissions` before `roles`, `product_translations` before `products`.
 * A backup that cannot be restored is not a backup, and this one failed on the
 * FIRST attempt to restore it — which is the entire argument for testing
 * restores rather than trusting that an export which produced a file worked.
 *
 * So the statements are regrouped here into dependency order, read from the
 * `REFERENCES` clauses of the live schema. D1 refuses `pragma_foreign_key_list`
 * (`not authorized: SQLITE_AUTH`), so the schema text itself is the source.
 *
 * ── The restore ──────────────────────────────────────────────────────────────
 *
 * Documented in docs/cloudflare/backup-and-fts-restore.md and executed by
 * `scripts/restore/restore-test.mjs`. In short: fresh database → apply
 * migrations → load this data → the triggers repopulate the search index as the
 * translation rows land.
 *
 *   node scripts/backup/export-fts-safe.mjs --db DB --env preview --remote
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import {
  dependencyOrder,
  selfReferencing,
  shadowTables,
  virtualTables,
} from "../lib/schema-order.mjs";

const args = process.argv.slice(2);
const arg = (name, fallback = null) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : fallback;
};

const DB = arg("--db", "ita-commerce");
const ENVIRONMENT = arg("--env");
const REMOTE = args.includes("--remote");
const DIR = "backups";

/** Tables that must never be exported, whatever the database says. */
const EXCLUDED_EXACT = new Set([
  // Wrangler's own migration ledger. Restoring it would tell a fresh database
  // that migrations it has never run are already applied.
  "d1_migrations",
  // Rebuilt by the FTS triggers. Importing it ahead of the translations would
  // collide with the rows they insert.
  "product_search_map",
]);

function wrangler(extra) {
  return execFileSync(
    process.execPath,
    [
      "node_modules/wrangler/bin/wrangler.js",
      "d1",
      ...extra,
      REMOTE ? "--remote" : "--local",
      ...(ENVIRONMENT ? ["--env", ENVIRONMENT] : []),
    ],
    { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
  );
}

// ── 1. What is in there ──────────────────────────────────────────────────────

console.log(`Reading the schema of ${DB}…`);

const listing = wrangler([
  "execute",
  DB,
  "--json",
  "--command",
  "SELECT name, COALESCE(sql, '') AS sql FROM sqlite_master WHERE type = 'table'",
]);

const parsed = JSON.parse(listing.slice(listing.indexOf("[")));
const rows = parsed[0]?.results ?? [];
if (rows.length === 0) {
  console.error("No tables found. Refusing to write an empty backup.");
  process.exit(1);
}

const ftsTables = virtualTables(rows);
const shadows = new Set(shadowTables(rows));

const exported = rows
  .map((r) => r.name)
  .filter((name) => !name.startsWith("sqlite_") && !name.startsWith("_cf_"))
  .filter((name) => !ftsTables.includes(name))
  .filter((name) => !shadows.has(name))
  .filter((name) => !EXCLUDED_EXACT.has(name))
  .sort();

/*
 * Parent-first ordering, so the rows can be inserted on restore without
 * tripping a foreign key. Shared with the restore drill, which walks the same
 * order backwards to drop tables. See scripts/lib/schema-order.mjs.
 */
let orderedTables;
try {
  orderedTables = dependencyOrder(exported, rows);
} catch (error) {
  console.error(`
${error instanceof Error ? error.message : error}`);
  console.error("Cannot produce a restorable ordering. Backup NOT written.");
  process.exit(1);
}

const selfReferencingTables = selfReferencing(rows).filter((name) => exported.includes(name));

console.log(
  `  ${exported.length} tables to export; ` +
    `${ftsTables.length} FTS virtual table(s) and their shadows excluded and REBUILT on restore.`,
);

// ── 2. Export the data ───────────────────────────────────────────────────────

if (!existsSync(DIR)) mkdirSync(DIR, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const target = join(DIR, `${DB}-${REMOTE ? "remote" : "local"}-${stamp}.sql`);
const manifestPath = `${target}.manifest.json`;

console.log(`Exporting → ${target}`);

try {
  execFileSync(
    process.execPath,
    [
      "node_modules/wrangler/bin/wrangler.js",
      "d1",
      "export",
      DB,
      // Data only. The schema comes from the migrations on restore, which is
      // what makes the restore a test of the migrations rather than of the dump.
      "--no-schema",
      "--output",
      target,
      ...orderedTables.flatMap((name) => ["--table", name]),
      REMOTE ? "--remote" : "--local",
      ...(ENVIRONMENT ? ["--env", ENVIRONMENT] : []),
    ],
    { stdio: "inherit" },
  );
} catch (error) {
  console.error("\nExport FAILED. This is NOT a backup.");
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}

if (!existsSync(target) || statSync(target).size === 0) {
  console.error("\nExport file is missing or empty. Do NOT treat this as a backup.");
  process.exit(1);
}

// ── 3. Put the statements in an order that can actually be restored ─────────

/**
 * Split SQL into statements.
 *
 * Not a line split: SQLite writes literal newlines inside string literals, so a
 * product description containing a line break would be torn in half. Not a
 * naive split on `;` either, for the same reason.
 *
 * So: scan characters, tracking whether we are inside a single-quoted string. A
 * statement ends at the first `;` outside one. SQLite escapes an embedded quote
 * by doubling it (`''`), and toggling on each quote handles that correctly —
 * the pair closes then reopens the string, leaving the state where it should be.
 */
function splitStatements(sql) {
  const statements = [];
  let start = 0;
  let inString = false;

  for (let i = 0; i < sql.length; i += 1) {
    const char = sql[i];
    if (char === "'") {
      inString = !inString;
    } else if (char === ";" && !inString) {
      const statement = sql.slice(start, i + 1).trim();
      if (statement) statements.push(statement);
      start = i + 1;
    }
  }

  const trailing = sql.slice(start).trim();
  if (trailing) statements.push(trailing);
  return statements;
}

const statements = splitStatements(readFileSync(target, "utf8"));

const preamble = [];
const byTable = new Map(orderedTables.map((name) => [name, []]));
const unrecognised = [];

for (const statement of statements) {
  const match = /^INSERT\s+INTO\s+["'`[]?([A-Za-z_][A-Za-z0-9_]*)["'`\]]?/i.exec(statement);
  if (match && byTable.has(match[1])) {
    byTable.get(match[1]).push(statement);
  } else if (/^PRAGMA\b/i.test(statement)) {
    preamble.push(statement);
  } else {
    // Anything unexpected is KEPT, not dropped. A backup script that quietly
    // discards statements it did not anticipate is worse than one that fails.
    unrecognised.push(statement);
  }
}

const reordered = [
  "-- Reordered by scripts/backup/export-fts-safe.mjs so that parent rows are",
  "-- inserted before the rows that reference them. D1's own export is",
  "-- alphabetical, which fails on restore. Restore into a database that has",
  "-- ALREADY had migrations applied; the FTS index rebuilds itself via triggers.",
  ...preamble,
  ...orderedTables.flatMap((name) => {
    const rowsFor = byTable.get(name) ?? [];
    return rowsFor.length > 0 ? [`-- ${name} (${rowsFor.length} rows)`, ...rowsFor] : [];
  }),
  ...unrecognised,
].join("\n");

writeFileSync(target, `${reordered}\n`, "utf8");

const populated = orderedTables.filter((name) => (byTable.get(name) ?? []).length > 0);
const totalRows = [...byTable.values()].reduce((sum, list) => sum + list.length, 0);

console.log(
  `  reordered ${totalRows} rows across ${populated.length} populated tables` +
    (unrecognised.length > 0 ? `; ${unrecognised.length} statement(s) kept as-is at the end` : ""),
);
if (selfReferencingTables.length > 0) {
  // Row order within these tables is the order D1 returned them, which is rowid
  // order — the order they were originally inserted, so a parent row precedes
  // its children. Worth stating, because it is a property being relied on.
  console.log(
    `  self-referencing (relying on rowid order within the table): ${selfReferencingTables.join(", ")}`,
  );
}

/*
 * A manifest beside the dump.
 *
 * Six months from now the question will be "what was in this file, and what was
 * left out on purpose?" — and a dump that silently omits tables is
 * indistinguishable from a dump taken when those tables were empty.
 */
const manifest = {
  database: DB,
  environment: ENVIRONMENT,
  remote: REMOTE,
  takenAt: new Date().toISOString(),
  bytes: statSync(target).size,
  tablesExported: exported,
  restoreOrder: orderedTables,
  populatedTables: populated,
  rowCount: totalRows,
  // Per-table counts, so a restore can be VERIFIED rather than just observed to
  // finish without an error.
  rowsPerTable: Object.fromEntries(populated.map((name) => [name, byTable.get(name).length])),
  selfReferencingTables,
  excluded: {
    virtualTables: ftsTables,
    shadowTables: [...shadows],
    deliberate: [...EXCLUDED_EXACT],
  },
  restoreNote:
    "Data only. Restore by applying migrations to an empty database FIRST, then " +
    "loading this file. The FTS index and product_search_map are rebuilt by the " +
    "triggers as product_translations rows are inserted.",
};
writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

console.log(`
Backup written.

  data      ${target}  (${(statSync(target).size / 1024).toFixed(1)} KB)
  manifest  ${manifestPath}

Both are in backups/, which is gitignored: a dump holds real customer and order
data and must never enter version control.

This is not yet a TESTED backup. Run scripts/restore/restore-test.mjs against a
disposable database before calling it one — a backup nobody has restored is a
file, not a backup.
`);
