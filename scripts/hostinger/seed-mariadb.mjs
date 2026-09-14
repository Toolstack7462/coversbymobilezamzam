/**
 * Prepares a MariaDB database for the browser suite: migrate, then seed the
 * same demo catalogue the D1 suite uses.
 *
 *   node scripts/hostinger/seed-mariadb.mjs --database zamzam_e2e --reset
 *
 * ── WHY NOT A SECOND COPY OF THE SEED ───────────────────────────────────────
 *
 * There is exactly one definition of the demo catalogue, in
 * scripts/import/seed-demo.mjs, and it speaks SQLite because that is what D1
 * is. Writing a MariaDB version of it would mean two files that describe the
 * same shop and drift apart, and the drift would be invisible: both suites
 * would pass, against different data, and the difference would surface as a
 * test that fails on one runtime for reasons nobody can reproduce on the
 * other.
 *
 * So the seeds are asked to PRINT their statements (`--print`) and each one is
 * put through the same dialect translator the application uses. If a statement
 * cannot be translated, this fails loudly here rather than at runtime — which
 * is itself worth having, because it means the demo catalogue is continuously
 * checked for portability.
 *
 * ── WHAT IT REFUSES ─────────────────────────────────────────────────────────
 *
 * `--reset` DROPS the database first, so the name must contain "e2e" or
 * "test". The staging database holds the migrated real catalogue and a mistyped
 * flag must not be able to reach it.
 */

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import mysql from "mysql2/promise";

/*
 * The translator only — not the adapter.
 *
 * `SqlDatabase` is a prepared-statement port with no "run this DDL" method,
 * deliberately: nothing in the application should be executing arbitrary SQL.
 * A seeder is exactly the caller that has to, so it holds a plain mysql2
 * connection and borrows the one piece it must share with the application —
 * the dialect translation, so what is seeded is what the app would have
 * written.
 */
import { translate, UntranslatableSqlError } from "../../build/server-node/tools.js";

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};

const DATABASE = flag("database", "zamzam_e2e");
const RESET = args.includes("--reset");

if (RESET && !/e2e|test/i.test(DATABASE)) {
  console.error(
    `Refusing to reset "${DATABASE}": with --reset the database name must contain "e2e" or ` +
      `"test". This DROPS the database, and the staging one holds the migrated catalogue.`,
  );
  process.exit(1);
}

const CONNECTION = {
  host: process.env.TEST_DB_HOST ?? "127.0.0.1",
  port: Number(process.env.TEST_DB_PORT ?? 3399),
  user: process.env.TEST_DB_USER ?? "root",
  password: process.env.TEST_DB_PASSWORD ?? "",
};

const MIGRATIONS = path.resolve(process.cwd(), "db/mariadb/migrations");

/**
 * Splits a migration file into statements, honouring `DELIMITER`.
 *
 * The same shape as tests/mariadb/helpers.ts. A naive `split(";")` shreds a
 * routine body, and 0002_search.sql has one.
 */
function splitSqlFile(sql) {
  const out = [];
  let delimiter = ";";
  let buffer = "";

  for (const rawLine of sql.split(/\r?\n/)) {
    const line = rawLine.trimEnd();
    const change = /^DELIMITER\s+(\S+)\s*$/i.exec(line.trim());
    if (change) {
      if (buffer.trim() !== "") {
        out.push(buffer.trim());
        buffer = "";
      }
      delimiter = change[1] ?? ";";
      continue;
    }
    if (/^\s*--/.test(line) || line.trim() === "") continue;

    buffer += line + "\n";
    if (line.trimEnd().endsWith(delimiter)) {
      const statement = buffer.trim().slice(0, -delimiter.length).trim();
      if (statement !== "") out.push(statement);
      buffer = "";
    }
  }
  if (buffer.trim() !== "") out.push(buffer.trim());
  return out;
}

/**
 * Rewrites `ON CONFLICT(...) DO NOTHING` as `INSERT OR IGNORE`.
 *
 * The translator refuses the first form on purpose — "must be written as
 * INSERT OR IGNORE so the translation is explicit" — because MariaDB's
 * `INSERT IGNORE` swallows MORE than a single conflict, and a rewrite that
 * happened silently inside the application would be a widening nobody chose.
 *
 * Choosing it here, at the seeder's boundary, is a different decision from
 * choosing it inside the application: this is fixture data, the widening is
 * exactly the idempotency the seeds are asking for, and the seeds themselves
 * stay unchanged so the D1 suite keeps its narrower `ON CONFLICT(column)`
 * semantics.
 *
 * The price is that a genuinely broken row — a NOT NULL violation, say — is
 * skipped rather than raised. That is why this script COUNTS what it inserted
 * afterwards and fails if the catalogue is not actually there.
 */
function asInsertOrIgnore(statement) {
  const conflict = /\s+ON\s+CONFLICT\s*\([^)]*\)\s+DO\s+NOTHING\s*$/i;
  if (!conflict.test(statement)) return statement;
  return statement.replace(conflict, "").replace(/^INSERT\s+INTO\b/i, "INSERT OR IGNORE INTO");
}

/** Runs one seed script in `--print` mode and returns its statements. */
function seedStatements(script) {
  const out = execFileSync(process.execPath, [script, "--print"], {
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
  });
  return out
    .split(";\n")
    .map((s) => s.trim())
    .filter((s) => s !== "");
}

console.log(`Preparing ${DATABASE} on ${CONNECTION.host}:${CONNECTION.port}\n`);

const admin = await mysql.createConnection(CONNECTION);
if (RESET) {
  await admin.query(`DROP DATABASE IF EXISTS \`${DATABASE}\``);
}
await admin.query(
  `CREATE DATABASE IF NOT EXISTS \`${DATABASE}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
);
await admin.end();

const db = await mysql.createConnection({
  ...CONNECTION,
  database: DATABASE,
  // One statement per call. A seeder that could send several at once could
  // also send whatever followed a `;` inside a product description.
  multipleStatements: false,
});

try {
  // ── Schema ────────────────────────────────────────────────────────────────
  const files = fs
    .readdirSync(MIGRATIONS)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  let applied = 0;
  for (const file of files) {
    const statements = splitSqlFile(fs.readFileSync(path.join(MIGRATIONS, file), "utf8"));
    for (const statement of statements) {
      await db.query(statement);
      applied += 1;
    }
    console.log(`  ${file.padEnd(34)} ${statements.length} statements`);
  }
  console.log(`  ${applied} schema statements applied\n`);

  // ── Data ──────────────────────────────────────────────────────────────────
  //
  // Through the translator, one statement at a time, so a failure names the
  // statement rather than the file.
  /*
   * Order matters: the base seed first.
   *
   * It creates the roles, permissions, default price list and inventory
   * location that everything else references — and that the first-run install
   * screen checks for before it will enable its own form. Without it the
   * browser suite fails at its very first step, on a disabled input, under a
   * message telling a human to run the base seed.
   */
  const scripts = [
    "scripts/import/seed.mjs",
    "scripts/import/seed-demo.mjs",
    "scripts/import/seed-demo-orders.mjs",
  ];

  for (const script of scripts) {
    const statements = seedStatements(script);
    let count = 0;
    for (const statement of statements) {
      let sql;
      try {
        sql = translate(asInsertOrIgnore(statement)).sql;
      } catch (error) {
        if (error instanceof UntranslatableSqlError) {
          console.error(`\nUntranslatable statement in ${script}:\n${statement}\n`);
        }
        throw error;
      }

      try {
        await db.query(sql);
      } catch (error) {
        console.error(`\nFailed statement from ${script}:\n${sql}\n`);
        throw error;
      }
      count += 1;
    }
    console.log(`  ${path.basename(script).padEnd(34)} ${count} statements`);
  }

  // ── Report what is actually there ─────────────────────────────────────────
  //
  // Counted, not assumed. A seed that inserted nothing because every row hit
  // ON DUPLICATE KEY would otherwise report success.
  const EXPECTED = {
    products: 5,
    product_variants: 8,
    orders: 4,
    device_models: 5,
    categories: 4,
  };

  const counts = [];
  const short = [];
  for (const [table, atLeast] of Object.entries(EXPECTED)) {
    const [rows] = await db.query(`SELECT COUNT(*) AS n FROM \`${table}\``);
    const n = Number(rows[0].n);
    counts.push(`${table} ${n}`);
    if (n < atLeast) short.push(`${table}: ${n}, expected at least ${atLeast}`);
  }
  console.log(`\n  ${counts.join("  ·  ")}`);

  if (short.length > 0) {
    console.error(
      `\nThe seed reported success and did not produce a catalogue:\n  ${short.join("\n  ")}\n\n` +
        `INSERT IGNORE swallows more than a conflict, so a broken row is skipped rather than\n` +
        `raised. This check is what turns that back into a failure.`,
    );
    process.exitCode = 1;
  }
} finally {
  await db.end();
}

console.log(`\n${DATABASE} is ready.`);
