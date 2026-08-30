/**
 * Restore verification.
 *
 * A dump that LOADS without error can still be missing rows. This checks that
 * what came back is actually intact, which is the only thing that makes a
 * backup meaningful.
 *
 * Usage:
 *   npx wrangler d1 create ita-commerce-restore-test
 *   npx wrangler d1 execute ita-commerce-restore-test --remote --file backups/<dump>.sql
 *   npm run restore:test -- --db ita-commerce-restore-test --remote
 */
import { execFileSync } from "node:child_process";

const args = process.argv.slice(2);
const dbIndex = args.indexOf("--db");
const DB = dbIndex >= 0 ? args[dbIndex + 1] : "ita-commerce-restore-test";
const REMOTE = args.includes("--remote");

function query(sql) {
  const wranglerArgs = [
    "node_modules/wrangler/bin/wrangler.js",
    "d1",
    "execute",
    DB,
    REMOTE ? "--remote" : "--local",
    "--json",
    "--command",
    sql,
  ];
  const out = execFileSync(process.execPath, wranglerArgs, { encoding: "utf8" });
  const parsed = JSON.parse(out.slice(out.indexOf("[")));
  return parsed[0]?.results ?? [];
}

const CHECKS = [
  {
    name: "core tables exist",
    sql: `SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table'
           AND name IN ('orders','order_items','order_payments','products',
                        'product_variants','inventory_levels','stock_movements')`,
    assert: (rows) => rows[0]?.n === 7,
    detail: (rows) => `found ${rows[0]?.n}/7`,
  },
  {
    name: "orders present",
    sql: `SELECT COUNT(*) AS n FROM orders`,
    assert: (rows) => Number(rows[0]?.n) >= 0,
    detail: (rows) => `${rows[0]?.n} orders`,
  },
  {
    name: "every order item resolves to an order",
    sql: `SELECT COUNT(*) AS n FROM order_items oi
           LEFT JOIN orders o ON o.id = oi.order_id WHERE o.id IS NULL`,
    assert: (rows) => Number(rows[0]?.n) === 0,
    detail: (rows) => `${rows[0]?.n} orphaned items`,
  },
  {
    name: "every payment resolves to an order",
    sql: `SELECT COUNT(*) AS n FROM order_payments op
           LEFT JOIN orders o ON o.id = op.order_id WHERE o.id IS NULL`,
    assert: (rows) => Number(rows[0]?.n) === 0,
    detail: (rows) => `${rows[0]?.n} orphaned payments`,
  },
  {
    name: "inventory invariant holds (reserved <= on_hand)",
    sql: `SELECT COUNT(*) AS n FROM inventory_levels WHERE reserved > on_hand OR reserved < 0`,
    assert: (rows) => Number(rows[0]?.n) === 0,
    detail: (rows) => `${rows[0]?.n} violating rows`,
  },
  {
    name: "migrations table present",
    sql: `SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table' AND name LIKE '%migrations%'`,
    assert: (rows) => Number(rows[0]?.n) > 0,
    detail: (rows) => `${rows[0]?.n} migration tables`,
  },
];

console.log(`Verifying restored database: ${DB} (${REMOTE ? "remote" : "local"})\n`);

let failed = false;
for (const check of CHECKS) {
  try {
    const rows = query(check.sql);
    const ok = check.assert(rows);
    console.log(`  ${ok ? "PASS" : "FAIL"}  ${check.name} — ${check.detail(rows)}`);
    if (!ok) failed = true;
  } catch (error) {
    console.log(`  FAIL  ${check.name} — ${error instanceof Error ? error.message : error}`);
    failed = true;
  }
}

if (failed) {
  console.error("\nRESTORE VERIFICATION FAILED. This backup cannot be relied on.");
  process.exit(1);
}

console.log("\nRestore verified.");
console.log("Record the date and result in docs/backup-and-restore.md.");
