/**
 * Prove a backup by restoring it.
 *
 * A backup that has never been restored is a file. This wipes a DISPOSABLE
 * database, rebuilds the schema from migrations, loads the most recent dump,
 * and then checks what came back — row counts against the dump's own manifest,
 * then referential integrity — rather than reporting success because no command
 * exited non-zero.
 *
 * It also proves the part that motivated the exercise: the full-text search
 * index is deliberately NOT in the backup, because it is derived. It has to
 * come back anyway, rebuilt by the triggers as the product rows land, and the
 * last check here is a real search against the restored database.
 *
 *   node scripts/restore/restore-test.mjs
 *
 * ── Safety ───────────────────────────────────────────────────────────────────
 *
 * The first thing this does is DROP EVERY TABLE in the target. So it refuses to
 * run against any database whose configured name does not say it is disposable.
 * A restore drill that can be aimed at the wrong database is a data-loss
 * incident waiting for a tired afternoon.
 */
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";

import { dependencyOrder, shadowTables, virtualTables } from "../lib/schema-order.mjs";

const ENVIRONMENT = "restore-test";
const REQUIRED_NAME_FRAGMENT = "restore-test";
const CONFIG = "wrangler.jsonc";
const BACKUP_DIR = "backups";

function wrangler(args, { capture = true } = {}) {
  return execFileSync(
    process.execPath,
    ["node_modules/wrangler/bin/wrangler.js", ...args],
    capture
      ? { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }
      : { stdio: "inherit", maxBuffer: 64 * 1024 * 1024 },
  );
}

function query(sql) {
  const output = wrangler([
    "d1",
    "execute",
    "DB",
    "--env",
    ENVIRONMENT,
    "--remote",
    "--json",
    "--command",
    sql,
  ]);
  return JSON.parse(output.slice(output.indexOf("[")))[0]?.results ?? [];
}

const fail = (message) => {
  console.error(`\n${message}`);
  process.exit(1);
};

// ── 0. Refuse to point this at anything real ────────────────────────────────

/*
 * Check the database that will actually be destroyed, not just the environment
 * key that was passed. `--env restore-test` would happily execute against a
 * production database if somebody edited that block.
 */
const config = JSON.parse(
  readFileSync(CONFIG, "utf8")
    // wrangler.jsonc allows comments and trailing commas; strip them to parse.
    .replace(/^\s*\/\*[\s\S]*?\*\//gm, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1")
    .replace(/,(\s*[}\]])/g, "$1"),
);

const target = config.env?.[ENVIRONMENT]?.d1_databases?.[0]?.database_name;
if (!target) fail(`No D1 database configured under env.${ENVIRONMENT} in ${CONFIG}.`);
if (!target.includes(REQUIRED_NAME_FRAGMENT)) {
  fail(
    `Refusing to run.\n\n` +
      `  target database: ${target}\n` +
      `  required:        a name containing "${REQUIRED_NAME_FRAGMENT}"\n\n` +
      `This script DROPS EVERY TABLE in its target. It will only do that to a\n` +
      `database whose name says it is disposable.`,
  );
}
if (/prod|live|staging/i.test(target)) {
  fail(`Refusing to run: "${target}" is named like a real environment.`);
}

console.log(`Restore drill against the disposable database "${target}".\n`);

// ── 1. Find the newest backup and its manifest ──────────────────────────────

if (!existsSync(BACKUP_DIR)) fail(`No ${BACKUP_DIR}/ directory. Take a backup first.`);

const dumps = readdirSync(BACKUP_DIR)
  .filter((name) => name.endsWith(".sql"))
  .sort()
  .reverse();
if (dumps.length === 0) fail(`No .sql backup in ${BACKUP_DIR}/. Run: npm run backup:preview`);

const dumpPath = join(BACKUP_DIR, dumps[0]);
const manifestPath = `${dumpPath}.manifest.json`;
if (!existsSync(manifestPath)) {
  fail(
    `${dumpPath} has no manifest beside it.\n` +
      `Without one there is nothing to verify the restore AGAINST, so this would\n` +
      `prove only that the file replays — not that it was complete.`,
  );
}

const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
console.log(`Backup    ${dumpPath}`);
console.log(`Taken     ${manifest.takenAt} from ${manifest.database} (${manifest.environment})`);
console.log(
  `Contents  ${manifest.rowCount} rows across ${manifest.populatedTables.length} populated tables\n`,
);

// ── 2. Empty the target completely ──────────────────────────────────────────

console.log("Dropping every table in the target…");

const existing = query(
  "SELECT name, COALESCE(sql, '') AS sql FROM sqlite_master WHERE type = 'table'",
);

const fts = virtualTables(existing);
const shadows = new Set(shadowTables(existing));
const droppable = existing
  .map((r) => r.name)
  .filter((name) => !name.startsWith("sqlite_") && !name.startsWith("_cf_"))
  // Shadow tables belong to their virtual table and cannot be dropped directly;
  // dropping `product_search` takes `product_search_data` and friends with it.
  .filter((name) => !shadows.has(name));

if (droppable.length > 0) {
  /*
   * CHILDREN FIRST — the reverse of the order the backup writes rows in.
   *
   * Dropping alphabetically fails, because SQLite still resolves a table's
   * foreign keys as it drops it. Remove `roles` before `role_permissions` and
   * the second drop dies with:
   *
   *     no such table: main.roles
   *
   * which reads like a missing table and is really a wrong order. Deferring
   * foreign keys does not help here: the reference is resolved at DROP, not at
   * COMMIT.
   */
  const sql = [
    "PRAGMA defer_foreign_keys = TRUE;",
    ...dependencyOrder(droppable, existing)
      .reverse()
      .map((name) => `DROP TABLE IF EXISTS "${name}";`),
  ].join("\n");

  wrangler(["d1", "execute", "DB", "--env", ENVIRONMENT, "--remote", "--command", sql, "--json"]);
  console.log(`  dropped ${droppable.length} tables (including ${fts.length} FTS)`);
}

const leftover = query("SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table'");
console.log(`  remaining: ${leftover[0]?.n ?? "?"} (D1 internals only)\n`);

// ── 3. Rebuild the schema from migrations, not from the dump ────────────────

console.log("Applying migrations to the empty database…");
wrangler(["d1", "migrations", "apply", "DB", "--env", ENVIRONMENT, "--remote"], { capture: false });

const schema =
  query(
    "SELECT (SELECT COUNT(*) FROM sqlite_master WHERE type='table') AS tables," +
      " (SELECT COUNT(*) FROM sqlite_master WHERE type='index') AS indexes," +
      " (SELECT COUNT(*) FROM sqlite_master WHERE type='trigger') AS triggers," +
      " (SELECT COUNT(*) FROM d1_migrations) AS migrations",
  )[0] ?? {};

console.log(
  `\n  ${schema.migrations} migrations, ${schema.tables} tables, ` +
    `${schema.indexes} indexes, ${schema.triggers} triggers\n`,
);

const emptyFts = query("SELECT COUNT(*) AS n FROM product_search");
if (Number(emptyFts[0]?.n) !== 0) {
  fail(`The freshly migrated database already has ${emptyFts[0]?.n} rows in product_search.`);
}

// ── 4. Load the data ────────────────────────────────────────────────────────

console.log(`Loading ${dumpPath}…`);
try {
  wrangler(["d1", "execute", "DB", "--env", ENVIRONMENT, "--remote", "--file", dumpPath], {
    capture: false,
  });
} catch {
  fail(
    "The restore FAILED. This backup cannot be restored as it stands.\n" +
      "Do NOT treat the file in backups/ as a usable backup.",
  );
}

// ── 5. Did every row come back? ─────────────────────────────────────────────

console.log("\nRow counts against the backup manifest:\n");

const expected = manifest.rowsPerTable ?? {};
const tables = Object.keys(expected).sort();

/*
 * Every count in one query, as scalar subqueries in a single SELECT.
 *
 * One round trip per table is slow enough that people stop running the drill,
 * and a verification step nobody runs verifies nothing. The obvious way to
 * batch them — `SELECT ... UNION ALL SELECT ...` — hits a hard limit:
 *
 *     too many terms in compound SELECT
 *
 * at twenty tables, and would fail again as soon as the schema grew. Scalar
 * subqueries are not a compound SELECT and so are bounded by the column limit
 * instead, which is in the thousands.
 */
const counted =
  query(
    `SELECT ${tables.map((name) => `(SELECT COUNT(*) FROM "${name}") AS "${name}"`).join(", ")}`,
  )[0] ?? {};

const actual = new Map(tables.map((name) => [name, Number(counted[name])]));

const problems = [];
for (const name of tables) {
  const want = expected[name];
  const got = actual.get(name);
  if (want !== got) problems.push(`${name}: expected ${want} rows, restored ${got}`);
  console.log(`  ${want === got ? "ok  " : "FAIL"}  ${name.padEnd(24)} ${got} / ${want}`);
}

// ── 6. Is the restored data internally consistent? ──────────────────────────

/*
 * Right counts are not the same as right data. Reordering the statements to get
 * past the foreign-key failures is exactly the kind of change that could load
 * every row while attaching some of them to the wrong parent, so the invariants
 * are checked directly rather than assumed to follow from the totals.
 */
const INTEGRITY = [
  {
    name: "every order item resolves to an order",
    sql: "SELECT COUNT(*) AS n FROM order_items oi LEFT JOIN orders o ON o.id = oi.order_id WHERE o.id IS NULL",
    unit: "orphaned items",
  },
  {
    name: "every payment resolves to an order",
    sql: "SELECT COUNT(*) AS n FROM order_payments op LEFT JOIN orders o ON o.id = op.order_id WHERE o.id IS NULL",
    unit: "orphaned payments",
  },
  {
    name: "every variant resolves to a product",
    sql: "SELECT COUNT(*) AS n FROM product_variants v LEFT JOIN products p ON p.id = v.product_id WHERE p.id IS NULL",
    unit: "orphaned variants",
  },
  {
    name: "every compatibility row resolves to a product and a model",
    sql: `SELECT COUNT(*) AS n FROM product_compatibility c
            LEFT JOIN products p ON p.id = c.product_id
            LEFT JOIN device_models m ON m.id = c.device_model_id
           WHERE p.id IS NULL OR m.id IS NULL`,
    unit: "orphaned compatibility rows",
  },
  {
    name: "inventory invariant holds (0 <= reserved <= on_hand)",
    sql: "SELECT COUNT(*) AS n FROM inventory_levels WHERE reserved > on_hand OR reserved < 0",
    unit: "violating rows",
  },
];

console.log("\nReferential integrity of the restored data:\n");
for (const check of INTEGRITY) {
  const violations = Number(query(check.sql)[0]?.n ?? -1);
  const ok = violations === 0;
  if (!ok) problems.push(`${check.name}: ${violations} ${check.unit}`);
  console.log(`  ${ok ? "ok  " : "FAIL"}  ${check.name} — ${violations} ${check.unit}`);
}

// ── 7. The point of the exercise: does search work again? ───────────────────

console.log("\nStructures rebuilt by trigger (deliberately absent from the backup):\n");

const derived =
  query(
    "SELECT (SELECT COUNT(*) FROM product_search) AS fts," +
      " (SELECT COUNT(*) FROM product_search_map) AS map," +
      " (SELECT COUNT(*) FROM product_translations) AS translations",
  )[0] ?? {};

console.log(`  product_search        ${derived.fts} rows`);
console.log(`  product_search_map    ${derived.map} rows`);
console.log(`  product_translations  ${derived.translations} rows (what the triggers index)`);

if (Number(derived.fts) !== Number(derived.translations)) {
  problems.push(
    `product_search has ${derived.fts} rows but ${derived.translations} translations exist to index`,
  );
}
if (Number(derived.map) !== Number(derived.translations)) {
  problems.push(`product_search_map has ${derived.map} rows, expected ${derived.translations}`);
}

/*
 * `product_search` is an external-content FTS5 table: it stores the index and
 * nothing else, so it has no product_id column to select. The way back to a
 * product is its rowid, through product_search_map — which is exactly the
 * mapping the triggers had to rebuild, so searching this way exercises both.
 */
const hits = query(
  `SELECT m.product_id
     FROM product_search s
     JOIN product_search_map m ON m.rowid = s.rowid
    WHERE product_search MATCH '"cover"*'`,
);
console.log(
  `\n  search '"cover"*'     ${hits.length} hit(s): ${hits.map((h) => h.product_id).join(", ") || "none"}`,
);
if (hits.length === 0) problems.push("Search returned nothing for 'cover' after restore.");

// ── 8. Verdict ──────────────────────────────────────────────────────────────

if (problems.length > 0) {
  console.error("\nRESTORE VERIFICATION FAILED:\n");
  for (const problem of problems) console.error(`  - ${problem}`);
  console.error("\nThis backup is NOT proven. Do not rely on it.");
  process.exit(1);
}

console.log(`
RESTORE VERIFIED.

  ${manifest.rowCount} rows across ${tables.length} tables restored exactly.
  Schema rebuilt from ${schema.migrations} migrations, not from the dump.
  Referential integrity intact after the statements were reordered.
  Full-text search rebuilt itself from the triggers and returns results.

The disposable database still holds the restored copy so it can be inspected.
Delete it when finished — a stale copy of shop data sitting in an account is a
liability, and this one is not free forever:

  npx wrangler d1 delete ${target}
`);
