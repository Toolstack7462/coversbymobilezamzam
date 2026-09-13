/**
 * Exports every row from D1, with a manifest that makes the copy checkable.
 *
 *   node scripts/hostinger/export-d1.mjs --env preview [--out <dir>]
 *
 * ── WHAT MAKES THIS AN EXPORT RATHER THAN A DUMP ────────────────────────────
 *
 * A dump is a pile of rows. What the import needs is a pile of rows plus a
 * statement of what was supposed to be in it, so that "did everything arrive?"
 * has an answer other than "it did not error". So every run writes:
 *
 *   <table>.ndjson    one JSON object per row, in primary-key order
 *   manifest.json     source environment, commit, schema version, snapshot
 *                     time, per-table row counts, and a canonical SHA-256 over
 *                     each table's content
 *
 * The checksum is over CANONICAL JSON — keys sorted, one row per line, in a
 * deterministic row order — so the same data exported twice produces the same
 * hash, and the import can prove it read what the export wrote rather than
 * merely reading something.
 *
 * ── WHAT IS NOT EXPORTED, AND WHY ───────────────────────────────────────────
 *
 * The FTS5 shadow tables (`product_search`, `product_search_data`, …) and
 * `product_search_map`. They are a DERIVED index, not records: MariaDB has no
 * FTS5 to restore them into, and the replacement is rebuilt from the catalogue
 * by `hostinger:search-rebuild`. Copying them would be copying an artefact of
 * the old engine into the new one.
 *
 * `d1_migrations` is Wrangler's own bookkeeping for a database that will not
 * exist after cutover. It is exported anyway — into the manifest rather than
 * the import — because knowing which migration the source was on is part of
 * saying what this snapshot IS.
 *
 * ── WHERE IT WRITES ─────────────────────────────────────────────────────────
 *
 * Outside the repository, and never under a directory the web server can
 * reach. The default is ~/hostinger-migration-work/export-<timestamp>. The
 * export contains every customer record the shop holds; it is not a build
 * artefact and it does not belong in Git.
 */

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";

const args = process.argv.slice(2);
const flag = (name, fallback = null) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};

const ENV = flag("env", "preview");
const BINDING = flag("binding", "DB");
const WORK = process.env.HOSTINGER_WORK_DIR ?? path.join(os.homedir(), "hostinger-migration-work");
const OUT =
  flag("out") ?? path.join(WORK, `export-${new Date().toISOString().replace(/[:.]/g, "-")}`);

/** Tables that are an artefact of SQLite's FTS5 rather than merchant data. */
const DERIVED = /^product_search(_config|_data|_docsize|_idx|_map)?$/;

/** Wrangler's own bookkeeping. Recorded in the manifest, not imported. */
const BOOKKEEPING = new Set(["d1_migrations"]);

/**
 * Runs one statement against D1 and returns its rows.
 *
 * Through bash rather than the shell Node would pick: cmd.exe splits an
 * unquoted argument on spaces and the statement arrives in pieces.
 *
 * Identifiers are quoted with [brackets], NOT backticks. Both are valid SQLite,
 * and a backtick inside a bash double-quoted string is command substitution:
 * a backtick-quoted table name is run as a shell command and SQLite is sent the
 * empty string. The guard below refuses anything that could be re-quoted.
 */
function d1(sql) {
  if (/[\u0060"$\\]/.test(sql)) {
    throw new Error(
      "Refusing to shell-quote SQL containing a backtick, quote, dollar or backslash: " + sql,
    );
  }
  const command = `npx wrangler d1 execute ${BINDING} --env ${ENV} --remote --json --command "${sql}" 2>/dev/null`;
  const raw = execFileSync("bash", ["-c", command], {
    encoding: "utf8",
    maxBuffer: 1 << 28,
  });
  const start = raw.indexOf("[");
  if (start < 0) throw new Error(`wrangler returned no JSON:\n${raw.slice(0, 500)}`);
  const parsed = JSON.parse(raw.slice(start));
  if (parsed.error) throw new Error(JSON.stringify(parsed.error));
  return parsed[0].results;
}

/**
 * Canonical JSON: keys in sorted order.
 *
 * `JSON.stringify` preserves insertion order, and D1 returns columns in
 * whatever order the SELECT produced, so two exports of identical data would
 * otherwise hash differently and the reconciliation would report a difference
 * that does not exist.
 */
function canonical(row) {
  return JSON.stringify(
    Object.fromEntries(
      Object.keys(row)
        .sort()
        .map((k) => [k, row[k]]),
    ),
  );
}

function primaryKeyOf(table, columns) {
  if (columns.includes("id")) return ["id"];
  // Composite keys, ordered so the sort is deterministic.
  const candidates = columns.filter((c) => c.endsWith("_id") || c === "code" || c === "key");
  return candidates.length > 0 ? candidates.slice(0, 3) : columns.slice(0, 1);
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true, mode: 0o700 });
  const startedAt = new Date().toISOString();

  console.log(`Exporting D1 --env ${ENV} to ${OUT}\n`);

  const objects = d1(
    "SELECT name, type, sql FROM sqlite_master WHERE type = 'table' " +
      "AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' ORDER BY name",
  );

  const allTables = objects.map((o) => o.name);
  const derived = allTables.filter((t) => DERIVED.test(t));
  const bookkeeping = allTables.filter((t) => BOOKKEEPING.has(t));
  const tables = allTables.filter((t) => !DERIVED.test(t) && !BOOKKEEPING.has(t));

  const migration = d1("SELECT name FROM d1_migrations ORDER BY id DESC LIMIT 1")[0]?.name ?? null;

  let commit = "unknown";
  try {
    commit = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  } catch {
    /* A source tarball with no .git still has to be able to export. */
  }

  const manifest = {
    source: { environment: ENV, binding: BINDING, engine: "cloudflare-d1" },
    repositoryCommit: commit,
    schemaVersion: migration,
    snapshotStartedAt: startedAt,
    snapshotFinishedAt: null,
    tables: {},
    excluded: {
      derived: derived.sort(),
      bookkeeping: bookkeeping.sort(),
      reason:
        "Derived tables are an FTS5 artefact and are rebuilt on the target; " +
        "bookkeeping belongs to a database that will not exist after cutover.",
    },
    totals: { tables: tables.length, rows: 0, bytes: 0 },
  };

  let totalRows = 0;
  let totalBytes = 0;

  for (const table of tables) {
    const info = d1(`PRAGMA table_info([${table}])`);
    const columnNames = info.map((c) => c.name);

    const key = primaryKeyOf(table, columnNames);
    const orderBy = key.map((c) => `[${c}]`).join(", ");
    const rows = d1(`SELECT * FROM [${table}] ORDER BY ${orderBy}`);

    const lines = rows.map(canonical);
    const body = lines.length > 0 ? lines.join("\n") + "\n" : "";
    const file = path.join(OUT, `${table}.ndjson`);
    fs.writeFileSync(file, body, { encoding: "utf8", mode: 0o600 });

    const checksum = crypto.createHash("sha256").update(body, "utf8").digest("hex");

    manifest.tables[table] = {
      rows: rows.length,
      bytes: Buffer.byteLength(body, "utf8"),
      columns: columnNames,
      orderedBy: key,
      sha256: checksum,
      file: `${table}.ndjson`,
    };

    totalRows += rows.length;
    totalBytes += Buffer.byteLength(body, "utf8");

    const label = rows.length === 0 ? "empty" : `${rows.length} rows`;
    process.stdout.write(`  ${table.padEnd(38)} ${label}\n`);
  }

  manifest.snapshotFinishedAt = new Date().toISOString();
  manifest.totals = { tables: tables.length, rows: totalRows, bytes: totalBytes };

  fs.writeFileSync(path.join(OUT, "manifest.json"), JSON.stringify(manifest, null, 2), {
    encoding: "utf8",
    mode: 0o600,
  });

  console.log(`\n  tables   ${tables.length}`);
  console.log(`  rows     ${totalRows}`);
  console.log(`  bytes    ${totalBytes}`);
  console.log(`  schema   ${migration}`);
  console.log(`  commit   ${commit}`);
  console.log(`\nExcluded as derived: ${derived.join(", ") || "none"}`);
  console.log(`Excluded as bookkeeping: ${bookkeeping.join(", ") || "none"}`);
  console.log(`\nWrote ${OUT}/manifest.json`);
  console.log(
    "\nThis export contains customer and merchant records. It is outside the repository\n" +
      "on purpose. Do not move it under a web-served directory and do not commit it.",
  );
}

await main();
