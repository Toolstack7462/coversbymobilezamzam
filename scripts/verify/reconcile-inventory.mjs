/**
 * Inventory reconciliation.
 *
 * inventory_levels counters SERVE reads; stock_movements and stock_reservations
 * EXPLAIN them. This replays the ledger and compares.
 *
 * On drift the LEDGER WINS - but the drift is REPORTED rather than silently
 * corrected. Silently fixing a symptom hides its cause, and the cause recurs.
 */
import { execFileSync } from "node:child_process";

const args = process.argv.slice(2);
const dbIndex = args.indexOf("--db");
const DB = dbIndex >= 0 ? args[dbIndex + 1] : "ita-commerce";
const REMOTE = args.includes("--remote");

function query(sql) {
  const out = execFileSync(
    process.execPath,
    [
      "node_modules/wrangler/bin/wrangler.js",
      "d1",
      "execute",
      DB,
      REMOTE ? "--remote" : "--local",
      "--json",
      "--command",
      sql,
    ],
    { encoding: "utf8" },
  );
  return JSON.parse(out.slice(out.indexOf("[")))[0]?.results ?? [];
}

console.log(`Reconciling inventory: ${DB} (${REMOTE ? "remote" : "local"})\n`);

// The reserved counter must equal the sum of active reservations. Any
// difference means a write bypassed the ledger.
const reservedDrift = query(`
  SELECT il.variant_id, il.location_id, il.reserved AS counter,
         COALESCE(SUM(CASE WHEN r.status = 'active' THEN r.quantity ELSE 0 END), 0) AS ledger
    FROM inventory_levels il
    LEFT JOIN stock_reservations r
           ON r.variant_id = il.variant_id AND r.location_id = il.location_id
   GROUP BY il.variant_id, il.location_id
  HAVING counter <> ledger
`);

const boundsViolations = query(`
  SELECT variant_id, location_id, on_hand, reserved
    FROM inventory_levels WHERE reserved > on_hand OR reserved < 0 OR on_hand < 0
`);

const orphanReservations = query(`
  SELECT r.id, r.order_id FROM stock_reservations r
    LEFT JOIN orders o ON o.id = r.order_id
   WHERE o.id IS NULL
`);

let failed = false;

if (reservedDrift.length > 0) {
  failed = true;
  console.error(`DRIFT: ${reservedDrift.length} inventory rows disagree with the ledger\n`);
  for (const row of reservedDrift.slice(0, 20)) {
    console.error(
      `  ${row.variant_id} @ ${row.location_id}: counter=${row.counter} ledger=${row.ledger}`,
    );
  }
  console.error("\n  The ledger wins. Investigate the write that bypassed it BEFORE correcting.");
  console.error("  Correct through a stock adjustment with a reason, never a bare UPDATE.\n");
} else {
  console.log("  PASS  reserved counters match active reservations");
}

if (boundsViolations.length > 0) {
  failed = true;
  console.error(`\nBOUNDS VIOLATION: ${boundsViolations.length} rows`);
  console.error("  The CHECK constraint should make this unreachable.");
  console.error("  If it fired, the oversell guard has been bypassed. This is a BUG.\n");
} else {
  console.log("  PASS  reserved within [0, on_hand] everywhere");
}

if (orphanReservations.length > 0) {
  failed = true;
  console.error(`\nORPHANS: ${orphanReservations.length} reservations with no order`);
} else {
  console.log("  PASS  no orphaned reservations");
}

if (failed) process.exit(1);
console.log("\nInventory reconciled.");
