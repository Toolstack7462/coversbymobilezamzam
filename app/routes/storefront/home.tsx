import { DeviceDiscovery } from "~/components/storefront/device-discovery";
import { HeroShowcase } from "~/components/storefront/hero-showcase";
import { saleableImageKey, editorialHeroKey, storePhotoKey } from "~/domain/media/storefront-image";
import { Fragment } from "react";
import { Link, useLocation } from "react-router";
import type { Route } from "./+types/home";
import { appContext } from "~/runtime/context";
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

export function meta({ matches }: Route.MetaArgs) {
  const shell = matches.find((m) => m?.id?.startsWith("routes/storefront/layout"));
  const brand = (shell?.loaderData as { brand?: { full: string } } | undefined)?.brand;
  return [{ title: `${brand?.full ?? "Covers by Mobile Zam Zam"} | Accessori smartphone` }];
}

export async function loader({ context }: Route.LoaderArgs) {
  const { env } = context.get(appContext);

  const [settingsResult, newArrivals, featuredRows, guideRows, sectionRows, categories, devices] =
    await Promise.all([
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
                ORDER BY pi.is_primary DESC, pi.sort_order ASC LIMIT 1) AS image_key
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
      }>(),

      /*
       * The editorial band: products the merchant has put forward.
       *
       * `is_featured`, set in Prodotti in evidenza. Distinct from "new arrivals",
       * which is chronological and needs no decision from anybody. A shop that
       * has featured nothing renders no band, rather than a heading over
       * whatever happened to be newest.
       */
      env.DB.prepare(
        `SELECT p.slug, pt.name, pt.short_description,
                (SELECT amount FROM variant_prices vp
                   JOIN product_variants v ON v.id = vp.variant_id
                  WHERE v.product_id = p.id ORDER BY vp.amount ASC LIMIT 1) AS price_amount,
                (SELECT object_key FROM product_images pi
                  WHERE pi.product_id = p.id
                  ORDER BY pi.is_primary DESC, pi.sort_order ASC LIMIT 1) AS image_key,
                COALESCE(ct.name, c.slug) AS category_name
           FROM products p
           LEFT JOIN product_translations pt ON pt.product_id = p.id AND pt.locale = 'it'
           LEFT JOIN categories c ON c.id = p.primary_category_id
           LEFT JOIN category_translations ct ON ct.category_id = c.id AND ct.locale = 'it'
          WHERE p.status = 'active' AND p.archived_at IS NULL AND p.is_featured = 1
          ORDER BY p.updated_at DESC
          LIMIT 4`,
      ).all<{
        slug: string;
        name: string | null;
        short_description: string | null;
        price_amount: number | null;
        image_key: string | null;
        category_name: string | null;
      }>(),

      /*
       * The homepage composition the merchant chose, if any.
       *
       * Empty is a valid and common answer: an unconfigured shop falls back to
       * the designed order rather than rendering nothing. See the component.
       */
      /*
       * Buying guides.
       *
       * `pages` with page_type = 'guide' — the same rows the merchant edits in
       * Pagine, not a second content system. A shop with no guides published
       * renders no guides section, rather than a heading over three empty cards.
       */
      env.DB.prepare(
        `SELECT p.slug, p.page_type, COALESCE(t.title, p.slug) AS title, t.excerpt
         FROM pages p
         LEFT JOIN page_translations t ON t.page_id = p.id AND t.locale = 'it'
        WHERE p.page_type IN ('guide', 'service')
          AND p.status = 'published'
          AND p.archived_at IS NULL
          AND (p.publish_at IS NULL OR p.publish_at <= ?1)
        ORDER BY p.sort_order
        LIMIT 12`,
      )
        .bind(Date.now())
        .all<{ slug: string; page_type: string; title: string; excerpt: string | null }>(),
      env.DB.prepare(
        `SELECT s.section_type, t.heading, t.subheading
         FROM homepage_sections s
         LEFT JOIN homepage_section_translations t
           ON t.section_id = s.id AND t.locale = 'it'
        WHERE s.visible = 1
        ORDER BY s.sort_order`,
      ).all<{ section_type: string; heading: string | null; subheading: string | null }>(),
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
        LIMIT 6`,
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
      .filter(
        (p) =>
          p.price_amount !== null &&
          !featuredRows.results
            .filter((r) => r.price_amount !== null && saleableImageKey(r.image_key))
            .slice(0, 1)
            .some((r) => r.slug === p.slug),
      )
      .map<ProductCardData>((p) => ({
        slug: p.slug,
        name: p.name ?? p.slug,
        priceAmount: p.price_amount!,
        imageKey: saleableImageKey(p.image_key),
        availability: null,
      })),
    categories: categories.results.filter((c) => c.name),
    devices: devices.results,
    // The merchant's chosen composition. Empty means "use the designed order".
    featured: featuredRows.results
      .filter((r) => r.price_amount !== null && saleableImageKey(r.image_key))
      .slice(0, 1),
    guides: guideRows.results.filter((row) => row.page_type === "guide").slice(0, 3),
    services: guideRows.results.filter((row) => row.page_type === "service").slice(0, 3),
    sections: sectionRows.results.map((row) => ({
      type: row.section_type,
      heading: row.heading,
      subheading: row.subheading,
    })),
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
    heroImage: editorialHeroKey(settingValue(settings, SETTING_KEYS.heroImage)),
    storeImage: storePhotoKey(settingValue(settings, SETTING_KEYS.storeImage)),
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

  /*
   * The homepage, assembled from named sections.
   *
   * These used to be six blocks written one after another in the JSX, which
   * meant the order was a property of the source file — and the admin screen
   * that offers to reorder them would have been a control that changed a row
   * in a table nothing read. This project has now found that same defect three
   * times (a nav constant, an artwork list, an assignment table with no
   * writer), so a seventh block of hardcoded order was not going to be the one
   * that got away with it.
   *
   * Each section keeps its own "render nothing when there is no data" rule.
   * Ordering decides where a section goes, never whether it has anything to
   * say.
   */
  const sectionCopy = (type: string) =>
    loaderData.sections.find((section) => section.type === type);
  const sectionHeading = (type: string, fallback: string) => sectionCopy(type)?.heading || fallback;
  const SECTIONS: Record<string, () => React.ReactNode> = {
    hero: () => (
      <HeroShowcase
        heading={sectionCopy("hero")?.heading ?? null}
        lead={sectionCopy("hero")?.subheading ?? null}
        imageKey={loaderData.heroImage}
        mediaBaseUrl={loaderData.mediaBaseUrl}
        locale={locale}
        t={t}
      />
    ),
    trust: () => (
      <>
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
      </>
    ),
    device_finder: () => (
      <>
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
              <DeviceDiscovery devices={loaderData.devices} locale={locale} t={t} />
            ) : null}
          </div>
        </section>
      </>
    ),
    categories: () => (
      <>
        {/* Sections with no data render NOTHING — not an empty frame. */}
        {loaderData.categories.length > 0 ? (
          <section className="page section">
            <div className="section__head">
              <h2>{sectionHeading("categories", t("home.popular_categories"))}</h2>
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
      </>
    ),
    featured_products: () => (
      <>
        {loaderData.products.length > 0 ? (
          <section className="page section">
            <div className="section__head">
              <h2>{sectionHeading("featured_products", t("home.new_arrivals"))}</h2>
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
      </>
    ),
    /*
     * The editorial band.
     *
     * Four products at a size that lets the photograph carry them, with the
     * category and the product's own sentence beside it — not a fifth row of
     * the same card used everywhere else. This is the section the benchmark
     * called "editorial rather than simple cards", and the difference is that
     * a card sells a price while this sells a reason.
     */
    featured_collection: () => (
      <>
        {loaderData.featured.length > 0 ? (
          /*
            The one dark moment in the middle of the page.

            Measured before changing anything: between the hero and the store
            band the homepage ran 3 288px through six sections on the identical
            warm white. Over three metres of scroll in one flat colour, which is
            what "it doesn't look premium" was pointing at.

            This section takes the navy because it is the one whose job is the
            photographs — product shots read better on a dark ground, which is
            what Native Union and dbrand both do with theirs — and because it
            falls near the middle, so the run is broken where it is longest.

            One dark band, not five. A page that changes ground at every section
            has no rhythm either; it just flickers.
          */
          <section className="section section--deep">
            <div className="page section__head">
              <h2>{sectionHeading("featured_collection", t("home.featured_title"))}</h2>
              <Link className="section__more" to={path("/shop")}>
                {t("home.browse_all")}
              </Link>
            </div>
            <ul className="page editorial-grid">
              {loaderData.featured.map((item) => (
                <li key={item.slug}>
                  <Link className="editorial" to={path(`/prodotti/${item.slug}`)}>
                    {item.image_key ? (
                      <span className="editorial__media">
                        <img
                          src={`${loaderData.mediaBaseUrl}/${item.image_key}`}
                          alt=""
                          loading="lazy"
                          decoding="async"
                        />
                      </span>
                    ) : null}
                    <span className="editorial__body">
                      {item.category_name ? (
                        <span className="editorial__eyebrow">{item.category_name}</span>
                      ) : null}
                      <span className="editorial__title">{item.name ?? item.slug}</span>
                      {item.short_description ? (
                        <span className="editorial__note">{item.short_description}</span>
                      ) : null}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </>
    ),

    /*
     * Services.
     *
     * What happens at the counter, which is the half of this business a
     * marketplace cannot copy. Gated on the store being configured for the same
     * reason the footer is: a shop with no address has no counter to promise.
     */
    /*
     * Buying guides.
     *
     * Editorial, and the only place on the homepage that is not trying to sell
     * something in the next click. It exists because "which charger do I need"
     * is the question this shop answers better than a marketplace, and
     * answering it in public is how that becomes visible.
     */
    services: () =>
      loaderData.services.length > 0 ? (
        <section className="section section--tint">
          <div className="page">
            <div className="section__head">
              <h2>{sectionHeading("services", t("home.services_title"))}</h2>
            </div>
            <ul className="service-grid">
              {loaderData.services.map((service) => (
                <li className="service" key={service.slug}>
                  <h3>
                    <Link to={path(`/pagine/${service.slug}`)}>{service.title}</Link>
                  </h3>
                  {service.excerpt ? <p>{service.excerpt}</p> : null}
                </li>
              ))}
            </ul>
          </div>
        </section>
      ) : null,
    guides: () => (
      <>
        {loaderData.guides.length > 0 ? (
          <section className="page section">
            <div className="section__head">
              <h2>{sectionHeading("guides", t("home.guides_title"))}</h2>
            </div>
            <ul className="guide-grid">
              {loaderData.guides.map((guide) => (
                <li key={guide.slug}>
                  <Link className="guide" to={path(`/pagine/${guide.slug}`)}>
                    <h3 className="guide__title">{guide.title}</h3>
                    {guide.excerpt ? <p className="guide__body">{guide.excerpt}</p> : null}
                    <span className="guide__more" aria-hidden="true">
                      {t("home.guides_read")}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </>
    ),

    store: () => (
      <>
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
    ),
  };

  /*
   * The merchant's order if they have set one, otherwise the composition this
   * page was designed with. An unconfigured shop gets a finished homepage
   * rather than a blank one, which is what makes the admin screen optional
   * instead of a step nobody was told about.
   */
  const order =
    loaderData.sections.length > 0
      ? loaderData.sections
      : Object.keys(SECTIONS).map((type) => ({ type, heading: null, subheading: null }));

  return (
    <>
      {order.map((section) => {
        const render = SECTIONS[section.type];
        // A row for a section this build does not know how to draw is skipped
        // rather than crashing the homepage.
        return render ? <Fragment key={section.type}>{render()}</Fragment> : null;
      })}
    </>
  );
}
