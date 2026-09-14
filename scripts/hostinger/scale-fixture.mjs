/**
 * Builds a synthetic catalogue several times the size of the real one, in a
 * database of its own.
 *
 *   node scripts/hostinger/scale-fixture.mjs --copies 40
 *
 * ── WHY ─────────────────────────────────────────────────────────────────────
 *
 * Every performance number this project has was measured against 26 products.
 * A query plan that is fine over 26 rows says almost nothing about the same
 * plan over 1,000 — a full scan of 26 rows is faster than using an index, so
 * the optimiser's choice at this size is not the choice it will make later, and
 * a missing index is invisible until it is expensive.
 *
 * The merchant is not going to have 1,000 products next week. That is not the
 * point: the point is to know NOW which query stops scaling and at what size,
 * rather than finding out from a shop that has become slow.
 *
 * ── HOW IT IS BUILT, AND THE HONEST LIMITS OF THAT ──────────────────────────
 *
 * It multiplies the REAL catalogue rather than inventing one, so every row has
 * the shape, the text lengths and the relationships the application actually
 * produces. Two consequences follow and both matter when reading the results:
 *
 *   - The data has 26 distinct products repeated N times. Cardinality is
 *     therefore far lower than a real catalogue of the same size: every copy
 *     shares a brand, a category and a device-compatibility set. An index whose
 *     value depends on selectivity will look WORSE here than in reality, which
 *     is the safe direction to be wrong in.
 *   - Search tokens repeat too, so a full-text query matches proportionally
 *     more rows than it would in a varied catalogue of the same size. Again the
 *     pessimistic direction.
 *
 * It never touches `zamzam_staging`. The scale database is dropped and rebuilt
 * on every run, and its name must contain "scale" — a guard against pointing
 * this at the wrong database, which would silently multiply the real one.
 */

import mysql from "mysql2/promise";

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};

const SOURCE = flag("source", process.env.DB_NAME ?? "zamzam_staging");
const TARGET = flag("target", "zamzam_scale");
const COPIES = Number(flag("copies", "40"));

if (!/scale/i.test(TARGET)) {
  console.error(
    `Refusing to build into "${TARGET}": the target database name must contain "scale".\n` +
      `This script DROPS the target. The guard exists so a mistyped flag cannot drop the ` +
      `staging database that holds the migrated catalogue.`,
  );
  process.exit(1);
}
if (TARGET === SOURCE) {
  console.error("Refusing to build a scale fixture on top of its own source.");
  process.exit(1);
}

const connection = await mysql.createConnection({
  host: process.env.TEST_DB_HOST ?? "127.0.0.1",
  port: Number(process.env.TEST_DB_PORT ?? 3399),
  user: process.env.TEST_DB_USER ?? "root",
  password: process.env.TEST_DB_PASSWORD ?? "",
  multipleStatements: false,
});

const q = async (sql, params = []) => {
  const [rows] = await connection.query(sql, params);
  return rows;
};

console.log(`Scale fixture: ${SOURCE} × ${COPIES} → ${TARGET}\n`);

// ── 1. A structural copy ─────────────────────────────────────────────────────
//
// `CREATE TABLE ... LIKE` reproduces columns, generated columns, indexes and
// foreign keys exactly — which matters, because a fixture whose indexes differ
// from production measures a database nobody runs.
//
// Foreign key checks are off during creation only. A table created before the
// one its key points at is otherwise refused, and resolving that means a
// topological sort of ninety-odd tables to save nothing.
await q(`DROP DATABASE IF EXISTS \`${TARGET}\``);
await q(`CREATE DATABASE \`${TARGET}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
await q(`SET FOREIGN_KEY_CHECKS = 0`);

const tables = (await q(`SHOW TABLES FROM \`${SOURCE}\``)).map((row) => Object.values(row)[0]);
for (const table of tables) {
  await q(`CREATE TABLE \`${TARGET}\`.\`${table}\` LIKE \`${SOURCE}\`.\`${table}\``);
}
console.log(`  ${tables.length} tables created`);

/** Columns that can be written. A generated column is computed, never inserted. */
async function writableColumns(table) {
  const rows = await q(
    `SELECT column_name AS cn, extra AS ex
       FROM information_schema.columns
      WHERE table_schema = ? AND table_name = ?
      ORDER BY ordinal_position`,
    [TARGET, table],
  );
  return rows.filter((row) => !String(row.ex ?? "").includes("GENERATED")).map((row) => row.cn);
}

let copiedRows = 0;
for (const table of tables) {
  const columns = await writableColumns(table);
  const list = columns.map((c) => `\`${c}\``).join(", ");
  const result = await q(
    `INSERT INTO \`${TARGET}\`.\`${table}\` (${list}) SELECT ${list} FROM \`${SOURCE}\`.\`${table}\``,
  );
  copiedRows += result.affectedRows ?? 0;
}
console.log(`  ${copiedRows.toLocaleString()} rows copied\n`);

// ── 2. Multiply the catalogue ────────────────────────────────────────────────
//
// Only the catalogue. Orders, staff, settings and audit history are copied once
// and left alone: multiplying them would measure a shop that has taken 40×
// the orders, which is a different question and one nobody has asked yet.
//
// Each copy gets `-cN` appended to every identifier, slug and SKU. Those are
// unique keys, and a fixture that violates one is a fixture that silently
// inserts less than it claims.
const suffix = (column, n) => `CONCAT(\`${column}\`, '-c${n}')`;

/**
 * The catalogue tables, in dependency order, and how each row is re-keyed.
 *
 * `rewrite` maps a column name to the SQL that produces the copy's value.
 * Anything not listed is copied unchanged.
 */
const CATALOGUE = [
  { table: "products", rewrite: (n) => ({ id: suffix("id", n), slug: suffix("slug", n) }) },
  {
    table: "product_translations",
    rewrite: (n) => ({ id: suffix("id", n), product_id: suffix("product_id", n) }),
  },
  {
    table: "product_variants",
    rewrite: (n) => ({
      id: suffix("id", n),
      product_id: suffix("product_id", n),
      sku: suffix("sku", n),
      barcode: `CASE WHEN barcode IS NULL THEN NULL ELSE ${suffix("barcode", n)} END`,
    }),
  },
  {
    table: "variant_prices",
    rewrite: (n) => ({ id: suffix("id", n), variant_id: suffix("variant_id", n) }),
  },
  {
    table: "inventory_levels",
    rewrite: (n) => ({ id: suffix("id", n), variant_id: suffix("variant_id", n) }),
  },
  {
    table: "product_images",
    rewrite: (n) => ({
      id: suffix("id", n),
      product_id: suffix("product_id", n),
      variant_id: `CASE WHEN variant_id IS NULL THEN NULL ELSE ${suffix("variant_id", n)} END`,
    }),
  },
  {
    table: "product_compatibility",
    rewrite: (n) => ({
      id: suffix("id", n),
      product_id: suffix("product_id", n),
      variant_id: `CASE WHEN variant_id IS NULL THEN NULL ELSE ${suffix("variant_id", n)} END`,
    }),
  },
  {
    table: "product_search_documents",
    rewrite: (n) => ({ product_id: suffix("product_id", n) }),
  },
  {
    table: "product_search_tokens",
    rewrite: (n) => ({ id: suffix("id", n), product_id: suffix("product_id", n) }),
  },
];

const started = Date.now();
for (let n = 1; n <= COPIES; n += 1) {
  for (const { table, rewrite } of CATALOGUE) {
    const columns = await writableColumns(table);
    const rewrites = rewrite(n);
    const select = columns.map((c) => rewrites[c] ?? `\`${c}\``).join(", ");
    const list = columns.map((c) => `\`${c}\``).join(", ");
    await q(
      `INSERT INTO \`${TARGET}\`.\`${table}\` (${list}) SELECT ${select} FROM \`${SOURCE}\`.\`${table}\``,
    );
  }
  if (n % 10 === 0 || n === COPIES) {
    process.stdout.write(`  copy ${n}/${COPIES}\r`);
  }
}
console.log(`\n  multiplied in ${((Date.now() - started) / 1000).toFixed(1)}s\n`);

await q(`SET FOREIGN_KEY_CHECKS = 1`);

// ── 3. Report what was actually built ────────────────────────────────────────
//
// Counted from the database rather than calculated from `COPIES`. An insert
// silently dropped by a unique key would otherwise be reported as a success.
console.log("  ── Catalogue size ────────────────────────────────────────");
let total = 0;
for (const { table } of CATALOGUE) {
  const [{ c }] = await q(`SELECT COUNT(*) AS c FROM \`${TARGET}\`.\`${table}\``);
  total += Number(c);
  console.log(`  ${table.padEnd(28)} ${Number(c).toLocaleString().padStart(10)}`);
}
console.log(`  ${"total catalogue rows".padEnd(28)} ${total.toLocaleString().padStart(10)}`);

const [size] = await q(
  `SELECT ROUND(SUM(data_length + index_length) / 1024 / 1024, 1) AS mb
     FROM information_schema.tables WHERE table_schema = ?`,
  [TARGET],
);
console.log(`  ${"on disk".padEnd(28)} ${String(size.mb).padStart(8)} MB`);

await connection.end();

console.log(
  `\n  Point the server at it with DB_NAME=${TARGET}.\n` +
    "  The copies share brands, categories and device compatibility, so index\n" +
    "  selectivity here is WORSE than a real catalogue of the same size.",
);
