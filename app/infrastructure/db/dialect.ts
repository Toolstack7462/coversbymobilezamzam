/**
 * SQLite -> MariaDB statement translation.
 *
 * WHY THIS EXISTS RATHER THAN 453 REWRITTEN QUERIES.
 *
 * The application holds 453 hand-written SQL statements across 68 files. Every
 * one of them was reviewed when it was written, several encode an invariant
 * that is not obvious from reading them, and the test suite that covers them
 * asserts behaviour rather than SQL text. Rewriting all of them by hand for a
 * hosting change would be 453 opportunities to alter a WHERE clause nobody
 * notices until an order is wrong.
 *
 * So the statements stay as they are, and this function makes them mean the
 * same thing to MariaDB. It is a translator for the constructs this codebase
 * actually uses — not a general one. Anything it does not recognise as safe
 * it THROWS on, at the moment of preparation, because a translator that passes
 * unfamiliar SQL through unchanged is worse than no translator: it silently
 * changes behaviour instead of failing.
 *
 * Every rule below exists because a specific statement in this repository
 * needs it. The scan in `npm run hostinger:sql-audit` re-derives that list
 * from the source, so a new statement using something untranslatable fails CI
 * rather than production.
 */

export class UntranslatableSqlError extends Error {
  /*
   * Written as plain fields rather than TypeScript parameter properties.
   *
   * Node's type stripping is syntax-only and rejects parameter properties,
   * which would be an obscure limitation to work around except that
   * scripts/hostinger/sql-audit.mjs imports this module DIRECTLY under plain
   * Node — so that the portability audit runs the real translator instead of a
   * copy of it. A second copy of these rules would be the one thing the audit
   * cannot detect going stale.
   */
  readonly reason: string;
  readonly sql: string;

  constructor(reason: string, sql: string) {
    super(`${reason}\n\n  ${sql.trim().replace(/\s+/g, " ").slice(0, 300)}`);
    this.name = "UntranslatableSqlError";
    this.reason = reason;
    this.sql = sql;
  }
}

export interface TranslatedStatement {
  /** MariaDB SQL, with `?` placeholders in binding order. */
  sql: string;
  /**
   * Where each positional `?` takes its value from in the ORIGINAL bind array.
   *
   * SQLite's `?1` numbering lets one value be bound to several placeholders,
   * and this codebase relies on that — `VALUES (?1, ?2, ?3, ?4, ?4)` writes
   * one timestamp to created_at and updated_at. MariaDB has only anonymous
   * `?`, so the value has to be repeated, and this array says how.
   */
  parameterOrder: number[];
}

/**
 * Splits SQL into runs of code and runs of string literal.
 *
 * Every rewrite below must skip string contents. A product description
 * containing the word `excluded.` is data, and a translator that edits it has
 * corrupted the catalogue.
 */
function mapOutsideStrings(sql: string, transform: (code: string) => string): string {
  const out: string[] = [];
  let index = 0;
  while (index < sql.length) {
    const quote = sql.indexOf("'", index);
    if (quote === -1) {
      out.push(transform(sql.slice(index)));
      break;
    }
    out.push(transform(sql.slice(index, quote)));

    // Find the closing quote, honouring SQL's doubled-quote escape.
    let end = quote + 1;
    while (end < sql.length) {
      if (sql[end] === "'") {
        if (sql[end + 1] === "'") {
          end += 2;
          continue;
        }
        break;
      }
      end += 1;
    }
    out.push(sql.slice(quote, end + 1));
    index = end + 1;
  }
  return out.join("");
}

/**
 * A copy of the SQL with every string literal blanked to same-length filler.
 *
 * Structural scanning — matching parentheses, finding top-level commas — has to
 * ignore what is inside a literal, and it has to do so WITHOUT changing any
 * offsets, because the rewrites slice the original text by index. Replacing
 * the contents with `x` of the same length gives a string that is safe to scan
 * and lines up character-for-character with the real one.
 *
 * The alternative, splitting the statement into code and string runs and
 * scanning each run separately, is what the first version of this file did.
 * It was wrong: `MAX(0, reserved - (SELECT ... WHERE status = 'active'))`
 * splits in the MIDDLE of the parentheses, so the scan saw an unbalanced
 * fragment and threw on a statement that is perfectly ordinary. The SQL audit
 * caught it; nothing else would have, because that statement is the
 * order-cancellation path.
 */
function maskStrings(sql: string): string {
  const chars = sql.split("");
  for (const [start, end] of stringLiteralRanges(sql)) {
    for (let i = start; i < end; i += 1) chars[i] = "x";
  }
  return chars.join("");
}

/**
 * Rewrites a two-or-more-argument MIN/MAX into LEAST/GREATEST.
 *
 * THIS ONE IS NOT COSMETIC. In SQLite, `MAX(0, reserved - 1)` is the scalar
 * two-argument maximum and clamps a stock release at zero. In MySQL and
 * MariaDB, `MAX` is an AGGREGATE function and `MAX(0, reserved - 1)` is a
 * syntax error — which is the good case. The bad case is the single-argument
 * form slipping through somewhere and silently aggregating a column across
 * every row of a join.
 *
 * Both call sites in this repository are stock arithmetic:
 *   expire-reservations  MAX(0, reserved - ?)   clamps a release
 *   cart.server          MIN(99, quantity + ?)  clamps a cart line
 *   orders (cancel)      MAX(0, reserved - (SELECT ...))
 *
 * Getting any of them wrong corrupts inventory, so the rewrite is precise: it
 * only fires when the call has a top-level comma, which is exactly when SQLite
 * meant the scalar form.
 */
function rewriteScalarMinMax(sql: string): string {
  let result = sql;

  for (let guard = 0; guard < 200; guard += 1) {
    const mask = maskStrings(result);
    // The word boundary matters: without it this matches the tail of `ADMIN(`.
    const pattern = /\b(MIN|MAX)\s*\(/gi;
    let match: RegExpExecArray | null;
    let rewrote = false;

    while ((match = pattern.exec(mask)) !== null) {
      const openParen = match.index + match[0].length - 1;
      const close = matchingParen(mask, openParen);
      if (close === -1) throw new UntranslatableSqlError("Unbalanced parentheses", sql);

      if (!hasTopLevelComma(mask.slice(openParen + 1, close))) continue; // Aggregate.

      const replacement = match[1]?.toUpperCase() === "MIN" ? "LEAST" : "GREATEST";
      // The tail after `close` has to come back. Dropping it truncated the
      // statement at the closing parenthesis — every WHERE clause after a
      // clamp silently disappeared, which turns `UPDATE ... SET reserved =
      // GREATEST(0, reserved - ?) WHERE variant_id = ?` into an unconditional
      // update of the whole inventory table.
      result =
        result.slice(0, match.index) +
        replacement +
        result.slice(openParen, close + 1) +
        result.slice(close + 1);
      rewrote = true;
      break;
    }

    if (!rewrote) return result;
  }

  throw new UntranslatableSqlError("MIN/MAX rewrite did not converge", sql);
}

function matchingParen(sql: string, openIndex: number): number {
  let depth = 0;
  for (let i = openIndex; i < sql.length; i += 1) {
    if (sql[i] === "(") depth += 1;
    else if (sql[i] === ")") {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function hasTopLevelComma(text: string): boolean {
  let depth = 0;
  for (const ch of text) {
    if (ch === "(") depth += 1;
    else if (ch === ")") depth -= 1;
    else if (ch === "," && depth === 0) return true;
  }
  return false;
}

/**
 * `ON CONFLICT (...) DO UPDATE SET ...` -> `ON DUPLICATE KEY UPDATE ...`.
 *
 * MariaDB's form names no conflict target: it fires on ANY unique-key
 * collision. For every upsert in this codebase that is the same thing, because
 * each table involved has exactly one unique key that the statement could
 * violate — verified by hostinger:sql-audit against the generated schema.
 *
 * `DO NOTHING` maps to `INSERT IGNORE`, which is handled before this runs.
 *
 * A conflict clause with its own WHERE has NO MariaDB equivalent and throws.
 * There is one such statement (the installation claim in bootstrap-admin) and
 * it is ported by hand, because a conditional upsert whose condition silently
 * disappeared would let two installers claim the shop at once.
 */
function rewriteUpsert(sql: string): string {
  const conflict = /\bON\s+CONFLICT\s*(\([^)]*\))?\s*DO\s+/i.exec(sql);
  if (!conflict) return sql;

  const afterDo = sql.slice(conflict.index + conflict[0].length);

  if (/^NOTHING/i.test(afterDo)) {
    throw new UntranslatableSqlError(
      "ON CONFLICT DO NOTHING must be written as INSERT OR IGNORE so the translation is explicit",
      sql,
    );
  }
  if (!/^UPDATE\s+SET/i.test(afterDo)) {
    throw new UntranslatableSqlError("Unrecognised ON CONFLICT clause", sql);
  }

  const setClause = afterDo.replace(/^UPDATE\s+SET\s+/i, "");
  if (/\bWHERE\b/i.test(setClause)) {
    throw new UntranslatableSqlError(
      "ON CONFLICT ... DO UPDATE ... WHERE has no MariaDB equivalent. " +
        "Port this statement explicitly (see bootstrap-admin.ts) rather than dropping the condition",
      sql,
    );
  }

  return (
    sql.slice(0, conflict.index) +
    "ON DUPLICATE KEY UPDATE " +
    // SQLite names the would-be-inserted row `excluded`; MariaDB uses
    // `VALUES(col)`. MariaDB 10.11 supports no `new.` row alias.
    setClause.replace(/\bexcluded\.([A-Za-z_][\w]*)/gi, "VALUES(`$1`)")
  );
}

/**
 * `GROUP_CONCAT(x, '<sep>')` -> `GROUP_CONCAT(x SEPARATOR '<sep>')`.
 *
 * This one cannot use `mapOutsideStrings`, because the construct SPANS a
 * string literal: the separator is one. So the call site is located outside
 * any literal, and only then is the whole call parsed.
 *
 * Both engines default to a comma, so the single-argument form — which is what
 * all five call sites in the application use — needs nothing. The two-argument
 * form appears in the search rebuild, where a space separator is what makes
 * several SKUs tokenise as several words rather than one.
 */
function rewriteGroupConcat(sql: string): string {
  const literals = stringLiteralRanges(sql);
  const insideLiteral = (index: number) =>
    literals.some(([start, end]) => index >= start && index < end);

  const pattern = /\bGROUP_CONCAT\s*\(/gi;
  let result = "";
  let cursor = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(sql)) !== null) {
    if (insideLiteral(match.index)) continue;

    const openParen = match.index + match[0].length - 1;
    const close = matchingParen(sql, openParen);
    if (close === -1) continue;

    const args = sql.slice(openParen + 1, close);
    if (!hasTopLevelComma(args)) continue;

    const separatorAt = lastTopLevelComma(args);
    const expression = args.slice(0, separatorAt).trim();
    const separator = args.slice(separatorAt + 1).trim();

    // Only a literal separator is rewritten. An expression separator is not
    // something this codebase writes, and guessing at one would be worse than
    // leaving MariaDB to reject it.
    if (!/^'(?:[^']|'')*'$/.test(separator)) continue;

    result += sql.slice(cursor, match.index);
    result += `GROUP_CONCAT(${expression} SEPARATOR ${separator})`;
    cursor = close + 1;
    pattern.lastIndex = close + 1;
  }

  return result + sql.slice(cursor);
}

function lastTopLevelComma(text: string): number {
  let depth = 0;
  let last = -1;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (ch === "(") depth += 1;
    else if (ch === ")") depth -= 1;
    else if (ch === "," && depth === 0) last = i;
  }
  return last;
}

/** Half-open [start, end) ranges of every single-quoted literal. */
function stringLiteralRanges(sql: string): [number, number][] {
  const ranges: [number, number][] = [];
  let index = 0;
  while (index < sql.length) {
    const quote = sql.indexOf("'", index);
    if (quote === -1) break;
    let end = quote + 1;
    while (end < sql.length) {
      if (sql[end] === "'") {
        if (sql[end + 1] === "'") {
          end += 2;
          continue;
        }
        break;
      }
      end += 1;
    }
    ranges.push([quote, end + 1]);
    index = end + 1;
  }
  return ranges;
}

/** Constructs that must never be silently translated. */
const FORBIDDEN: { pattern: RegExp; reason: string }[] = [
  {
    pattern: /\bMATCH\b/i,
    reason:
      "FTS5 MATCH has no MariaDB equivalent. Search goes through the SearchIndex port " +
      "(app/infrastructure/search), which uses FULLTEXT plus exact-token lookup",
  },
  {
    pattern: /\bRETURNING\b/i,
    reason: "RETURNING is not supported for UPDATE in MariaDB. Read the row back explicitly",
  },
  { pattern: /\bPRAGMA\b/i, reason: "PRAGMA is SQLite-only" },
  {
    pattern: /\bAUTOINCREMENT\b/i,
    reason: "Use AUTO_INCREMENT; this statement is DDL and belongs in db/mariadb",
  },
  {
    pattern: /\bjson_extract\s*\(/i,
    reason: "Use JSON_EXTRACT with MariaDB's argument order, explicitly",
  },
  {
    pattern: /\bstrftime\s*\(/i,
    reason: "strftime is SQLite-only; timestamps in this schema are epoch millis",
  },
  { pattern: /\bunixepoch\s*\(/i, reason: "unixepoch is SQLite-only" },
  { pattern: /\bGLOB\b/i, reason: "GLOB is SQLite-only" },
];

/**
 * Converts SQLite's numbered placeholders to MariaDB's positional ones.
 *
 * `?1 ... ?4 ... ?4` becomes `? ... ? ... ?` with a parameter order of
 * [0, 3, 3], so the caller's bind array is expanded to match.
 *
 * A statement may use numbered OR anonymous placeholders, never both: mixing
 * them means two different readings of the same bind array, and the codebase
 * uses each style in different files.
 */
function rewritePlaceholders(sql: string): { sql: string; parameterOrder: number[] } {
  const parameterOrder: number[] = [];
  let anonymousCount = 0;
  let numberedCount = 0;

  const rewritten = mapOutsideStrings(sql, (code) =>
    code.replace(/\?(\d*)/g, (_match, digits: string) => {
      if (digits === "") {
        parameterOrder.push(-1); // Filled in below, in encounter order.
        anonymousCount += 1;
      } else {
        parameterOrder.push(Number(digits) - 1);
        numberedCount += 1;
      }
      return "?";
    }),
  );

  if (anonymousCount > 0 && numberedCount > 0) {
    throw new UntranslatableSqlError(
      "Statement mixes ?N and ? placeholders; the bind array would be read two ways",
      sql,
    );
  }

  if (anonymousCount > 0) {
    for (let i = 0; i < parameterOrder.length; i += 1) parameterOrder[i] = i;
  }

  return { sql: rewritten, parameterOrder };
}

/**
 * Translates one statement.
 *
 * Pure, synchronous and cached by the adapter: the same statement text is
 * prepared on every request and translating it each time would be work done
 * hundreds of times per page for an identical answer.
 */
export function translate(sql: string): TranslatedStatement {
  for (const { pattern, reason } of FORBIDDEN) {
    if (pattern.test(stripStrings(sql))) throw new UntranslatableSqlError(reason, sql);
  }

  let working = sql;

  // `INSERT OR IGNORE` -> `INSERT IGNORE`. Used once, for the search-map
  // backfill, where the ignore is the intent rather than a way to survive bad
  // data — the data migration tooling never uses it (see docs/hostinger).
  working = working.replace(/\bINSERT\s+OR\s+IGNORE\b/gi, "INSERT IGNORE");
  working = working.replace(/\bINSERT\s+OR\s+REPLACE\b/gi, "REPLACE");

  // SQLite's random-id idiom. MariaDB has RANDOM_BYTES from 10.10. A plain
  // token swap, so the per-chunk pass is safe for it.
  working = mapOutsideStrings(working, (code) =>
    code.replace(/\brandomblob\s*\(/gi, "RANDOM_BYTES("),
  );

  // These two scan ACROSS string literals rather than around them, so each
  // takes the whole statement. See maskStrings for why splitting it first was
  // wrong.
  working = rewriteScalarMinMax(working);
  working = rewriteGroupConcat(working);

  working = rewriteUpsert(working);

  const { sql: finalSql, parameterOrder } = rewritePlaceholders(working);
  return { sql: finalSql, parameterOrder };
}

function stripStrings(sql: string): string {
  return mapOutsideStrings(sql, (code) => code).replace(/'(?:[^']|'')*'/g, "''");
}

/** Expands a caller's bind array into MariaDB's positional order. */
export function orderParameters(
  values: readonly unknown[],
  parameterOrder: readonly number[],
): unknown[] {
  return parameterOrder.map((index) => {
    const value = values[index];
    // `undefined` is not a SQL value. mysql2 would send it as NULL, which is
    // how a missing bind turns into a nulled column instead of an error.
    if (value === undefined) {
      throw new Error(
        `Bind parameter ?${index + 1} is undefined (${values.length} values supplied). ` +
          "Pass null explicitly for an absent value.",
      );
    }
    return value;
  });
}
