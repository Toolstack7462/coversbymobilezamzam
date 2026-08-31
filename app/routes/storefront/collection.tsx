import { Link, Form, useLocation } from "react-router";
import type { Route } from "./+types/collection";
import { cloudflareContext } from "../../../workers/app";
import { parseLocalePath, translator, localePath, plural } from "~/lib/i18n";
import { ProductCard, type ProductCardData } from "~/components/storefront/product-card";
import { availabilityState } from "~/domain/inventory/availability";
import { parseSearchQuery, emptySearchReason } from "~/domain/search/query";

const PER_PAGE = 24;

/**
 * The listing page.
 *
 * Filter and sort state lives in the URL, so browser back and forward work, a
 * filtered view is shareable, and the no-JavaScript path is real pagination
 * rather than an inert button.
 */
export function meta() {
  return [
    { title: "Tutti gli accessori" },
    {
      name: "description",
      content: "Cover, cavi, caricabatterie e pellicole per smartphone.",
    },
  ];
}

/** Availability for a card. See the identical helper on the homepage. */
function availabilityFor(row: {
  on_hand: number | null;
  reserved: number | null;
  reorder_threshold: number | null;
}) {
  if (row.on_hand === null) return null;
  return availabilityState({
    variantId: "",
    locationId: "",
    onHand: row.on_hand,
    reserved: row.reserved ?? 0,
    incoming: 0,
    reorderThreshold: row.reorder_threshold,
    allowBackorder: false,
  });
}

export async function loader({ context, request }: Route.LoaderArgs) {
  const { env } = context.get(cloudflareContext);
  const url = new URL(request.url);

  const q = url.searchParams.get("q")?.trim() ?? "";
  const categoria = url.searchParams.get("categoria")?.trim() ?? "";
  const dispositivo = url.searchParams.get("dispositivo")?.trim() ?? "";
  const sort = url.searchParams.get("ordina") ?? "relevance";
  const page = Math.max(1, Number(url.searchParams.get("pagina") ?? "1") || 1);

  const where: string[] = ["p.status = 'active'", "p.archived_at IS NULL"];
  const binds: unknown[] = [];

  if (categoria) {
    binds.push(categoria);
    where.push(`EXISTS (
      SELECT 1 FROM product_category_assignments pca
        JOIN categories c ON c.id = pca.category_id
       WHERE pca.product_id = p.id AND c.slug = ?${binds.length})`);
  }

  // Device filtering reads product_compatibility, never a title or a tag
  // (invariant 3). `incompatible` is excluded explicitly.
  if (dispositivo) {
    binds.push(dispositivo);
    where.push(`EXISTS (
      SELECT 1 FROM product_compatibility pc
        JOIN device_models dm ON dm.id = pc.device_model_id
       WHERE pc.product_id = p.id
         AND dm.handle = ?${binds.length}
         AND pc.compatibility_level <> 'incompatible')`);
  }

  /*
   * Full-text search, replacing `LOWER(name) LIKE '%term%'`.
   *
   * A leading-wildcard LIKE cannot use an index, so every search was a full
   * scan of every product name — fine at fifty products, not at five hundred —
   * and it could not rank, so the best match arrived in whatever order the
   * table happened to hold it.
   *
   * `parsed.match` is built by the domain from the customer's words: quoted
   * terms only, never their raw input, because FTS5's MATCH is a query language
   * and a stray quotation mark in a search box would otherwise be a 500.
   */
  const parsed = parseSearchQuery(q);
  if (parsed.match !== null) {
    binds.push(parsed.match);
    where.push(`p.id IN (
      SELECT m.product_id FROM product_search s
        JOIN product_search_map m ON m.rowid = s.rowid
       WHERE product_search MATCH ?${binds.length})`);
  }

  // With a search active, "relevance" means FTS5's own ranking rather than
  // the merchant's featured order — the customer asked a question, and the
  // answer to it outranks the shop's own preferences.
  const orderBy =
    sort === "price_asc"
      ? "price_amount ASC"
      : sort === "price_desc"
        ? "price_amount DESC"
        : sort === "newest"
          ? "p.published_at DESC"
          : "p.is_featured DESC, p.published_at DESC";

  const clause = where.join(" AND ");

  const [rows, count] = await Promise.all([
    env.DB.prepare(
      `SELECT p.slug, pt.name, b.name AS brand_name,
              (SELECT amount FROM variant_prices vp
                 JOIN product_variants v ON v.id = vp.variant_id
                WHERE v.product_id = p.id ORDER BY vp.amount ASC LIMIT 1) AS price_amount,
              (SELECT object_key FROM product_images pi
                WHERE pi.product_id = p.id
                ORDER BY pi.is_primary DESC, pi.sort_order ASC LIMIT 1) AS image_key,
              (SELECT il.on_hand FROM inventory_levels il
                 JOIN product_variants v ON v.id = il.variant_id
                WHERE v.product_id = p.id ORDER BY il.on_hand DESC LIMIT 1) AS on_hand,
              (SELECT il.reserved FROM inventory_levels il
                 JOIN product_variants v ON v.id = il.variant_id
                WHERE v.product_id = p.id ORDER BY il.on_hand DESC LIMIT 1) AS reserved,
              (SELECT il.reorder_threshold FROM inventory_levels il
                 JOIN product_variants v ON v.id = il.variant_id
                WHERE v.product_id = p.id ORDER BY il.on_hand DESC LIMIT 1) AS reorder_threshold
         FROM products p
         LEFT JOIN product_translations pt ON pt.product_id = p.id AND pt.locale = 'it'
         LEFT JOIN brands b ON b.id = p.brand_id
        WHERE ${clause}
        ORDER BY ${orderBy}
        LIMIT ${PER_PAGE} OFFSET ${(page - 1) * PER_PAGE}`,
    )
      .bind(...binds)
      .all<{
        slug: string;
        name: string | null;
        brand_name: string | null;
        price_amount: number | null;
        image_key: string | null;
        on_hand: number | null;
        reserved: number | null;
        reorder_threshold: number | null;
      }>(),
    env.DB.prepare(
      `SELECT COUNT(*) AS n FROM products p
         LEFT JOIN product_translations pt ON pt.product_id = p.id AND pt.locale = 'it'
        WHERE ${clause}`,
    )
      .bind(...binds)
      .first<{ n: number }>(),
  ]);

  return {
    // Where product images are served from. A CDN base if one is configured,
    // otherwise the app's own /media route.
    mediaBaseUrl: env.PUBLIC_MEDIA_BASE_URL?.replace(/\/$/, "") ?? "/media",
    products: rows.results
      .filter((r) => r.price_amount !== null)
      .map<ProductCardData>((r) => ({
        slug: r.slug,
        name: r.name ?? r.slug,
        brandName: r.brand_name,
        priceAmount: r.price_amount!,
        imageKey: r.image_key,
        availability: availabilityFor(r),
      })),
    total: count?.n ?? 0,
    page,
    perPage: PER_PAGE,
    filters: { q, categoria, dispositivo, sort },
    // Null unless every word was a stop word. "Nessun risultato" is true and
    // unhelpful; this distinguishes "we have nothing" from "try other words".
    searchHint: emptySearchReason(parsed, "it"),
  };
}

export default function Collection({ loaderData }: Route.ComponentProps) {
  const { pathname, search } = useLocation();
  const { locale } = parseLocalePath(pathname);
  const t = translator(locale);
  const path = (p: string) => localePath(locale, p);

  const { products, total, page, perPage, filters } = loaderData;
  const lastPage = Math.max(1, Math.ceil(total / perPage));

  const pageHref = (n: number) => {
    const params = new URLSearchParams(search);
    params.set("pagina", String(n));
    return `${path("/shop")}?${params.toString()}`;
  };

  return (
    <div className="page section stack">
      <nav aria-label="breadcrumb" className="small muted">
        <Link to={path("/")}>{t("common.home")}</Link> / <span>{t("common.shop")}</span>
      </nav>

      <h1>{filters.q ? `${t("common.search")}: ${filters.q}` : t("common.shop")}</h1>
      <p className="muted" role="status">
        {plural(t, "collection.results", total)}
      </p>

      {/* A real GET form: sorting works without JavaScript and the result is a
          shareable URL. */}
      <Form method="get" action={path("/shop")} className="cluster">
        {filters.q ? <input type="hidden" name="q" value={filters.q} /> : null}
        {filters.categoria ? (
          <input type="hidden" name="categoria" value={filters.categoria} />
        ) : null}
        {filters.dispositivo ? (
          <input type="hidden" name="dispositivo" value={filters.dispositivo} />
        ) : null}
        <div className="field">
          <label className="field__label" htmlFor="ordina">
            {t("collection.sort")}
          </label>
          <select id="ordina" name="ordina" className="input" defaultValue={filters.sort}>
            <option value="relevance">{t("collection.sort_relevance")}</option>
            <option value="price_asc">{t("collection.sort_price_asc")}</option>
            <option value="price_desc">{t("collection.sort_price_desc")}</option>
            <option value="newest">{t("collection.sort_newest")}</option>
          </select>
        </div>
        <button type="submit" className="btn btn--secondary">
          {t("common.continue")}
        </button>
      </Form>

      {products.length === 0 ? (
        <div className="empty-state">
          <h2>{t("collection.no_results")}</h2>
          <p>{t("collection.no_results_help")}</p>
          <p>
            <Link className="btn btn--secondary" to={path("/shop")}>
              {t("collection.clear_filters")}
            </Link>
          </p>
        </div>
      ) : (
        <div className="grid-products">
          {products.map((product) => (
            <ProductCard
              key={product.slug}
              product={product}
              locale={locale}
              t={t}
              mediaBaseUrl={loaderData.mediaBaseUrl}
            />
          ))}
        </div>
      )}

      {/* Real pagination links, not infinite scroll: back works, and the page
          is reachable without JavaScript. */}
      {lastPage > 1 ? (
        <nav className="cluster" aria-label="pagination">
          {page > 1 ? (
            <Link className="btn btn--secondary" to={pageHref(page - 1)} rel="prev">
              {t("common.back")}
            </Link>
          ) : null}
          <span className="small muted numeric">
            {page} / {lastPage}
          </span>
          {page < lastPage ? (
            <Link className="btn btn--secondary" to={pageHref(page + 1)} rel="next">
              {t("collection.load_more")}
            </Link>
          ) : null}
        </nav>
      ) : null}
    </div>
  );
}
