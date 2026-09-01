/**
 * Takes the [DEMO] prefixes off the catalogue and widens the device list.
 *
 * ── Why the prefixes are going ───────────────────────────────────────────────
 *
 * They did a real job: while the preview carried invented prices and stock, a
 * name that said so on every card was the honest thing to show. That job is now
 * done by the preview banner and by robots.txt, and the prefix had started
 * costing more than it bought — every product, category and brand name on the
 * page opened with a bracketed word that reads as a fault to anyone shown the
 * site cold.
 *
 * The data is still demonstration data. Nothing here makes it real, and the
 * banner still says so.
 *
 * ── Device brands ────────────────────────────────────────────────────────────
 *
 * The catalogue had two. A shop that answers "will this fit my phone?" needs to
 * recognise the phones people actually walk in with, and in Italy that is not
 * only Apple and Samsung.
 *
 * Brands are created with NO models beneath them. A brand with no models
 * returns nothing from the finder, which is correct and visible; inventing
 * model names and compatibility records would put fits in front of a customer
 * that nobody has verified.
 *
 *   node scripts/import/seed-catalogue-polish.mjs --env preview --remote
 */
import { execFileSync } from "node:child_process";

const args = process.argv.slice(2);
const ENVIRONMENT = args.indexOf("--env") >= 0 ? args[args.indexOf("--env") + 1] : null;
const REMOTE = args.includes("--remote");

/** Handles are stable; the display name is what changes. */
const DEVICE_BRANDS = [
  ["apple-demo", "Apple", 1],
  ["samsung-demo", "Samsung", 2],
  ["xiaomi", "Xiaomi", 3],
  ["google", "Google Pixel", 4],
  ["oppo", "Oppo", 5],
  ["oneplus", "OnePlus", 6],
  ["huawei", "Huawei", 7],
  ["motorola", "Motorola", 8],
];

const d1 = (sql) =>
  execFileSync(
    process.execPath,
    [
      "node_modules/wrangler/bin/wrangler.js",
      "d1",
      "execute",
      "DB",
      ...(ENVIRONMENT ? ["--env", ENVIRONMENT] : []),
      REMOTE ? "--remote" : "--local",
      "--json",
      "--command",
      sql,
    ],
    { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 },
  );

console.log("Removing [DEMO] prefixes…");

// TRIM so the leading space left behind by the prefix goes with it.
for (const [table, column] of [
  ["product_translations", "name"],
  ["category_translations", "name"],
  ["brands", "name"],
  ["device_models", "name"],
  ["device_families", "name"],
  ["device_brands", "name"],
]) {
  d1(
    `UPDATE ${table} SET ${column} = TRIM(REPLACE(${column}, '[DEMO]', '')) WHERE ${column} LIKE '%[DEMO]%'`,
  );
  console.log(`  ${table}.${column}`);
}

// Descriptions carried it too.
d1(
  `UPDATE product_translations SET short_description = TRIM(REPLACE(short_description, '[DEMO]', ''))
    WHERE short_description LIKE '%[DEMO]%'`,
);

console.log("\nWidening the device brand list…");

for (const [handle, name, order] of DEVICE_BRANDS) {
  d1(
    `INSERT INTO device_brands (id, handle, name, sort_order, active, created_at, updated_at)
     VALUES ('dbr_${handle.replace(/-/g, "_")}', '${handle}', '${name}', ${order}, 1, ${Date.now()}, ${Date.now()})
     ON CONFLICT(handle) DO UPDATE SET name = excluded.name, sort_order = excluded.sort_order`,
  );
  console.log(`  ${name}`);
}

console.log(`
Done.

The catalogue is still demonstration data. Removing the prefix does not make a
price real, and the preview banner and robots.txt still say so.

Brands beyond Apple and Samsung have NO models yet, so the device finder will
show them and find nothing under them. That is the honest state: a model list
is something the merchant fills in, and inventing one would put unverified fits
in front of a customer.
`);
