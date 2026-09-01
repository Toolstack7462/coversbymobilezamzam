import { Link, Form, useLocation, useRouteLoaderData } from "react-router";
import type { Route } from "./+types/collection";
import { categoryMembershipSql } from "~/domain/catalogue/category-membership";
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

  // Primary category OR an explicit assignment, and descendants count. The
  // definition lives in one place because the listing and its own count must
  // agree — see app/domain/catalogue/category-membership.ts, which also records
  // why this query used to return nothing at all.
  if (categoria) {
    binds.push(categoria);
    where.push(categoryMembershipSql(binds.length));
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

  /*
   * Everything the page needs to be more than a grid.
   *
   * Four small reads, run together. Each is bounded and indexed; the page was
   * already doing one query for products and one for the count, and these add
   * no round trip because they share the same batch.
   */
  const [brandCount, activeCategory, activeDevice, categoryOptions, deviceOptions] =
    await Promise.all([
      /*
       * How many brands the catalogue actually carries.
       *
       * A product card prints the maker as an eyebrow, which is useful in a
       * shop that stocks several and pure noise in one that stocks one — the
       * demo catalogue is entirely "Marchio generico", so every card repeated
       * it. Counted rather than hardcoded: the day a second brand is added the
       * eyebrow returns on its own.
       */
      env.DB.prepare(
        `SELECT COUNT(DISTINCT p.brand_id) AS n
           FROM products p
          WHERE p.status = 'active' AND p.archived_at IS NULL AND p.brand_id IS NOT NULL`,
      ).first<{ n: number }>(),
      // The editorial header: a category's own name and description, written by
      // the merchant. Absent description renders nothing rather than filler.
      categoria
        ? env.DB.prepare(
            `SELECT ct.name, ct.description, c.image_key
             FROM categories c
             JOIN category_translations ct ON ct.category_id = c.id AND ct.locale = 'it'
            WHERE c.slug = ?1 AND c.visible = 1 AND c.archived_at IS NULL`,
          )
            .bind(categoria)
            .first<{ name: string; description: string | null; image_key: string | null }>()
        : null,

      // The device the customer is filtering by, so the page can say so in words
      // rather than leaving a query string to be decoded.
      dispositivo
        ? env.DB.prepare(
            `SELECT dm.name, db.name AS brand_name
             FROM device_models dm
             JOIN device_families df ON df.id = dm.device_family_id
             JOIN device_brands db ON db.id = df.device_brand_id
            WHERE dm.handle = ?1 AND dm.active = 1`,
          )
            .bind(dispositivo)
            .first<{ name: string; brand_name: string }>()
        : null,

      env.DB.prepare(
        `SELECT c.slug, ct.name
         FROM categories c
         LEFT JOIN category_translations ct ON ct.category_id = c.id AND ct.locale = 'it'
        WHERE c.visible = 1 AND c.archived_at IS NULL AND c.depth = 0
        ORDER BY c.sort_order ASC LIMIT 12`,
      ).all<{ slug: string; name: string | null }>(),

      /*
       * Devices worth offering, ordered by how many products fit them.
       *
       * A device filter that leads to an empty grid is worse than no filter: it
       * tells the customer the shop cannot help them when in fact the shop was
       * never asked the right question.
       */
      env.DB.prepare(
        `SELECT dm.handle, dm.name, db.name AS brand_name,
              COUNT(DISTINCT pc.product_id) AS product_count
         FROM device_models dm
         JOIN device_families df ON df.id = dm.device_family_id
         JOIN device_brands db ON db.id = df.device_brand_id
         JOIN product_compatibility pc ON pc.device_model_id = dm.id
                                      AND pc.compatibility_level <> 'incompatible'
         JOIN products p ON p.id = pc.product_id
                        AND p.status = 'active' AND p.archived_at IS NULL
        WHERE dm.active = 1
        GROUP BY dm.id
       HAVING product_count > 0
        ORDER BY product_count DESC, dm.name ASC
        LIMIT 6`,
      ).all<{ handle: string; name: string; brand_name: string; product_count: number }>(),
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
        brandName: (brandCount?.n ?? 0) > 1 ? r.brand_name : null,
        priceAmount: r.price_amount!,
        imageKey: r.image_key,
        availability: availabilityFor(r),
      })),
    total: count?.n ?? 0,
    page,
    perPage: PER_PAGE,
    filters: { q, categoria, dispositivo, sort },
    activeCategory,
    activeDevice,
    categoryOptions: categoryOptions.results.filter((c) => c.name),
    deviceOptions: deviceOptions.results,
    // Null unless every word was a stop word. "Nessun risultato" is true and
    // unhelpful; this distinguishes "we have nothing" from "try other words".
    searchHint: emptySearchReason(parsed, "it"),
  };
}

export default function Collection({ loaderData }: Route.ComponentProps) {
  /*
   * The store gate, from the layout that already computed it.
   *
   * Not a second settings query: the shell loads the snapshot once per request
   * and every gate on the page answers from it. Optional by type, so a render
   * outside the layout degrades to "no counter" rather than crashing.
   */
  const shell = useRouteLoaderData("routes/storefront/layout") as
    { gates?: { store?: boolean } } | undefined;
  const showStore = shell?.gates?.store === true;

  const { pathname, search } = useLocation();
  const { locale } = parseLocalePath(pathname);
  const t = translator(locale);
  const path = (p: string) => localePath(locale, p);

  const { products, total, page, perPage, filters, activeCategory, activeDevice } = loaderData;
  const lastPage = Math.max(1, Math.ceil(total / perPage));

  /*
   * Filter links preserve everything except the page number.
   *
   * Dropping `pagina` matters: page 3 of "all products" is not page 3 of
   * "iPhone 16 Pro", and keeping it lands the customer on an empty page that
   * looks like a shop with nothing in it.
   */
  const withParam = (key: string, value: string) => {
    const params = new URLSearchParams(search);
    params.set(key, value);
    params.delete("pagina");
    return `${path("/shop")}?${params.toString()}`;
  };

  const clearedHref = (key: string) => {
    const params = new URLSearchParams(search);
    params.delete(key);
    params.delete("pagina");
    const query = params.toString();
    return query ? `${path("/shop")}?${query}` : path("/shop");
  };

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

      {/*
        An editorial header, not a bare title.
        The heading answers "where am I", the lead answers "why would I buy
        here" — and the lead is the merchant's own category description, so a
        category they have not written about renders a heading alone rather
        than filler prose.
      */}
      {/*
        A banner when the category has a photograph, a heading when it does not.

        The image already exists — every category carries one, and the homepage
        tiles have shown them since they were added. This page was the only
        place a customer arrived at a category and saw no picture of it, which
        made a category page look like a filtered list rather than a department.

        The scrim is the same guaranteed floor the homepage tiles use: the
        merchant can change the photograph, so contrast cannot depend on which
        one is there today.
      */}
      <header
        className={`collection-head${activeCategory?.image_key ? " collection-head--media" : ""}`}
      >
        {activeCategory?.image_key ? (
          <img
            className="collection-head__image"
            src={`${loaderData.mediaBaseUrl}/${activeCategory.image_key}`}
            alt=""
            /* Decorative: the category is named in the heading over it, and
               describing the photograph again would make a screen reader read
               the department twice. */
            aria-hidden="true"
            fetchPriority="high"
          />
        ) : null}

        <div className="collection-head__body">
          {activeCategory ? <p className="eyebrow">{t("common.shop")}</p> : null}
          <h1 className="collection-head__title">
            {filters.q
              ? `${t("common.search")}: ${filters.q}`
              : (activeCategory?.name ?? t("common.shop"))}
          </h1>

          {activeCategory?.description ? (
            <p className="collection-head__lead">{activeCategory.description}</p>
          ) : null}

          {/* The device filter said in words. A query string is not a sentence. */}
          {activeDevice ? (
            <p className="collection-head__device">
              {t("collection.filtered_by_device", {
                device: `${activeDevice.brand_name} ${activeDevice.name}`,
              })}{" "}
              <Link className="collection-head__clear" to={clearedHref("dispositivo")}>
                {t("collection.clear_device")}
              </Link>
            </p>
          ) : null}
        </div>
      </header>

      {/*
        Filters as links, not a form.
        Every combination is a real URL: shareable, bookmarkable, and the back
        button behaves. A JavaScript filter panel would be faster to click and
        would break all three.
      */}
      {loaderData.deviceOptions.length > 0 ? (
        <section className="filter-row" aria-label={t("collection.filter_device")}>
          <h2 className="filter-row__label">{t("collection.filter_device")}</h2>
          <ul className="cluster">
            {loaderData.deviceOptions.map((device) => {
              const active = filters.dispositivo === device.handle;
              return (
                <li key={device.handle}>
                  <Link
                    className="chip"
                    to={
                      active ? clearedHref("dispositivo") : withParam("dispositivo", device.handle)
                    }
                    aria-current={active ? "true" : undefined}
                  >
                    {device.name}
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      {loaderData.categoryOptions.length > 0 ? (
        <section className="filter-row" aria-label={t("collection.filter_category")}>
          <h2 className="filter-row__label">{t("collection.filter_category")}</h2>
          <ul className="cluster">
            {loaderData.categoryOptions.map((category) => {
              const active = filters.categoria === category.slug;
              return (
                <li key={category.slug}>
                  <Link
                    className="chip"
                    to={active ? clearedHref("categoria") : withParam("categoria", category.slug)}
                    aria-current={active ? "true" : undefined}
                  >
                    {category.name}
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      {/*
        The toolbar: how many results, how they are ordered, and a way out.

        These three were scattered — the count sat under the description at the
        top of the page, the sort control floated alone in the middle, and its
        submit button said "Continua". That is the generic `common.continue`
        string, reused because it was there; it told the customer they were
        continuing to somewhere, when the button re-sorts a list they are
        already looking at. It says "Applica" now, from its own key.

        Still a real GET form, so sorting works with no JavaScript and produces
        a shareable URL.
      */}
      <div className="toolbar">
        <p className="toolbar__count" role="status">
          {plural(t, "collection.results", total)}
        </p>

        <Form method="get" action={path("/shop")} className="toolbar__sort">
          {filters.q ? <input type="hidden" name="q" value={filters.q} /> : null}
          {filters.categoria ? (
            <input type="hidden" name="categoria" value={filters.categoria} />
          ) : null}
          {filters.dispositivo ? (
            <input type="hidden" name="dispositivo" value={filters.dispositivo} />
          ) : null}

          <label className="toolbar__label" htmlFor="ordina">
            {t("collection.sort")}
          </label>
          <select
            id="ordina"
            name="ordina"
            className="input toolbar__select"
            defaultValue={filters.sort}
          >
            <option value="relevance">{t("collection.sort_relevance")}</option>
            <option value="price_asc">{t("collection.sort_price_asc")}</option>
            <option value="price_desc">{t("collection.sort_price_desc")}</option>
            <option value="newest">{t("collection.sort_newest")}</option>
          </select>
          <button type="submit" className="btn btn--secondary toolbar__apply">
            {t("collection.sort_apply")}
          </button>

          {/*
            Only when something is actually filtered. A permanent "clear
            filters" control on an unfiltered list is a button that does
            nothing, and the customer has to read it to find that out.
          */}
          {filters.categoria || filters.dispositivo || filters.q ? (
            <Link className="toolbar__reset" to={path("/shop")}>
              {t("collection.clear_all")}
            </Link>
          ) : null}
        </Form>
      </div>

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

      {/*
        A thin category does not get to end in white space.

        Two products in a category left about two hundred pixels of empty page
        between the last card and the footer — which reads as a page that failed
        to load rather than a department the shop is still building. When there
        is little to show, the useful thing is somewhere else to look: the other
        departments, and the fact that a person in Sulmona will answer.

        Only below a full row, and never on an empty result — an empty search
        already has its own state above, and stacking a second one under it
        would be two apologies for the same thing.
      */}
      {products.length > 0 && products.length < 4 && loaderData.categoryOptions.length > 1 ? (
        <aside className="thin-help">
          <div className="thin-help__block">
            <h2 className="thin-help__title">{t("collection.more_categories")}</h2>
            <ul className="cluster">
              {loaderData.categoryOptions
                .filter((c) => c.slug !== filters.categoria)
                .slice(0, 6)
                .map((c) => (
                  <li key={c.slug}>
                    <Link className="chip" to={withParam("categoria", c.slug)}>
                      {c.name}
                    </Link>
                  </li>
                ))}
            </ul>
          </div>

          {/* Gated on the shop being configured, like every other mention of
              the counter. No address, no promise. */}
          {showStore ? (
            <div className="thin-help__block">
              <h2 className="thin-help__title">{t("collection.help_title")}</h2>
              <p className="thin-help__body">{t("collection.help_body")}</p>
              <Link className="btn btn--secondary" to={path("/negozio")}>
                {t("store.title")}
              </Link>
            </div>
          ) : null}
        </aside>
      ) : null}

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
