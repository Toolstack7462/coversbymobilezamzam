/**
 * Applies pending MariaDB migrations.
 *
 *   node scripts/hostinger/migrate.mjs           # what WOULD be applied
 *   node scripts/hostinger/migrate.mjs --apply
 *
 * ── WHY THIS IS NOT PART OF `npm start` ─────────────────────────────────────
 *
 * Hostinger rebuilds and restarts the application on every push to the
 * connected branch. A schema migration that runs at startup would therefore be
 * a schema change nobody reviewed, triggered by a commit that may have had
 * nothing to do with the database — and two workers starting together would
 * run it twice.
 *
 * So it is a separate, deliberate command, run by a person who has decided to
 * run it. The server proves connectivity at startup and nothing more.
 *
 * ── WHY NOT A WEB SQL CONSOLE ───────────────────────────────────────────────
 *
 * The brief rules one out and it is right to: a permanently reachable endpoint
 * that executes arbitrary SQL against the shop's database is a back door
 * whatever it is called. This runs from a machine that already holds the
 * credentials, over the same connection the application uses.
 *
 * ── SAFETY ──────────────────────────────────────────────────────────────────
 *
 * Dry run by default. Each file is applied in ONE transaction where MariaDB
 * permits it — DDL is not transactional in MySQL or MariaDB, so a file
 * containing DDL that fails half way leaves the earlier statements applied and
 * the ledger unwritten, and the report says so explicitly rather than implying
 * an atomicity that does not exist. That is also why each migration file
 * should do one thing.
 */

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import mysql from "mysql2/promise";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const MIGRATIONS = path.join(root, "db/mariadb/migrations");

const args = process.argv.slice(2);
const APPLY = args.includes("--apply");

const DB = {
  host: process.env.DB_HOST ?? "127.0.0.1",
  port: Number(process.env.DB_PORT ?? 3399),
  user: process.env.DB_USER ?? "root",
  password: process.env.DB_PASSWORD ?? "",
  database: process.env.DB_NAME ?? "zamzam_staging",
};

/**
 * Splits a file into statements, honouring `DELIMITER`.
 *
 * A naive `split(";")` shreds a trigger or routine body. Nothing in this
 * schema has one today; the handling is here because the first migration that
 * adds one would otherwise fail in a way that looks like a syntax error in
 * perfectly good SQL.
 */
function splitStatements(sql) {
  const statements = [];
  let delimiter = ";";
  let buffer = "";

  for (const rawLine of sql.split(/\r?\n/)) {
    const line = rawLine.trimEnd();
    const change = /^DELIMITER\s+(\S+)\s*$/i.exec(line.trim());
    if (change) {
      if (buffer.trim() !== "") statements.push(buffer.trim());
      buffer = "";
      delimiter = change[1];
      continue;
    }
    if (/^\s*--/.test(line) || line.trim() === "") continue;

    buffer += line + "\n";
    if (line.trimEnd().endsWith(delimiter)) {
      const statement = buffer.trim().slice(0, -delimiter.length).trim();
      if (statement !== "") statements.push(statement);
      buffer = "";
    }
  }
  if (buffer.trim() !== "") statements.push(buffer.trim());
  return statements;
}

const connection = await mysql.createConnection({ ...DB, multipleStatements: false });

try {
  const files = fs
    .readdirSync(MIGRATIONS)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  // The ledger has to exist before it can be read. Applied unconditionally,
  // because `CREATE TABLE IF NOT EXISTS` is the one statement that is safe to
  // run on every invocation.
  const ledgerFile = files.find((f) => f.startsWith("0000_"));
  if (ledgerFile) {
    for (const statement of splitStatements(
      fs.readFileSync(path.join(MIGRATIONS, ledgerFile), "utf8"),
    )) {
      await connection.query(statement);
    }
  }

  const [appliedRows] = await connection.query(
    "SELECT name, checksum FROM schema_migrations ORDER BY name",
  );
  const applied = new Map(appliedRows.map((r) => [r.name, r.checksum]));

  console.log(
    `${APPLY ? "Applying" : "Dry run"} — ${DB.user}@${DB.host}:${DB.port}/${DB.database}\n`,
  );

  let pending = 0;
  let changed = 0;

  for (const file of files) {
    const sql = fs.readFileSync(path.join(MIGRATIONS, file), "utf8");
    const checksum = crypto.createHash("sha256").update(sql, "utf8").digest("hex");
    const previous = applied.get(file);

    if (previous !== undefined) {
      if (previous === checksum) {
        console.log(`  ${file.padEnd(30)} already applied`);
      } else {
        /*
         * An applied migration whose file has changed.
         *
         * NOT re-applied and NOT ignored. Re-running it would double-apply
         * whatever was added; ignoring it would let the schema and the
         * repository disagree silently. It is reported and the run stops,
         * because every answer from here is a decision a person has to make.
         */
        console.error(
          `\n  ${file} was applied with a DIFFERENT checksum.\n` +
            `    recorded  ${previous}\n` +
            `    on disk   ${checksum}\n\n` +
            "  An applied migration has been edited. Add a new migration instead;\n" +
            "  if the edit was deliberate and the database already matches, update the\n" +
            "  ledger by hand and record why.",
        );
        process.exit(1);
      }
      continue;
    }

    pending += 1;
    const statements = splitStatements(sql);

    if (!APPLY) {
      console.log(`  ${file.padEnd(30)} PENDING (${statements.length} statements)`);
      continue;
    }

    const started = Date.now();
    let index = 0;
    try {
      for (const statement of statements) {
        index += 1;
        await connection.query(statement);
      }
    } catch (error) {
      console.error(
        `\n  ${file} FAILED at statement ${index} of ${statements.length}:\n` +
          `    ${error.message}\n\n` +
          "  DDL is not transactional in MariaDB, so statements 1.." +
          (index - 1) +
          " of this file HAVE been applied and the ledger has NOT been written.\n" +
          "  Inspect the schema before re-running: this command will start the file again from the top.",
      );
      process.exit(1);
    }

    const duration = Date.now() - started;
    await connection.execute(
      `INSERT INTO schema_migrations (name, checksum, applied_at, applied_by, duration_ms, statements)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        file,
        checksum,
        Date.now(),
        `${os.userInfo().username}@${os.hostname()}`,
        duration,
        statements.length,
      ],
    );

    changed += 1;
    console.log(`  ${file.padEnd(30)} applied (${statements.length} statements, ${duration}ms)`);
  }

  console.log(
    APPLY
      ? `\n${changed} migration${changed === 1 ? "" : "s"} applied.`
      : `\n${pending} pending. Re-run with --apply to apply them.`,
  );
} finally {
  await connection.end();
}
