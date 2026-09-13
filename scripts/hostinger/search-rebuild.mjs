/**
 * Rebuilds the MariaDB search tables from the catalogue.
 *
 *   node scripts/hostinger/search-rebuild.mjs
 *
 * Run after a data migration, after a bulk import, and by the consistency
 * check when the document count and the product count disagree.
 *
 * Safe to run at any time and safe to run twice: both tables are DERIVED, and
 * losing them entirely costs one rebuild rather than one byte of merchant data.
 * That is also why they are not in the backup.
 */

// From the COMPILED runtime, so this script exercises the same adapter and the
// same indexer the server runs. Requires `npm run build:server` first.
import { createMariaDb, rebuildAll } from "../../build/server-node/tools.js";

const config = {
  host: process.env.DB_HOST ?? "127.0.0.1",
  port: Number(process.env.DB_PORT ?? 3399),
  user: process.env.DB_USER ?? "root",
  password: process.env.DB_PASSWORD ?? "",
  database: process.env.DB_NAME ?? "zamzam_staging",
  connectionLimit: 4,
};

/**
 * Ids for the token rows.
 *
 * ULID-shaped rather than random, so a rebuild writes rows in key order and
 * InnoDB appends to the index instead of splitting pages across the whole
 * table — which on a catalogue of any size is the difference between a rebuild
 * that takes a second and one that takes a minute.
 */
const ids = (() => {
  let counter = 0;
  const prefix = Date.now().toString(36);
  return { generate: () => `${prefix}${(counter++).toString(36).padStart(10, "0")}` };
})();

const db = createMariaDb(config);
const started = Date.now();

try {
  const result = await rebuildAll(db, ids, Date.now());
  const elapsed = Date.now() - started;

  if (result.skipped === "not-applicable") {
    console.log("Not a MariaDB database — SQLite maintains its own FTS5 index through triggers.");
  } else {
    console.log(`Rebuilt in ${elapsed}ms`);
    console.log(`  products   ${result.products}`);
    console.log(`  documents  ${result.documents}`);
    console.log(`  tokens     ${result.tokens}`);
  }
} finally {
  await db.close();
}
