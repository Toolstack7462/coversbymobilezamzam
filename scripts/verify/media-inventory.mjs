/**
 * Media inventory cross-check.
 *
 * Checks BOTH directions, because each failure is a different problem:
 *   - a product_images row with no object  -> a broken image on the storefront
 *   - an object with no row                -> an orphan quietly costing storage
 */
import { execFileSync } from "node:child_process";

const args = process.argv.slice(2);
const dbIndex = args.indexOf("--db");
const DB = dbIndex >= 0 ? args[dbIndex + 1] : "ita-commerce";
const bucketIndex = args.indexOf("--bucket");
const BUCKET = bucketIndex >= 0 ? args[bucketIndex + 1] : "ita-commerce-media";
const REMOTE = args.includes("--remote");

function wrangler(wArgs) {
  return execFileSync(process.execPath, ["node_modules/wrangler/bin/wrangler.js", ...wArgs], {
    encoding: "utf8",
  });
}

const rows =
  JSON.parse(
    (() => {
      const out = wrangler([
        "d1",
        "execute",
        DB,
        REMOTE ? "--remote" : "--local",
        "--json",
        "--command",
        "SELECT object_key FROM product_images",
      ]);
      return out.slice(out.indexOf("["));
    })(),
  )[0]?.results ?? [];

const dbKeys = new Set(rows.map((r) => r.object_key));
console.log(`Database references ${dbKeys.size} media objects.`);

let bucketKeys;
try {
  const listing = wrangler(["r2", "object", "list", BUCKET, ...(REMOTE ? ["--remote"] : [])]);
  bucketKeys = new Set(
    listing
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("─") && !line.startsWith("Key")),
  );
} catch {
  console.error(`\nCould not list bucket ${BUCKET}. Check the name and your credentials.`);
  process.exit(1);
}

const missing = [...dbKeys].filter((k) => !bucketKeys.has(k));
const orphans = [...bucketKeys].filter((k) => !dbKeys.has(k));

if (missing.length > 0) {
  console.error(`\nMISSING OBJECTS (${missing.length}) — these render as broken images:`);
  for (const key of missing.slice(0, 20)) console.error(`  ${key}`);
}

if (orphans.length > 0) {
  console.log(`\nORPHANED OBJECTS (${orphans.length}) — stored but unreferenced:`);
  for (const key of orphans.slice(0, 20)) console.log(`  ${key}`);
  console.log("  Review before deleting: an object may belong to unpublished content.");
}

if (missing.length > 0) process.exit(1);
console.log("\nMedia inventory consistent.");
