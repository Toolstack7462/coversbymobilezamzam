/**
 * The saved views for the product list.
 *
 * These live in their own module for one reason: they are a **contract**
 * between screens that do not import each other. The action centre and the
 * setup centre both link to `/admin/prodotti?vista=senza-prezzo`; this file
 * decides whether that value exists. Keeping it here lets the contract test
 * check both ends without dragging the route's server imports — and therefore
 * the Cloudflare context, the auth stack and the database types — into a unit
 * test that only wants a list of strings.
 *
 * The `where` clauses are fixed SQL fragments written here in full. They are
 * never built from request data, so nothing user-supplied reaches the query.
 */

export interface ProductView {
  slug: string;
  label: string;
  /** A complete boolean SQL fragment over `products p`. */
  where: string;
}

export const PRODUCT_VIEWS: readonly ProductView[] = [
  { slug: "attivi", label: "Attivi", where: "p.archived_at IS NULL AND p.status = 'active'" },
  { slug: "tutti", label: "Tutti", where: "p.archived_at IS NULL" },
  { slug: "bozze", label: "Bozze", where: "p.archived_at IS NULL AND p.status = 'draft'" },
  {
    slug: "senza-prezzo",
    label: "Senza prezzo",
    where: `p.archived_at IS NULL AND NOT EXISTS (
              SELECT 1 FROM product_variants v
                JOIN variant_prices vp ON vp.variant_id = v.id
               WHERE v.product_id = p.id)`,
  },
  {
    slug: "senza-immagine",
    label: "Senza immagine",
    where: `p.archived_at IS NULL AND NOT EXISTS (
              SELECT 1 FROM product_images pi WHERE pi.product_id = p.id)`,
  },
  {
    slug: "senza-compatibilita",
    label: "Senza compatibilità",
    where: `p.archived_at IS NULL AND NOT EXISTS (
              SELECT 1 FROM product_compatibility pc WHERE pc.product_id = p.id)`,
  },
  { slug: "archiviati", label: "Archiviati", where: "p.archived_at IS NOT NULL" },
];

export const PRODUCT_VIEW_SLUGS = PRODUCT_VIEWS.map((v) => v.slug);
