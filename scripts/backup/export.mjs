/**
 * Database backup.
 *
 * Writes a timestamped SQL dump to backups/, which is gitignored: a dump holds
 * real customer and order data and must never enter version control.
 *
 * MANDATORY before any remote migration.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, existsSync, statSync } from "node:fs";
import { join } from "node:path";

const DB = process.env.D1_DATABASE_NAME ?? "ita-commerce";
const REMOTE = process.argv.includes("--remote");
const DIR = "backups";

if (!existsSync(DIR)) mkdirSync(DIR, { recursive: true });

const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const target = join(DIR, `${DB}-${REMOTE ? "remote" : "local"}-${stamp}.sql`);

const args = ["node_modules/wrangler/bin/wrangler.js", "d1", "export", DB, "--output", target];
if (REMOTE) args.push("--remote");
else args.push("--local");

console.log(`Exporting ${DB} (${REMOTE ? "remote" : "local"}) → ${target}`);

try {
  // Direct JS entry, no shell: arguments are not escaped by a shell, and the
  // target path is interpolated.
  execFileSync(process.execPath, args, { stdio: "inherit" });
} catch (error) {
  console.error("\nBackup FAILED. Do not proceed with a migration.");
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}

if (!existsSync(target) || statSync(target).size === 0) {
  console.error("\nBackup file is missing or empty. Do NOT treat this as a backup.");
  process.exit(1);
}

console.log(`\nBackup written: ${target} (${(statSync(target).size / 1024).toFixed(1)} KB)`);
console.log("Remember: a backup nobody has restored is not a backup.");
console.log("Run `npm run restore:test` against a disposable database.");
