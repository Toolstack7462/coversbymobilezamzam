/**
 * Imports a D1 export into MariaDB, and reconciles it.
 *
 *   node scripts/hostinger/import-mariadb.mjs --from <export-dir> [--apply]
 *
 * DRY RUN IS THE DEFAULT. Without `--apply` nothing is written: every row is
 * read, converted and validated, and the report says what WOULD happen. A
 * migration tool whose default is to write is a tool somebody runs against the
 * wrong database once.
 *
 * ── WHAT IT REFUSES TO DO ───────────────────────────────────────────────────
 *
 * No `INSERT IGNORE`, anywhere. A silently skipped row is the failure mode this
 * whole exercise exists to prevent: the import "succeeds", the counts are
 * short, and nobody looks at the counts. A duplicate key is an error, and the
 * report names the row.
 *
 * No `FOREIGN_KEY_CHECKS = 0`. Tables are imported in dependency order derived
 * from the schema. Turning the checks off would turn a migration that failed
 * loudly into one that succeeded and left orphans, and the point of moving to
 * an engine that enforces references is that it enforces them.
 *
 * No truncation. The target runs `STRICT_TRANS_TABLES`, so an over-long value
 * is an error rather than a shortened string — and this tool checks lengths
 * BEFORE writing so the report can name the column and the row rather than
 * relaying a driver error about a statement.
 *
 * ── RESUMABILITY ────────────────────────────────────────────────────────────
 *
 * Progress is written to `<export-dir>/import-progress.json` after each table
 * commits. A rerun skips tables already complete and verifies their row count
 * rather than trusting the file. Interrupting an import is therefore safe, and
 * so is running it twice.
 */

import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import mysql from "mysql2/promise";
import { fileURLToPath } from "node:url";
import { loadTableOrder } from "./lib/table-order.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

const args = process.argv.slice(2);
const flag = (name, fallback = null) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};
const has = (name) => args.includes(`--${name}`);

const FROM = flag("from");
const APPLY = has("apply");
const BATCH = Number(flag("batch", "200"));

if (!FROM) {
  console.error("Usage: node scripts/hostinger/import-mariadb.mjs --from <export-dir> [--apply]");
  process.exit(1);
}

const DB = {
  host: process.env.DB_HOST ?? "127.0.0.1",
  port: Number(process.env.DB_PORT ?? 3399),
  user: process.env.DB_USER ?? "root",
  password: process.env.DB_PASSWORD ?? "",
  database: process.env.DB_NAME ?? "zamzam_staging",
};

/** Rows this schema holds that are NOT records, and are rebuilt on the target. */
const REBUILT_ON_TARGET = new Set(["product_search_map"]);

async function main() {
  const manifestPath = path.join(FROM, "manifest.json");
  if (!fs.existsSync(manifestPath)) {
    console.error(`No manifest.json in ${FROM}. That directory is not an export.`);
    process.exit(1);
  }
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));

  console.log(`Import ${APPLY ? "(APPLY)" : "(DRY RUN — nothing will be written)"}`);
  console.log(`  from       ${FROM}`);
  console.log(`  snapshot   ${manifest.snapshotFinishedAt}`);
  console.log(`  source     ${manifest.source.engine} / ${manifest.source.environment}`);
  console.log(`  schema     ${manifest.schemaVersion}`);
  console.log(`  commit     ${manifest.repositoryCommit}`);
  console.log(`  into       ${DB.user}@${DB.host}:${DB.port}/${DB.database}\n`);

  const connection = await mysql.createConnection({
    ...DB,
    // Values are bound; this is belt and braces against a tool that builds a
    // statement from a column name.
    multipleStatements: false,
    dateStrings: true,
    supportBigNumbers: false,
  });

  try {
    // ── The target's own shape, read from the target ────────────────────────
    const [columnRows] = await connection.execute(
      `SELECT table_name, column_name, data_type, character_maximum_length, is_nullable, extra
         FROM information_schema.columns WHERE table_schema = ?`,
      [DB.database],
    );

    /** table -> Map(column -> {type, maxLength, nullable, generated}) */
    const target = new Map();
    for (const row of columnRows) {
      const table = row.TABLE_NAME ?? row.table_name;
      const column = row.COLUMN_NAME ?? row.column_name;
      if (!target.has(table)) target.set(table, new Map());
      target.get(table).set(column, {
        type: (row.DATA_TYPE ?? row.data_type).toLowerCase(),
        maxLength: row.CHARACTER_MAXIMUM_LENGTH ?? row.character_maximum_length,
        nullable: (row.IS_NULLABLE ?? row.is_nullable) === "YES",
        generated: String(row.EXTRA ?? row.extra ?? "").includes("GENERATED"),
      });
    }

    if (target.size === 0) {
      console.error(
        `${DB.database} has no tables. Apply db/mariadb/migrations first — this tool imports data, not schema.`,
      );
      process.exit(1);
    }

    const { order, cycles } = loadTableOrder(
      path.join(root, "db/mariadb/migrations/0001_baseline.sql"),
    );
    if (cycles.length > 0) {
      console.error("Foreign-key cycles, which no insertion order can satisfy:");
      for (const cycle of cycles) console.error(`  ${cycle.join(" -> ")}`);
      process.exit(1);
    }

    const progressPath = path.join(FROM, "import-progress.json");
    const progress = fs.existsSync(progressPath)
      ? JSON.parse(fs.readFileSync(progressPath, "utf8"))
      : { completed: {} };

    const report = { imported: {}, skipped: {}, rejected: [], missingTables: [] };
    let totalWritten = 0;

    for (const table of order) {
      const entry = manifest.tables[table];

      if (REBUILT_ON_TARGET.has(table)) {
        report.skipped[table] = "derived on the target; rebuilt by hostinger:search-rebuild";
        continue;
      }
      if (!entry) {
        // A table the target has and the export does not. Recorded rather than
        // ignored: it means the two schemas disagree.
        report.missingTables.push(table);
        continue;
      }
      if (entry.rows === 0) {
        report.imported[table] = { expected: 0, written: 0, rejected: 0 };
        continue;
      }

      const targetColumns = target.get(table);
      if (!targetColumns) {
        report.missingTables.push(`${table} (in export, absent from target)`);
        continue;
      }

      const existing = await countRows(connection, table);
      if (progress.completed[table] === entry.sha256 && existing === entry.rows) {
        report.skipped[table] = `already imported (${existing} rows, checksum matches)`;
        continue;
      }
      if (existing > 0 && !APPLY) {
        report.skipped[table] = `${existing} rows already present; a dry run does not clear them`;
        continue;
      }
      if (existing > 0 && APPLY) {
        // A partial table from an interrupted run. Clearing it is safe because
        // the export is the authority and the order guarantees no child rows
        // exist yet.
        await connection.execute(`DELETE FROM \`${table}\``);
      }

      const outcome = await importTable({
        connection,
        table,
        file: path.join(FROM, entry.file),
        targetColumns,
        expected: entry.rows,
        apply: APPLY,
        batch: BATCH,
      });

      report.imported[table] = outcome;
      report.rejected.push(...outcome.rejections);
      totalWritten += outcome.written;

      if (APPLY && outcome.rejected === 0) {
        progress.completed[table] = entry.sha256;
        fs.writeFileSync(progressPath, JSON.stringify(progress, null, 2), { mode: 0o600 });
      }

      const status =
        outcome.rejected > 0 ? `${outcome.rejected} REJECTED` : `${outcome.written} rows`;
      console.log(`  ${table.padEnd(38)} ${status}`);
    }

    // ── Reconciliation ──────────────────────────────────────────────────────
    console.log("\n── Reconciliation ──────────────────────────────────────────\n");

    const differences = [];
    for (const [table, entry] of Object.entries(manifest.tables)) {
      if (REBUILT_ON_TARGET.has(table)) continue;
      if (!target.has(table)) continue;
      const actual = APPLY
        ? await countRows(connection, table)
        : (report.imported[table]?.written ?? 0);
      if (actual !== entry.rows) {
        differences.push({ table, expected: entry.rows, actual });
      }
    }

    for (const difference of differences) {
      console.log(
        `  DIFFERENCE  ${difference.table.padEnd(34)} expected ${difference.expected}, got ${difference.actual}`,
      );
    }

    const rejectionCount = report.rejected.length;
    console.log(`  tables in export          ${Object.keys(manifest.tables).length}`);
    console.log(`  rows expected             ${manifest.totals.rows}`);
    console.log(`  rows ${APPLY ? "written  " : "convertible"}             ${totalWritten}`);
    console.log(`  rows rejected             ${rejectionCount}`);
    console.log(`  tables with a difference  ${differences.length}`);
    console.log(`  tables only on the target ${report.missingTables.length}`);

    if (rejectionCount > 0) {
      console.log("\nRejected rows (first 20):\n");
      for (const rejection of report.rejected.slice(0, 20)) {
        console.log(`  ${rejection.table}.${rejection.column ?? "?"} [${rejection.id}]`);
        console.log(`    ${rejection.reason}`);
      }
    }

    const reportPath = path.join(FROM, APPLY ? "import-report.json" : "dry-run-report.json");
    fs.writeFileSync(reportPath, JSON.stringify({ ...report, differences }, null, 2), {
      mode: 0o600,
    });
    console.log(`\nWrote ${reportPath}`);

    /*
     * Zero unexplained differences is the acceptance criterion.
     *
     * Not "close enough", and not "the errors were all in demo data". An
     * exclusion is a decision somebody makes and records in the manifest, not
     * something an import tool infers from a row that would not fit.
     */
    const clean = differences.length === 0 && rejectionCount === 0;
    console.log(
      clean
        ? `\n${APPLY ? "IMPORT" : "DRY RUN"} RECONCILED — every table matches the manifest.`
        : `\n${APPLY ? "IMPORT" : "DRY RUN"} DID NOT RECONCILE. Nothing above is acceptable to ship.`,
    );
    process.exit(clean ? 0 : 1);
  } finally {
    await connection.end();
  }
}

async function countRows(connection, table) {
  const [rows] = await connection.execute(`SELECT COUNT(*) AS n FROM \`${table}\``);
  return Number(rows[0].n);
}

/**
 * Reads one table's NDJSON and writes it.
 *
 * Streamed line by line rather than `JSON.parse(readFileSync(...))`: a
 * catalogue export is small today and an order history is not, and a tool that
 * needs the whole table in memory is one that stops working at exactly the
 * point it matters.
 */
async function importTable({ connection, table, file, targetColumns, expected, apply, batch }) {
  const stream = readline.createInterface({
    input: fs.createReadStream(file, { encoding: "utf8" }),
    crlfDelay: Infinity,
  });

  const rejections = [];
  let written = 0;
  let read = 0;
  let pending = [];
  let columns = null;

  const flush = async () => {
    if (pending.length === 0) return;
    if (apply) {
      const placeholders = `(${columns.map(() => "?").join(", ")})`;
      const sql =
        `INSERT INTO \`${table}\` (${columns.map((c) => `\`${c}\``).join(", ")}) VALUES ` +
        pending.map(() => placeholders).join(", ");
      await connection.execute(sql, pending.flat());
    }
    written += pending.length;
    pending = [];
  };

  for await (const line of stream) {
    if (line.trim() === "") continue;
    read += 1;

    let row;
    try {
      row = JSON.parse(line);
    } catch (error) {
      rejections.push({
        table,
        id: `line ${read}`,
        column: null,
        reason: `unparseable JSON: ${error.message}`,
      });
      continue;
    }

    // Generated columns are computed by the target and cannot be written to.
    // `variant_scope` is the replacement for a SQLite partial index and exists
    // only here, so it is absent from the export by construction.
    const usable = Object.keys(row).filter((c) => {
      const column = targetColumns.get(c);
      return column !== undefined && !column.generated;
    });

    const unknown = Object.keys(row).filter((c) => !targetColumns.has(c));
    if (unknown.length > 0) {
      rejections.push({
        table,
        id: row.id ?? `line ${read}`,
        column: unknown.join(", "),
        reason: `column exists in the export and not in the target schema`,
      });
      continue;
    }

    if (columns === null) columns = usable;

    const problem = validate(row, columns, targetColumns, table);
    if (problem) {
      rejections.push({ table, id: row.id ?? `line ${read}`, ...problem });
      continue;
    }

    pending.push(columns.map((c) => convert(row[c], targetColumns.get(c))));
    if (pending.length >= batch) await flush();
  }

  await flush();

  return { expected, read, written, rejected: rejections.length, rejections };
}

/**
 * Checks a row against the target's shape BEFORE writing it.
 *
 * The driver would reject most of these too, but its message names a statement
 * and not a row — and with several hundred rows batched into one INSERT, "data
 * too long for column 'name'" identifies nothing. Checking here means the
 * report names the table, the row id and the column.
 */
function validate(row, columns, targetColumns, table) {
  for (const column of columns) {
    const spec = targetColumns.get(column);
    const value = row[column];

    if (value === null || value === undefined) {
      if (!spec.nullable) {
        return { column, reason: `NULL in a NOT NULL column` };
      }
      continue;
    }

    if (spec.maxLength !== null && spec.maxLength !== undefined && typeof value === "string") {
      // Bytes, not characters: MariaDB's VARCHAR(n) is n characters, but a
      // multi-byte character still has to fit the index prefix, and an Italian
      // catalogue is full of them.
      if ([...value].length > spec.maxLength) {
        return {
          column,
          reason:
            `${[...value].length} characters into ${spec.type}(${spec.maxLength}). ` +
            `Widen the column in scripts/hostinger/lib/type-map.mjs and regenerate — ` +
            `do NOT truncate the value`,
        };
      }
    }

    if ((spec.type === "bigint" || spec.type === "int") && typeof value === "number") {
      if (!Number.isSafeInteger(value)) {
        return { column, reason: `${value} is not a safe integer` };
      }
    }

    if (spec.type === "tinyint" && value !== 0 && value !== 1) {
      return { column, reason: `${JSON.stringify(value)} in a boolean column (expected 0 or 1)` };
    }
  }

  void table;
  return null;
}

/** D1's JSON values to mysql2's parameters. */
function convert(value, spec) {
  if (value === undefined) return null;
  if (value === null) return null;

  // SQLite has no boolean; D1 returns 0/1 already. Guard anyway, because a
  // future export that returns true/false would otherwise become the string
  // "true" in a TINYINT.
  if (typeof value === "boolean") return value ? 1 : 0;

  if (spec.type === "tinyint" && typeof value === "number") return value === 0 ? 0 : 1;

  return value;
}

await main();
