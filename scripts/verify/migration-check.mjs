/**
 * Migration check.
 *
 * Regenerates migrations from the schema into a scratch directory and fails if
 * anything new would be produced - which means the schema has drifted ahead of
 * the committed SQL.
 *
 * Catches the common and expensive mistake: editing db/schema/*.ts, shipping it,
 * and discovering in production that the table never changed.
 */
import { execFileSync } from "node:child_process";
import { readdirSync, existsSync, rmSync, cpSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const MIGRATIONS = "db/migrations";

if (!existsSync(MIGRATIONS)) {
  console.error(`No ${MIGRATIONS}. Run "npm run db:generate".`);
  process.exit(1);
}

const before = readdirSync(MIGRATIONS)
  .filter((f) => f.endsWith(".sql"))
  .sort();
if (before.length === 0) {
  console.error('No migration files. Run "npm run db:generate".');
  process.exit(1);
}

const scratch = mkdtempSync(join(tmpdir(), "ita-migrations-"));
cpSync(MIGRATIONS, scratch, { recursive: true });

try {
  // Invoke drizzle-kit JS entry directly with this Node binary.
  // No shell (args would be concatenated, not escaped, and the scratch path is
  // interpolated) and no .cmd shim (Node refuses to spawn one without a shell).
  execFileSync(
    process.execPath,
    [
      "node_modules/drizzle-kit/bin.cjs",
      "generate",
      "--out",
      scratch,
      "--schema",
      "./db/schema/index.ts",
      "--dialect",
      "sqlite",
    ],
    { stdio: ["ignore", "pipe", "pipe"] },
  );

  const after = readdirSync(scratch)
    .filter((f) => f.endsWith(".sql"))
    .sort();
  const added = after.filter((f) => !before.includes(f));

  if (added.length > 0) {
    console.error("SCHEMA DRIFT: the Drizzle schema is ahead of the committed migrations.\n");
    console.error(`  Would generate: ${added.join(", ")}`);
    console.error('\nRun "npm run db:generate" and commit the result.');
    process.exit(1);
  }

  console.log(`Migrations in sync with the schema (${before.length} files).`);
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
