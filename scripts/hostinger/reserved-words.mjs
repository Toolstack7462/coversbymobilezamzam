/**
 * Finds identifiers in this schema that MariaDB treats as reserved words.
 *
 *   node scripts/hostinger/reserved-words.mjs
 *
 * ── WHY THIS IS PROBED RATHER THAN LOOKED UP ────────────────────────────────
 *
 * SQLite reserves almost nothing, so `SELECT key, value FROM store_settings` is
 * ordinary SQL there and a syntax error in MariaDB. Which words are reserved
 * differs between MariaDB versions and between MariaDB and MySQL, and
 * `information_schema.keywords` on MariaDB lists every keyword without saying
 * which are reserved — so a hardcoded list would be right for the version it
 * was written against and quietly wrong on the version the merchant's plan
 * runs.
 *
 * So each identifier is asked of the actual server:
 *
 *     SELECT <identifier> FROM DUAL
 *
 * A reserved word fails to PARSE (error 1064). An ordinary word parses and
 * fails to RESOLVE (error 1054). The difference is exact and needs no list.
 *
 * The output feeds RESERVED_IDENTIFIERS in app/infrastructure/db/dialect.ts,
 * and re-running it against the merchant's server after capability check C-2
 * is how that list is confirmed for the version they actually have.
 */

import mysql from "mysql2/promise";

const DB = {
  host: process.env.DB_HOST ?? "127.0.0.1",
  port: Number(process.env.DB_PORT ?? 3399),
  user: process.env.DB_USER ?? "root",
  password: process.env.DB_PASSWORD ?? "",
  database: process.env.DB_NAME ?? "zamzam_staging",
};

const connection = await mysql.createConnection(DB);

try {
  const [version] = await connection.query("SELECT VERSION() AS v");
  console.log(`Probing ${version[0].v}\n`);

  const [identifiers] = await connection.query(
    `SELECT DISTINCT name FROM (
        SELECT column_name AS name FROM information_schema.columns WHERE table_schema = ?
        UNION
        SELECT table_name AS name FROM information_schema.tables WHERE table_schema = ?
      ) AS everything ORDER BY name`,
    [DB.database, DB.database],
  );

  const reserved = [];
  for (const { name } of identifiers) {
    try {
      await connection.query(`SELECT ${name} FROM DUAL`);
      // Parsed AND resolved: only possible for something like a function name.
    } catch (error) {
      // 1054 = unknown column. It parsed, so the word is not reserved.
      if (error.errno === 1054) continue;
      // 1064 = parse error. The word is reserved.
      if (error.errno === 1064) {
        reserved.push(name);
        continue;
      }
      // Anything else is worth seeing rather than assuming.
      console.error(`  ? ${name}: ${error.code} ${error.message.slice(0, 80)}`);
    }
  }

  console.log(`Identifiers checked: ${identifiers.length}`);
  console.log(`Reserved by this server: ${reserved.length}\n`);
  for (const word of reserved) console.log(`  ${word}`);

  console.log(
    "\nCopy this list into RESERVED_IDENTIFIERS in app/infrastructure/db/dialect.ts.\n" +
      "Each one must be backticked wherever the application writes it unquoted.",
  );
  console.log(
    `\nconst RESERVED_IDENTIFIERS = new Set([\n${reserved.map((w) => `  "${w}",`).join("\n")}\n]);`,
  );
} finally {
  await connection.end();
}
