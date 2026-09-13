/**
 * The catalogue-search predicate, in both dialects.
 *
 * The storefront builds one SQL fragment — "products matching what the customer
 * typed" — and ANDs it into the collection query alongside the category, device
 * and price filters. This produces that fragment. Nothing else about the
 * collection query changes between engines.
 *
 * ── SQLITE ──────────────────────────────────────────────────────────────────
 *
 * FTS5, unchanged from what D1 runs today: one MATCH against the virtual table,
 * joined back through `product_search_map`.
 *
 * ── MARIADB, AND WHY IT IS NOT ONE MATCH ────────────────────────────────────
 *
 * InnoDB's FULLTEXT index does not index words shorter than
 * `innodb_ft_min_token_size`, which defaults to 3 and is a server-wide setting
 * that needs a restart. On managed shared hosting we do not get to change it.
 * The catalogue is full of two-character tokens customers actually type — `PD`,
 * `Qi` — and model designations FULLTEXT splits or drops: `S24`, `25W`,
 * `USB-C`.
 *
 * So each term is matched against EITHER the FULLTEXT document OR the token
 * table, and the terms are ANDed with each other. One subquery per term rather
 * than one boolean-mode expression for all of them, because that is what
 * preserves FTS5's semantics exactly: `cavo usb` means a product matching both
 * words, and a boolean-mode expression mixing indexed and non-indexed words
 * silently drops the short one instead of failing.
 *
 * At most `MAX_TERMS` (8) subqueries, each an index lookup on a table with one
 * row per product per locale. See docs/hostinger/test-evidence.md for the
 * measured plans.
 *
 * ── WHAT IS NOT REPRODUCED, DELIBERATELY ────────────────────────────────────
 *
 * FTS5's `rank`. The collection query never used it: with a search active it
 * still orders by `p.is_featured DESC, p.published_at DESC`. A comment in
 * collection.tsx claimed otherwise and was wrong; the behaviour, not the
 * comment, is what this preserves.
 */

import type { ParsedQuery } from "~/domain/search/query";
import type { SqlDialect } from "~/infrastructure/db/sql";

export interface SearchPredicate {
  /** A boolean SQL fragment, using `?N` placeholders. */
  sql: string;
  /** Values for those placeholders, in order. */
  binds: unknown[];
}

/**
 * @param dialect   which engine will run it
 * @param parsed    the parsed query; `null` predicate when nothing is searchable
 * @param bindsSoFar how many `?N` placeholders the caller has already used
 */
export function searchPredicate(
  dialect: SqlDialect,
  parsed: ParsedQuery,
  bindsSoFar: number,
  locale = "it",
): SearchPredicate | null {
  if (parsed.match === null || parsed.terms.length === 0) return null;

  if (dialect === "sqlite") {
    const n = bindsSoFar + 1;
    return {
      sql: `/* dialect: sqlite */
        p.id IN (
        SELECT m.product_id FROM product_search s
          JOIN product_search_map m ON m.rowid = s.rowid
         WHERE product_search MATCH ?${n})`,
      binds: [parsed.match],
    };
  }

  const clauses: string[] = [];
  const binds: unknown[] = [];
  let next = bindsSoFar;

  parsed.terms.forEach((term, index) => {
    const isLast = index === parsed.terms.length - 1;

    const localeParam = ++next;
    binds.push(locale);
    const againstParam = ++next;
    binds.push(booleanModeExpression(term, isLast));
    const localeParam2 = ++next;
    binds.push(locale);
    const tokenParam = ++next;
    binds.push(isLast ? `${term}%` : term);

    clauses.push(`/* dialect: mariadb */
      p.id IN (
      SELECT d.product_id FROM product_search_documents d
       WHERE d.locale = ?${localeParam}
         AND MATCH(d.document) AGAINST (?${againstParam} IN BOOLEAN MODE)
      UNION
      SELECT t.product_id FROM product_search_tokens t
       WHERE t.locale = ?${localeParam2}
         AND t.token LIKE ?${tokenParam})`);
  });

  return { sql: clauses.join("\n        AND "), binds };
}

/**
 * One term, as a boolean-mode expression.
 *
 * Boolean mode is a query language and the search box is not — the same reason
 * FTS5's MATCH is never handed raw input. The parser has already reduced the
 * term to letters, digits and internal hyphens, and every one of `+ - > < ( )
 * ~ * " @` is an operator here, so:
 *
 *   - a hyphen becomes a space, and the words are quoted as a PHRASE. Left
 *     alone, `usb-c` reads as "must contain usb, must NOT contain c", which
 *     returns the opposite of what was asked for.
 *   - a double quote cannot survive the parser, and is stripped again anyway,
 *     because relying on an invariant established elsewhere is how injection
 *     bugs get written.
 *   - `+` requires the term. That is the AND this function is asked for.
 *   - a trailing `*` on the last term makes search work as the customer types,
 *     matching FTS5's behaviour — but a wildcard cannot follow a phrase, so a
 *     hyphenated last term gets the phrase and no wildcard. The token table
 *     covers the prefix case for exactly those terms.
 */
function booleanModeExpression(term: string, allowPrefix: boolean): string {
  const cleaned = term.replace(/["'()<>~@+*-]+/g, " ").trim();
  if (cleaned === "") return `+"${term.replace(/["\\]/g, "")}"`;

  const words = cleaned.split(/\s+/).filter(Boolean);
  if (words.length > 1) return `+"${words.join(" ")}"`;

  return allowPrefix ? `+${words[0]}*` : `+${words[0]}`;
}
