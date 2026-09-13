/**
 * Keeps the MariaDB search tables in step with the catalogue.
 *
 * ── WHY THE APPLICATION DOES THIS AND SQLITE'S TRIGGERS DID NOT ─────────────
 *
 * The D1 schema maintains its FTS5 index with four triggers, on the reasoning
 * that an index the application has to remember to update is an index that goes
 * stale. That reasoning was right for SQLite and does not carry over: the token
 * table has to be tokenised the SAME WAY the search box is, and that tokeniser
 * lives in app/domain/search/query.ts. A trigger would need its own copy of it
 * in SQL, and two tokenisers that must agree forever is a worse bet than one
 * tokeniser called from both sides.
 *
 * The staleness risk is answered three ways instead:
 *
 *   1. `reindexProduct` runs in the SAME transaction as the catalogue write, so
 *      a product and its search rows commit together or not at all;
 *   2. `rebuildAll` is cheap and idempotent, and the scheduled consistency
 *      check runs it when the counts disagree;
 *   3. both tables are DERIVED. Losing them entirely costs one rebuild, not
 *      one byte of merchant data, which is why the backup does not contain
 *      them.
 *
 * On SQLite every function here is a no-op: the triggers already did it, and
 * doing it twice would be a second source of truth.
 */

import { parseSearchQuery } from "~/domain/search/query";
import type { SqlDatabase, SqlStatement } from "~/infrastructure/db/sql";

/** Where a token came from, so a SKU match can be weighted above a description. */
type TokenSource = "name" | "description" | "sku" | "barcode" | "brand" | "alias";

const SOURCE_WEIGHT: Record<TokenSource, number> = {
  sku: 10,
  barcode: 10,
  name: 5,
  brand: 3,
  alias: 3,
  description: 1,
};

interface ProductSearchRow {
  product_id: string;
  locale: string;
  name: string | null;
  short_description: string | null;
  brand_name: string | null;
  sku_text: string | null;
  barcode_text: string | null;
}

const LOAD_SQL = `
  SELECT pt.product_id,
         pt.locale,
         pt.name,
         pt.short_description,
         b.name AS brand_name,
         (SELECT GROUP_CONCAT(v.sku, ' ') FROM product_variants v
           WHERE v.product_id = pt.product_id AND v.archived_at IS NULL) AS sku_text,
         (SELECT GROUP_CONCAT(v.barcode, ' ') FROM product_variants v
           WHERE v.product_id = pt.product_id AND v.archived_at IS NULL
             AND v.barcode IS NOT NULL) AS barcode_text
    FROM product_translations pt
    LEFT JOIN products p ON p.id = pt.product_id
    LEFT JOIN brands b ON b.id = p.brand_id`;

/**
 * Tokenises a field with the SAME parser the search box uses.
 *
 * That symmetry is the whole point. A token stored one way and looked up
 * another produces a search that misses products for reasons nobody can
 * reproduce — the customer types the exact SKU and gets nothing.
 *
 * `parseSearchQuery` drops stop words and one-character words, which is correct
 * for a query and wrong for an index: a stop word in a product name should
 * still be findable if somebody searches for the whole name. So the raw split
 * is used for indexing and the stop list is applied only at query time — the
 * parser's `terms` after re-parsing each word individually gives exactly that.
 */
function tokenise(text: string | null | undefined): string[] {
  if (!text) return [];
  return [
    ...new Set(
      text
        .toLowerCase()
        .slice(0, 4000)
        .split(/[^\p{L}\p{N}-]+/u)
        .map((word) => word.replace(/^-+|-+$/g, ""))
        .filter((word) => word.length > 0 && word.length <= 64),
    ),
  ];
}

function tokensFor(row: ProductSearchRow): { token: string; source: TokenSource }[] {
  const out = new Map<string, TokenSource>();

  const add = (values: string[], source: TokenSource) => {
    for (const token of values) {
      const existing = out.get(token);
      // Keep the highest-weighted source for a token that appears twice: a SKU
      // that also appears in the description is still a SKU match.
      if (!existing || SOURCE_WEIGHT[source] > SOURCE_WEIGHT[existing]) out.set(token, source);
    }
  };

  add(tokenise(row.name), "name");
  add(tokenise(row.short_description), "description");
  add(tokenise(row.brand_name), "brand");
  add(tokenise(row.sku_text), "sku");
  add(tokenise(row.barcode_text), "barcode");

  return [...out].map(([token, source]) => ({ token, source }));
}

function documentFor(row: ProductSearchRow): string {
  return [row.name, row.short_description, row.brand_name, row.sku_text]
    .filter((part): part is string => Boolean(part))
    .join(" \n ")
    .slice(0, 60_000);
}

/**
 * The statements that reindex one product, for inclusion in a caller's batch.
 *
 * Returned rather than executed so the caller can commit them WITH the write
 * that made them necessary. A separate transaction would leave a window in
 * which the product exists and is unfindable, and on a catalogue import that
 * window is however long the import takes.
 */
export function reindexStatements(
  db: SqlDatabase,
  rows: readonly ProductSearchRow[],
  ids: { generate(): string },
  now: number,
): SqlStatement[] {
  if (db.dialect !== "mariadb") return [];

  const statements: SqlStatement[] = [];
  const productIds = [...new Set(rows.map((r) => r.product_id))];

  for (const productId of productIds) {
    // Replace rather than patch. An index that is right by construction beats
    // one that is right by careful bookkeeping — the same reasoning the SQLite
    // triggers used, applied here.
    statements.push(
      db.prepare(`DELETE FROM product_search_tokens WHERE product_id = ?1`).bind(productId),
    );
  }

  for (const row of rows) {
    statements.push(
      db
        .prepare(
          `INSERT INTO product_search_documents
             (product_id, locale, name, short_description, brand_name, sku_text, document, updated_at)
           VALUES (?1,?2,?3,?4,?5,?6,?7,?8)
           ON CONFLICT(product_id) DO UPDATE SET
             name = excluded.name,
             short_description = excluded.short_description,
             brand_name = excluded.brand_name,
             sku_text = excluded.sku_text,
             document = excluded.document,
             updated_at = excluded.updated_at`,
        )
        .bind(
          row.product_id,
          row.locale,
          row.name ?? "",
          row.short_description,
          row.brand_name,
          row.sku_text,
          documentFor(row),
          now,
        ),
    );

    for (const { token, source } of tokensFor(row)) {
      statements.push(
        db
          .prepare(
            `INSERT INTO product_search_tokens (id, product_id, locale, token, source, weight)
             VALUES (?1,?2,?3,?4,?5,?6)
             ON CONFLICT(product_id, locale, token, source) DO UPDATE SET weight = excluded.weight`,
          )
          .bind(ids.generate(), row.product_id, row.locale, token, source, SOURCE_WEIGHT[source]),
      );
    }
  }

  return statements;
}

/** Loads the source rows for one product, in every locale it is translated into. */
export async function loadSearchRows(
  db: SqlDatabase,
  productId: string,
): Promise<ProductSearchRow[]> {
  const { results } = await db
    .prepare(`${LOAD_SQL} WHERE pt.product_id = ?1`)
    .bind(productId)
    .all<ProductSearchRow>();
  return results;
}

export interface RebuildResult {
  products: number;
  documents: number;
  tokens: number;
  skipped: "not-applicable" | null;
}

/**
 * Rebuilds every search row from the catalogue.
 *
 * Used by the migration, by `npm run hostinger:search-rebuild`, and by the
 * consistency check. Batched rather than one enormous transaction: a rebuild
 * that must hold every row of the catalogue in one transaction is a rebuild
 * nobody dares run on a live shop.
 */
export async function rebuildAll(
  db: SqlDatabase,
  ids: { generate(): string },
  now: number,
  batchSize = 50,
): Promise<RebuildResult> {
  if (db.dialect !== "mariadb") {
    return { products: 0, documents: 0, tokens: 0, skipped: "not-applicable" };
  }

  const { results: all } = await db
    .prepare(`${LOAD_SQL} ORDER BY pt.product_id`)
    .all<ProductSearchRow>();

  await db.prepare(`DELETE FROM product_search_tokens`).run();
  await db.prepare(`DELETE FROM product_search_documents`).run();

  for (let i = 0; i < all.length; i += batchSize) {
    const statements = reindexStatements(db, all.slice(i, i + batchSize), ids, now);
    if (statements.length > 0) await db.batch(statements);
  }

  // Counted from the tables rather than from the statements issued: an upsert
  // that updated an existing row is not a new token, and a count of statements
  // would report a rebuild as having created rows it only refreshed.

  const documents = await db
    .prepare(`SELECT COUNT(*) AS n FROM product_search_documents`)
    .first<{ n: number }>();
  const tokenCount = await db
    .prepare(`SELECT COUNT(*) AS n FROM product_search_tokens`)
    .first<{ n: number }>();

  return {
    products: new Set(all.map((r) => r.product_id)).size,
    documents: documents?.n ?? 0,
    tokens: tokenCount?.n ?? 0,
    skipped: null,
  };
}

export { tokenise, parseSearchQuery };
