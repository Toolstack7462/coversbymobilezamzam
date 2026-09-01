/**
 * What it means for a product to be in a category.
 *
 * ── The bug this replaces ────────────────────────────────────────────────────
 *
 * The storefront's category filter read exactly one table:
 *
 *     EXISTS (SELECT 1 FROM product_category_assignments pca
 *               JOIN categories c ON c.id = pca.category_id
 *              WHERE pca.product_id = p.id AND c.slug = ?)
 *
 * `product_category_assignments` is written by NOTHING. Not the admin, not the
 * seed, not the import scripts — a search of the repository finds one reader
 * and zero writers. Every product in the catalogue carries a
 * `primary_category_id` instead, and the filter never looked at it.
 *
 * So **every category page in the shop returned zero products**, for every
 * category, in every environment, since the filter was written. The catalogue
 * was reachable only through search or the unfiltered listing. It survived a
 * deployed-preview audit because an empty category is a legitimate state and
 * the page renders it correctly — the page was never wrong, the question it
 * asked was.
 *
 * ── The definition ───────────────────────────────────────────────────────────
 *
 * A product is in a category when EITHER holds:
 *
 *   - the category is its primary category, or
 *   - an explicit assignment row places it there;
 *
 * and in both cases, being in a DESCENDANT category counts as being in the
 * ancestor. Someone browsing "Cover e custodie" expects to see everything
 * beneath it; a parent category that lists nothing because its products all sit
 * one level down is the same empty page in a different disguise.
 *
 * Descendants are matched on `path`, so the boundary is the separator: a
 * category pathed `cover` matches `cover/rigide` and does NOT match a sibling
 * pathed `cover-xl`. Prefix matching without the separator is the classic way
 * this goes quietly wrong.
 *
 * ── Why this is one exported string ──────────────────────────────────────────
 *
 * Because the listing, the count for pagination, and anything added later must
 * agree. A listing and its own "N prodotti" disagreeing is a bug nobody can
 * explain from the outside, and it happens the moment the same idea is written
 * out twice.
 */

/**
 * SQL that is true when the product aliased `p` belongs to the category whose
 * slug is at the given bind position.
 *
 * @param bindIndex 1-based position of the slug parameter in the statement.
 */
export function categoryMembershipSql(bindIndex: number): string {
  return `EXISTS (
    SELECT 1
      FROM categories target
      JOIN categories c
        ON c.path = target.path OR c.path LIKE target.path || '/%'
     WHERE target.slug = ?${bindIndex}
       AND target.visible = 1
       AND target.archived_at IS NULL
       AND (
         p.primary_category_id = c.id
         OR EXISTS (
           SELECT 1 FROM product_category_assignments pca
            WHERE pca.product_id = p.id AND pca.category_id = c.id
         )
       )
  )`;
}
