import { Link, useLocation } from "react-router";
import type { Route } from "./+types/home";
import { cloudflareContext } from "../../../workers/app";
import { parseLocalePath, translator, localePath } from "~/lib/i18n";
import {
  canShowStoreAddress,
  canOfferPickup,
  canShowPhone,
  canShowEmail,
  settingValue,
  SETTING_KEYS,
  type SettingsMap,
} from "~/domain/content/gates";
import { ProductCard, type ProductCardData } from "~/components/storefront/product-card";
import { availabilityState } from "~/domain/inventory/availability";

export function meta() {
  // Deliberately generic until the merchant supplies a brand name. A title
  // naming a shop that has not been named is an invention.
  //
  // The description says what the shop does and where it does it, and nothing
  // it cannot back up — no superlatives, no counts, no delivery promise. It is
  // the only text a search result shows beneath the title, and the homepage was
  // shipping without one, so search engines were composing that line from
  // whatever they scraped.
  return [
    { title: "Accessori per smartphone" },
    {
      name: "description",
      content:
        "Cover, pellicole, caricatori, cavi e power bank scelti per il tuo modello. " +
        "Ordina online o ritira in negozio.",
    },
  ];
}

/**
 * Availability for a card, from the row the grid query returns.
 *
 * `on_hand === null` means the product has no inventory record at all, which is
 * `not_tracked` — different from zero, and the card says nothing rather than
 * claiming it is out of stock.
 */
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

export async function loader({ context }: Route.LoaderArgs) {
  const { env } = context.get(cloudflareContext);

  const [settingsResult, newArrivals, categories, devices] = await Promise.all([
    env.DB.prepare(`SELECT key, value FROM store_settings`).all<{
      key: string;
      value: string;
    }>(),
    env.DB.prepare(
      `SELECT p.id, p.slug, pt.name,
              (SELECT amount FROM variant_prices vp
                 JOIN product_variants v ON v.id = vp.variant_id
                WHERE v.product_id = p.id ORDER BY vp.amount ASC LIMIT 1) AS price_amount,
              (SELECT object_key FROM product_images pi
                WHERE pi.product_id = p.id
                ORDER BY pi.is_primary DESC, pi.sort_order ASC LIMIT 1) AS image_key,
              /*
               * The cheapest variant's stock, matched to the variant whose
               * price is shown. Availability and price must describe the same
               * thing or the card contradicts itself.
               */
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
        WHERE p.status = 'active' AND p.archived_at IS NULL
        ORDER BY p.published_at DESC
        LIMIT 8`,
    ).all<{
      id: string;
      slug: string;
      name: string | null;
      price_amount: number | null;
      image_key: string | null;
      on_hand: number | null;
      reserved: number | null;
      reorder_threshold: number | null;
    }>(),
    env.DB.prepare(
      `SELECT c.slug, c.image_key, ct.name
         FROM categories c
         LEFT JOIN category_translations ct ON ct.category_id = c.id AND ct.locale = 'it'
        WHERE c.visible = 1 AND c.archived_at IS NULL AND c.depth = 0
        ORDER BY c.sort_order ASC LIMIT 8`,
    ).all<{ slug: string; image_key: string | null; name: string | null }>(),
    /*
     * Shop by device.
     *
     * Ordered by how many products actually fit each model, so the entry
     * points offered are the ones that lead somewhere. A device with nothing
     * compatible is worse than no shortcut at all: it promises a shop that can
     * help and delivers an empty grid.
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
        LIMIT 8`,
    ).all<{
      handle: string;
      name: string;
      brand_name: string;
      product_count: number;
    }>(),
  ]);

  const settings: SettingsMap = Object.fromEntries(
    settingsResult.results.map((r) => [r.key, r.value]),
  );

  return {
    // Where product images are served from. A CDN base if one is configured,
    // otherwise the app's own /media route.
    mediaBaseUrl: env.PUBLIC_MEDIA_BASE_URL?.replace(/\/$/, "") ?? "/media",
    products: newArrivals.results
      .filter((p) => p.price_amount !== null)
      .map<ProductCardData>((p) => ({
        slug: p.slug,
        name: p.name ?? p.slug,
        priceAmount: p.price_amount!,
        imageKey: p.image_key,
        availability: availabilityFor(p),
      })),
    categories: categories.results.filter((c) => c.name),
    devices: devices.results,
    /*
     * The address is enough.
     *
     * This used to require a public shop NAME as well, so a shop with a real
     * street, postcode and city rendered nothing at all — the one fact a
     * marketplace cannot copy, hidden because a display name was missing. The
     * heading falls back to the city, which is true whatever the shop ends up
     * being called.
     */
    showStore: canShowStoreAddress(settings),
    storeCity: settingValue(settings, SETTING_KEYS.storeCity),
    // Media slots. Empty until the merchant fills them in; the sections
    // below render their typographic form when they are.
    heroImage: settingValue(settings, SETTING_KEYS.heroImage),
    storeImage: settingValue(settings, SETTING_KEYS.storeImage),
    // Each trust claim is gated on the fact that makes it true. A promise of
    // in-store collection from a shop that has not configured collection is
    // the kind of copy that ends up in a complaint.
    canPickUp: canOfferPickup(settings),
    canHelp: canShowPhone(settings) || canShowEmail(settings),
  };
}

export default function Home({ loaderData }: Route.ComponentProps) {
  const { pathname } = useLocation();
  const { locale } = parseLocalePath(pathname);
  const t = translator(locale);
  const path = (p: string) => localePath(locale, p);

  /*
   * Trust rows are built from what is actually configured, not from a list of
   * things shops usually say. A claim whose underlying setting is missing is
   * not rendered — an absent reassurance is honest, a false one is not.
   */
  const trust = [
    {
      key: "compatibility",
      title: t("home.trust_compatibility"),
      body: t("home.trust_compatibility_body"),
      show: true,
    },
    {
      key: "pickup",
      title: t("home.trust_pickup"),
      body: t("home.trust_pickup_body"),
      show: loaderData.canPickUp,
    },
    {
      key: "help",
      title: t("home.trust_help"),
      body: t("home.trust_help_body"),
      show: loaderData.canHelp,
    },
  ].filter((item) => item.show);

  return (
    <>
      {/*
        A statement, not a category label.
        Three verbs, because those are the three things every accessory in this
        shop does. It fits in one screen on a phone without pushing the products
        out of reach, which a full-viewport hero would.
      */}
      <section className={`hero${loaderData.heroImage ? " hero--with-media" : ""}`}>
        <div className="page hero__inner">
          <h1 className="hero__statement">
            <span>{t("home.hero_statement_1")}</span>
            <span>{t("home.hero_statement_2")}</span>
            <span>{t("home.hero_statement_3")}</span>
          </h1>
          <p className="hero__lead">{t("home.hero_lead")}</p>
          <div className="cluster">
            <Link className="btn btn--primary btn--lg" to={path("/trova-dispositivo")}>
              {t("home.find_device")}
            </Link>
            <Link className="btn btn--secondary btn--lg" to={path("/shop")}>
              {t("home.shop_now")}
            </Link>
          </div>
        </div>

        {/*
          The hero image, when one exists.

          `aria-hidden` and an empty alt: it is atmosphere, and the promise is
          already in the heading beside it. Describing it again would make a
          screen reader read the decoration twice.

          Eager and high priority — on this page it IS the LCP element, and
          lazy-loading the largest thing above the fold is the classic way to
          lose the metric.
        */}
        {loaderData.heroImage ? (
          <div className="hero__media" aria-hidden="true">
            {/*
              Preloaded, because this image IS the LCP element on desktop.

              Without it the browser cannot know the URL until it has parsed the
              HTML and reached this tag — measured at 440ms, against ~50ms for a
              preload in the head. `fetchPriority` alone does not fix that: it
              reorders the queue once the request is known, it does not make the
              request happen sooner.

              React 19 hoists this into <head> from here, so the URL stays with
              the element it belongs to rather than being duplicated in a route
              module that would have to be kept in step with it.
            */}
            <link
              rel="preload"
              as="image"
              href={`${loaderData.mediaBaseUrl}/${loaderData.heroImage}`}
              fetchPriority="high"
            />
            <img
              src={`${loaderData.mediaBaseUrl}/${loaderData.heroImage}`}
              alt=""
              fetchPriority="high"
              decoding="async"
            />
          </div>
        ) : null}
      </section>

      {/* Immediately under the promise, before anything is asked of the
          customer: the reasons to believe it. */}
      {trust.length > 0 ? (
        <section className="trust-band">
          <ul className="page trust-band__inner">
            {trust.map((item) => (
              <li key={item.key} className="trust">
                <h2 className="trust__title">{item.title}</h2>
                <p className="trust__body">{item.body}</p>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {/* The shop's one real advantage over a marketplace, given the space that
          implies rather than a bordered notice with a link. */}
      <section className="page section">
        <div className="finder-callout">
          <div className="finder-callout__body">
            <p className="eyebrow">{t("home.shop_by_device")}</p>
            <h2 className="finder-callout__title">{t("device.finder_title")}</h2>
            <p className="finder-callout__intro">{t("device.finder_intro")}</p>
            <Link className="btn btn--primary btn--lg" to={path("/trova-dispositivo")}>
              {t("home.find_device")}
            </Link>
          </div>

          {/* Shortcuts, ordered by how many products actually fit. Rendered only
              when the catalogue can answer for them. */}
          {loaderData.devices.length > 0 ? (
            <ul className="finder-callout__devices">
              {loaderData.devices.map((device) => (
                <li key={device.handle}>
                  <Link className="device-chip" to={path(`/shop?dispositivo=${device.handle}`)}>
                    <span className="device-chip__brand">{device.brand_name}</span>
                    <span className="device-chip__model">{device.name}</span>
                    <span className="device-chip__count">
                      {device.product_count} {t("home.shop_by_device_count")}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      </section>

      {/* Sections with no data render NOTHING — not an empty frame. */}
      {loaderData.categories.length > 0 ? (
        <section className="page section">
          <div className="section__head">
            <h2>{t("home.popular_categories")}</h2>
            <Link className="section__more" to={path("/shop")}>
              {t("home.browse_all")}
            </Link>
          </div>
          <ul className="category-grid">
            {loaderData.categories.map((category) => (
              <li key={category.slug}>
                <Link
                  className={`category-tile${category.image_key ? " category-tile--media" : ""}`}
                  to={path(`/shop?categoria=${category.slug}`)}
                >
                  {category.image_key ? (
                    <img
                      className="category-tile__image"
                      src={`${loaderData.mediaBaseUrl}/${category.image_key}`}
                      alt=""
                      loading="lazy"
                      decoding="async"
                    />
                  ) : null}
                  <span className="category-tile__name">{category.name}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {loaderData.products.length > 0 ? (
        <section className="page section">
          <div className="section__head">
            <h2>{t("home.new_arrivals")}</h2>
            <Link className="section__more" to={path("/shop")}>
              {t("home.browse_all")}
            </Link>
          </div>
          <div className="grid-products">
            {loaderData.products.map((product) => (
              <ProductCard
                key={product.slug}
                product={product}
                locale={locale}
                t={t}
                mediaBaseUrl={loaderData.mediaBaseUrl}
              />
            ))}
          </div>
        </section>
      ) : null}

      {/* The one dark band on the page. It carries the physical shop, because
          that is the fact a marketplace cannot copy. Rendered only once the
          merchant has actually configured a shop to talk about. */}
      {loaderData.showStore ? (
        <section className={`store-band${loaderData.storeImage ? " store-band--media" : ""}`}>
          {loaderData.storeImage ? (
            <img
              className="store-band__image"
              src={`${loaderData.mediaBaseUrl}/${loaderData.storeImage}`}
              alt=""
              loading="lazy"
              decoding="async"
            />
          ) : null}
          <div className="page store-band__inner">
            <p className="eyebrow eyebrow--on-deep">{t("home.store_eyebrow")}</p>
            <h2 className="store-band__title">
              {loaderData.storeCity
                ? t("home.store_title_city", { city: loaderData.storeCity })
                : t("home.store_title")}
            </h2>
            <p className="store-band__body">{t("home.store_body")}</p>
            <Link className="btn btn--on-deep btn--lg" to={path("/negozio")}>
              {t("home.visit_store")}
            </Link>
          </div>
        </section>
      ) : null}
    </>
  );
}
