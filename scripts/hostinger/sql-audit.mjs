/**
 * Proves that every SQL statement in the application can run on MariaDB.
 *
 *   node scripts/hostinger/sql-audit.mjs [--json]
 *
 * The migration rests on one claim: the 453 statements written against D1 keep
 * working when the adapter underneath them changes. This is what makes that
 * claim checkable instead of hopeful — it extracts every statement from the
 * source and runs the real translator over it, so a statement that cannot be
 * translated fails here rather than in production.
 *
 * It is wired into `npm run verify`, which means a future change that
 * reintroduces `MATCH`, `RETURNING` or a conditional upsert stops CI. That is
 * the point: the hard part of this migration was finding the six constructs
 * that do not port, and nothing should have to find them twice.
 *
 * WHAT IT CANNOT SEE. A statement assembled from fragments across functions is
 * extracted as a fragment. Those are reported as `partial` and counted
 * separately rather than being claimed as verified — see the summary.
 *
 * DELIBERATELY DIALECT-SPECIFIC STATEMENTS. A handful of statements cannot be
 * written once — SQLite's conditional upsert and FTS5's MATCH have no MariaDB
 * equivalent at all. Those are written twice, chosen at runtime from
 * `db.dialect`, and marked in the SQL with
 *
 *     a leading block comment reading `dialect: sqlite` or `dialect: mariadb`.
 *
 * The marker is required, not optional: it is the only way an untranslatable
 * statement stops failing this audit, so "I ported this on purpose" has to be
 * written down where a reviewer reads the SQL rather than inferred from a
 * nearby if-statement.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

/**
 * The translator lives in TypeScript beside the adapter and is imported here
 * DIRECTLY, not reimplemented.
 *
 * Node strips the type annotations itself (22.18+ does it by default), which
 * is why dialect.ts avoids parameter properties and other syntax that
 * strip-only mode rejects. A copy of the rules in this script would be the one
 * thing the audit could not detect going stale.
 */
const { translate, UntranslatableSqlError } = await import(
  pathToFileURL(path.join(root, "app/infrastructure/db/dialect.ts")).href
);

// ── Extraction ──────────────────────────────────────────────────────────────

const SQL_START = /\b(?:SELECT|INSERT|UPDATE|DELETE|WITH|REPLACE)\b/i;

/**
 * Pulls template literals that look like SQL out of a source file.
 *
 * `${...}` interpolations become a neutral token, because what matters is
 * whether the FIXED text translates. An interpolated LIMIT or an assembled
 * WHERE clause is application logic; a `MATCH` written into the template is
 * not.
 */
function extractStatements(source) {
  const statements = [];
  let index = 0;

  while (index < source.length) {
    const tick = source.indexOf("`", index);
    if (tick === -1) break;

    let end = tick + 1;
    let text = "";

    while (end < source.length) {
      const ch = source[end];
      if (ch === "\\") {
        text += source[end + 1] ?? "";
        end += 2;
        continue;
      }
      if (ch === "$" && source[end + 1] === "{") {
        // Skip the interpolation, tracking nested braces so a template inside
        // it does not end the scan early.
        let depth = 1;
        let scan = end + 2;
        while (scan < source.length && depth > 0) {
          if (source[scan] === "{") depth += 1;
          else if (source[scan] === "}") depth -= 1;
          scan += 1;
        }
        text += " __INTERPOLATED__ ";
        end = scan;
        continue;
      }
      if (ch === "`") break;
      text += ch;
      end += 1;
    }

    if (SQL_START.test(text) && /\b(?:FROM|INTO|SET|VALUES|TABLE)\b/i.test(text)) {
      statements.push(text.trim());
    }
    index = end + 1;
  }

  return statements;
}

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (["node_modules", "build", ".git", ".react-router", ".wrangler"].includes(entry.name))
        continue;
      walk(full, out);
    } else if (/\.(ts|tsx|mjs)$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

// ── Run ─────────────────────────────────────────────────────────────────────

const SCAN_DIRS = ["app", "workers"];
const results = { ok: [], partial: [], ported: [], failed: [] };

/** A block comment reading `dialect: sqlite` — an explicit, reviewable opt-out. */
const DIALECT_MARKER = /\/\*\s*dialect:\s*(sqlite|mariadb)\s*\*\//i;

for (const dir of SCAN_DIRS) {
  for (const file of walk(path.join(root, dir))) {
    // The translator and its tests contain deliberately untranslatable SQL.
    if (file.includes(path.join("infrastructure", "db"))) continue;

    const relative = path.relative(root, file).replace(/\\/g, "/");
    for (const statement of extractStatements(fs.readFileSync(file, "utf8"))) {
      /*
       * An interpolation stands in for a table name, a column, an assembled
       * WHERE clause or a LIMIT — never for a bind placeholder, because the
       * codebase writes those literally. It is replaced with a bare identifier
       * rather than `?`: substituting a placeholder made statements that use
       * `?1` numbering look like they ALSO used anonymous `?`, and the
       * translator correctly refused to read one bind array two ways. Seven
       * statements were reported untranslatable for that reason alone.
       */
      const normalised = statement.replace(/__INTERPOLATED__/g, "interpolated_fragment");
      const isPartial = statement.includes("__INTERPOLATED__");

      const marker = DIALECT_MARKER.exec(statement);
      if (marker) {
        results.ported.push({ file: relative, dialect: marker[1].toLowerCase(), statement });
        continue;
      }

      try {
        translate(normalised);
        (isPartial ? results.partial : results.ok).push({ file: relative, statement });
      } catch (error) {
        if (error instanceof UntranslatableSqlError || error?.name === "UntranslatableSqlError") {
          results.failed.push({
            file: relative,
            reason: error.reason ?? error.message.split("\n")[0],
            statement: statement.replace(/\s+/g, " ").slice(0, 200),
          });
        } else {
          results.failed.push({
            file: relative,
            reason: `translator error: ${error.message.split("\n")[0]}`,
            statement: statement.replace(/\s+/g, " ").slice(0, 200),
          });
        }
      }
    }
  }
}

const total = results.ok.length + results.partial.length + results.failed.length;

if (process.argv.includes("--json")) {
  console.log(JSON.stringify(results, null, 2));
} else {
  console.log(`SQL portability audit — ${total} statements across ${SCAN_DIRS.join(", ")}\n`);
  console.log(`  translated cleanly                      ${results.ok.length}`);
  console.log(`  translated, with interpolated fragments  ${results.partial.length}`);
  console.log(`  explicitly ported per dialect            ${results.ported.length}`);
  console.log(`  UNTRANSLATABLE                           ${results.failed.length}`);

  if (results.ported.length > 0) {
    console.log("\nWritten twice on purpose, chosen from db.dialect:\n");
    for (const item of results.ported) {
      console.log(`  ${item.dialect.padEnd(8)} ${item.file}`);
    }
  }

  if (results.failed.length > 0) {
    console.log("\nStatements that cannot run on MariaDB:\n");
    const byFile = new Map();
    for (const failure of results.failed) {
      if (!byFile.has(failure.file)) byFile.set(failure.file, []);
      byFile.get(failure.file).push(failure);
    }
    for (const [file, failures] of byFile) {
      console.log(`  ${file}`);
      for (const failure of failures) {
        console.log(`    ${failure.reason}`);
        console.log(`      ${failure.statement}`);
      }
    }
    console.log("\nEach of these needs an explicit port, not a translator rule that guesses.");
  }
}

process.exit(results.failed.length === 0 ? 0 : 1);
