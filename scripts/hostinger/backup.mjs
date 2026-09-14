/**
 * Takes a backup of the Hostinger database, brings it here, and RESTORES it to
 * prove it is a backup rather than a file.
 *
 *   npm run hostinger:backup
 *   npm run hostinger:backup -- --skip-restore   # dump and download only
 *
 * ── WHY THE RESTORE IS NOT OPTIONAL ─────────────────────────────────────────
 *
 * An untested backup is a belief. The failure modes are all quiet: a dump
 * truncated by a timeout, a table skipped because of a permission, a file that
 * gzips to something plausible and contains an error message. Every one of them
 * produces a file of about the right size, and every one is discovered on the
 * day it is needed.
 *
 * So this restores into a throwaway database on the LOCAL MariaDB and compares
 * the row count of every table against the live one. What it proves is that the
 * dump is complete and loadable. What it does not prove is Hostinger's own
 * restore path, because the database user has `ALL PRIVILEGES` on exactly one
 * database and cannot create another — creating one is an hPanel action, and
 * the honest thing is to say so rather than skip the check and imply it passed.
 *
 * ── WHAT IS NOT IN HERE ─────────────────────────────────────────────────────
 *
 * The media. Product photographs live on the filesystem, not in the database,
 * and they are content-addressed — the key contains a hash of the bytes — so a
 * backup of them is a copy of a directory. It is a separate job and pretending
 * this covers it would be the more dangerous kind of wrong.
 */

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import mysql from "mysql2/promise";

import { withSsh, mustRun } from "./lib/ssh.mjs";

const args = process.argv.slice(2);
const has = (name) => args.includes(`--${name}`);
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};

const OUT = flag("out", ".local/backups");
const REMOTE_DB = process.env.DB_NAME;
const REMOTE_USER = process.env.DB_USER;
const REMOTE_PASSWORD = process.env.DB_PASSWORD;

if (!REMOTE_DB || !REMOTE_USER || !REMOTE_PASSWORD) {
  console.error("DB_NAME, DB_USER and DB_PASSWORD must be set (the Hostinger database).");
  process.exit(1);
}

const stamp = new Date()
  .toISOString()
  .replace(/[:.]/g, "-")
  .replace(/-\d{3}Z$/, "Z");
const remoteFile = `/tmp/backup-${stamp}.sql.gz`;
const localFile = path.posix.join(OUT, `backup-${stamp}.sql.gz`);

fs.mkdirSync(OUT, { recursive: true });

console.log(`Backup of ${REMOTE_DB}\n`);

/** Row counts straight from the live database, to compare the restore against. */
let liveCounts = {};

await withSsh(async (ssh) => {
  /*
   * `--single-transaction` so the dump is consistent WITHOUT locking the
   * tables. Every table is InnoDB, so this gives a point-in-time view from one
   * transaction's snapshot and the shop keeps serving while it runs. A dump
   * that locks a live shop is a dump nobody dares schedule.
   *
   * `--set-gtid-purged` is not passed: it is a MySQL option and this is
   * MariaDB, where it is a syntax error rather than a no-op.
   */
  const dump =
    `MYSQL_PWD='${REMOTE_PASSWORD}' mysqldump -h localhost -u '${REMOTE_USER}' ` +
    `--single-transaction --quick --default-character-set=utf8mb4 ` +
    `--routines --events --triggers ` +
    `'${REMOTE_DB}' 2>/tmp/dump-err.txt | gzip -9 > ${remoteFile}; ` +
    `echo "exit=$?"; head -3 /tmp/dump-err.txt`;

  const result = await ssh.run(dump);
  const warnings = result.out.replace(/exit=\d+/, "").trim();
  if (warnings) console.log(`  mysqldump said: ${warnings}`);

  const size = await mustRun(ssh, `stat -c%s ${remoteFile}`, "sizing the dump");
  console.log(`  dumped ${(Number(size.trim()) / 1024).toFixed(0)} KB (gzip)`);

  // Download, then remove the copy on the shared host: a database dump sitting
  // in /tmp on shared hosting is a database dump on somebody else's machine.
  await new Promise((resolve, reject) => {
    ssh
      .run(`cat ${remoteFile} | base64 -w0`)
      .then(({ out }) => {
        fs.writeFileSync(localFile, Buffer.from(out.trim(), "base64"));
        resolve();
      })
      .catch(reject);
  });
  await ssh.run(`rm -f ${remoteFile} /tmp/dump-err.txt`);

  console.log(`  downloaded ${(fs.statSync(localFile).size / 1024).toFixed(0)} KB -> ${localFile}`);

  /*
   * EXACT counts, not information_schema's estimate.
   *
   * `table_rows` for InnoDB is a sampled guess and can be out by a large
   * fraction, which would make the comparison below meaningless in exactly the
   * case it exists for.
   */
  const listing = await mustRun(
    ssh,
    `MYSQL_PWD='${REMOTE_PASSWORD}' mysql -h localhost -u '${REMOTE_USER}' -D '${REMOTE_DB}' ` +
      `--batch --skip-column-names -e "SELECT table_name FROM information_schema.tables ` +
      `WHERE table_schema='${REMOTE_DB}' AND table_type='BASE TABLE' ORDER BY table_name"`,
    "listing tables",
  );
  const tables = listing.trim().split("\n").filter(Boolean);

  const unions = tables
    .map((t) => `SELECT '${t}' AS t, COUNT(*) AS n FROM \\\`${t}\\\``)
    .join(" UNION ALL ");
  const exact = await mustRun(
    ssh,
    `MYSQL_PWD='${REMOTE_PASSWORD}' mysql -h localhost -u '${REMOTE_USER}' -D '${REMOTE_DB}' ` +
      `--batch --skip-column-names -e "${unions}"`,
    "counting rows",
  );

  liveCounts = Object.fromEntries(
    exact
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        const [t, n] = line.split("\t");
        return [t, Number(n)];
      }),
  );
  const total = Object.values(liveCounts).reduce((a, b) => a + b, 0);
  console.log(`  live: ${tables.length} tables, ${total.toLocaleString()} rows`);
});

if (has("skip-restore")) {
  console.log(`\n  Dump only. Nothing has verified that it can be restored.`);
  process.exit(0);
}

// ── Restore, locally ─────────────────────────────────────────────────────────
const SCRATCH = flag("scratch", "zamzam_restorecheck");
const local = {
  host: process.env.TEST_DB_HOST ?? "127.0.0.1",
  port: Number(process.env.TEST_DB_PORT ?? 3399),
  user: process.env.TEST_DB_USER ?? "root",
  password: process.env.TEST_DB_PASSWORD ?? "",
};

if (!/restorecheck|test|scratch/i.test(SCRATCH)) {
  console.error(`Refusing to restore into "${SCRATCH}": the name must mark it as throwaway.`);
  process.exit(1);
}

console.log(`\n  restoring into ${SCRATCH} on ${local.host}:${local.port}`);

const admin = await mysql.createConnection(local);
await admin.query(`DROP DATABASE IF EXISTS \`${SCRATCH}\``);
await admin.query(
  `CREATE DATABASE \`${SCRATCH}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
);
await admin.end();

const plain = localFile.replace(/\.gz$/, "");
execFileSync("node", [
  "-e",
  `
  const fs=require('fs'), zlib=require('zlib');
  fs.writeFileSync(${JSON.stringify(plain)}, zlib.gunzipSync(fs.readFileSync(${JSON.stringify(localFile)})));
`,
]);

/*
 * The local MariaDB's own client, found the same way local-db.mjs finds the
 * server it starts.
 *
 * Not mysql2: a dump is not a list of statements a driver can be handed. It
 * carries comments, conditional /*!40101 … *\/ directives and DELIMITER
 * blocks, and splitting it on semicolons shreds a routine body — which is
 * precisely the kind of "restore succeeded" that has not.
 */
const MARIADB_HOME = path.join(
  process.env.HOSTINGER_WORK_DIR ?? path.join(os.homedir(), "hostinger-migration-work"),
  "mariadb",
  `mariadb-${process.env.MARIADB_VERSION ?? "10.11.19"}-winx64`,
);
const mysqlBin = path.join(
  MARIADB_HOME,
  "bin",
  process.platform === "win32" ? "mysql.exe" : "mysql",
);

if (!fs.existsSync(mysqlBin)) {
  console.error(
    `No local MariaDB client at ${mysqlBin}.
` + `Run \`npm run mariadb:start\` first, or pass --skip-restore to take the dump alone.`,
  );
  process.exit(1);
}

execFileSync(
  mysqlBin,
  [
    `--host=${local.host}`,
    `--port=${local.port}`,
    `--user=${local.user}`,
    ...(local.password ? [`--password=${local.password}`] : []),
    "--default-character-set=utf8mb4",
    SCRATCH,
  ],
  { stdio: ["pipe", "pipe", "pipe"], input: fs.readFileSync(plain) },
);

fs.rmSync(plain, { force: true });

// ── Compare ──────────────────────────────────────────────────────────────────
const check = await mysql.createConnection({ ...local, database: SCRATCH });
const [restoredRows] = await check.query(
  `SELECT table_name AS t FROM information_schema.tables
    WHERE table_schema = ? AND table_type = 'BASE TABLE' ORDER BY table_name`,
  [SCRATCH],
);

const differences = [];
let restoredTotal = 0;
for (const { t } of restoredRows) {
  const [[row]] = await check.query(`SELECT COUNT(*) AS n FROM \`${t}\``);
  restoredTotal += Number(row.n);
  if (liveCounts[t] === undefined) {
    differences.push(`${t}: in the restore, not in the live database`);
  } else if (Number(row.n) !== liveCounts[t]) {
    differences.push(`${t}: live ${liveCounts[t]}, restored ${row.n}`);
  }
}
for (const t of Object.keys(liveCounts)) {
  if (!restoredRows.some((r) => r.t === t))
    differences.push(`${t}: live only, missing from restore`);
}
await check.end();

console.log(`  restored: ${restoredRows.length} tables, ${restoredTotal.toLocaleString()} rows`);

if (differences.length > 0) {
  console.error(`\n  RESTORE DOES NOT MATCH:`);
  for (const d of differences) console.error(`    ${d}`);
  process.exit(1);
}

console.log(
  `\n  RESTORE VERIFIED — every table matches the live database row for row.\n` +
    `  Proven: the dump is complete and loadable.\n` +
    `  Not proven: Hostinger's own restore path. The database user has privileges\n` +
    `  on one database and cannot create another, so importing this file there is\n` +
    `  an hPanel action a person has to take.`,
);
