import { Link, Form, useLocation } from "react-router";
import { data } from "react-router";
import type { Route } from "./+types/product";
import { cloudflareContext } from "../../../workers/app";
import { parseLocalePath, translator, localePath } from "~/lib/i18n";
import { money, format as formatMoney } from "~/domain/pricing/money";
import { discountDisplay } from "~/domain/pricing/resolve";
import {
  resolveCompatibility,
  type CompatibilityRecord,
  type CompatibilityLevel,
} from "~/domain/compatibility/resolve";
import { availabilityState, availabilityLabelKey } from "~/domain/inventory/availability";
import { CompatibilityBadge } from "~/components/storefront/compatibility-badge";
import { ProductCard, type ProductCardData } from "~/components/storefront/product-card";
import {
  canOfferPickup,
  canShowPhone,
  canShowEmail,
  type SettingsMap,
} from "~/domain/content/gates";

export function meta({ loaderData }: Route.MetaArgs) {
  // Falls back rather than inventing: an untranslated product still needs a
  // title, and its slug is a real fact about it where a made-up name is not.
  const name = loaderData?.product?.name ?? loaderData?.product?.slug ?? "Prodotto";

  /*
   * The description is the product's OWN summary, trimmed to the length a
   * search result shows. Not a template with the name poured into it: a page
   * per product, each describing itself with the same sentence in a different
   * order, is what a search engine reads as a thin catalogue.
   *
   * A product with no summary yet gets no description tag at all, which is
   * correct — an engine composing a line from the page beats a line the shop
   * made up about a product it has not described.
   */
  const summary = loaderData?.product?.short_description?.trim();

  return [
    { title: name },
    ...(summary
      ? [
          {
            name: "description",
            content: summary.length > 155 ? `${summary.slice(0, 152).trimEnd()}…` : summary,
          },
        ]
      : []),
  ];
}

export async function loader({ context, params }: Route.LoaderArgs) {
  const { env } = context.get(cloudflareContext);

  const product = await env.DB.prepare(
    `SELECT p.id, p.slug, pt.name, pt.short_description, pt.full_description,
            b.name AS brand_name, p.accessory_type
       FROM products p
       LEFT JOIN product_translations pt ON pt.product_id = p.id AND pt.locale = 'it'
       LEFT JOIN brands b ON b.id = p.brand_id
      WHERE p.slug = ?1 AND p.status = 'active' AND p.archived_at IS NULL`,
  )
    .bind(params.slug)
    .first<{
      id: string;
      slug: string;
      name: string | null;
      short_description: string | null;
      full_description: string | null;
      brand_name: string | null;
      accessory_type: string | null;
    }>();

  if (!product) throw data(null, { status: 404 });

  /*
   * The primary image. Ordered exactly as the collection grid orders it —
   * is_primary first, then sort_order — so the picture on the card is the
   * picture on the page, rather than two queries disagreeing about which
   * photograph represents the product.
   */
  const images = await env.DB.prepare(
    `SELECT object_key, alt_it, alt_en, width, height
       FROM product_images
      WHERE product_id = ?1
      ORDER BY is_primary DESC, sort_order ASC
      LIMIT 8`,
  )
    .bind(product.id)
    .all<{
      object_key: string;
      alt_it: string | null;
      alt_en: string | null;
      width: number;
      height: number;
    }>();

  const [variants, compatibility, specs, devices] = await Promise.all([
    env.DB.prepare(
      `SELECT v.id, v.sku, v.variant_label, vp.amount AS price_amount,
              vp.prior_price_30d, il.on_hand, il.reserved, il.reorder_threshold,
              il.allow_backorder
         FROM product_variants v
         JOIN variant_prices vp ON vp.variant_id = v.id
         JOIN price_lists pl ON pl.id = vp.price_list_id AND pl.is_default = 1
         LEFT JOIN inventory_levels il ON il.variant_id = v.id
        WHERE v.product_id = ?1 AND v.active = 1 AND v.archived_at IS NULL
        ORDER BY v.is_default DESC, v.sort_order ASC`,
    )
      .bind(product.id)
      .all<{
        id: string;
        sku: string;
        variant_label: string | null;
        price_amount: number;
        prior_price_30d: number | null;
        on_hand: number | null;
        reserved: number | null;
        reorder_threshold: number | null;
        allow_backorder: number | null;
      }>(),

    env.DB.prepare(
      `SELECT pc.variant_id, pc.compatibility_level, pc.verified, pc.note,
              dm.id AS device_model_id, dm.name AS device_name
         FROM product_compatibility pc
         JOIN device_models dm ON dm.id = pc.device_model_id
        WHERE pc.product_id = ?1
        ORDER BY dm.sort_order ASC`,
    )
      .bind(product.id)
      .all<{
        variant_id: string | null;
        compatibility_level: string;
        verified: number;
        note: string | null;
        device_model_id: string;
        device_name: string;
      }>(),

    env.DB.prepare(
      `SELECT spec_key, value_text, value_number, unit
         FROM product_specifications WHERE product_id = ?1 ORDER BY sort_order ASC`,
    )
      .bind(product.id)
      .all<{
        spec_key: string;
        value_text: string | null;
        value_number: number | null;
        unit: string | null;
      }>(),

    env.DB.prepare(`SELECT id, handle, name FROM device_models WHERE active = 1`).all<{
      id: string;
      handle: string;
      name: string;
    }>(),
  ]);

  const [brandCount, settingsResult, related, reviewRows, familyRows] = await Promise.all([
    /*
     * How many brands the catalogue carries.
     *
     * The related rail prints the maker on each card, which is useful in a shop
     * stocking several and noise in one stocking one. Counted, not hardcoded,
     * so the eyebrow returns by itself the day a second brand is added — the
     * same rule the collection grid uses.
     */
    env.DB.prepare(
      `SELECT COUNT(DISTINCT p.brand_id) AS n
         FROM products p
        WHERE p.status = 'active' AND p.archived_at IS NULL AND p.brand_id IS NOT NULL`,
    ).first<{ n: number }>(),
    env.DB.prepare(`SELECT key, value FROM store_settings`).all<{ key: string; value: string }>(),

    /*
     * Related accessories: other products that fit at least one of the same
     * devices as this one.
     *
     * Related by COMPATIBILITY, never by category or by a "customers also
     * bought" that has no orders behind it. On an accessories catalogue the
     * useful adjacency is "this also fits your phone" — and it is the one
     * relationship the data can actually prove.
     */
    env.DB.prepare(
      `SELECT DISTINCT p.slug, pt.name, b.name AS brand_name,
              (SELECT amount FROM variant_prices vp
                 JOIN product_variants v ON v.id = vp.variant_id
                WHERE v.product_id = p.id ORDER BY vp.amount ASC LIMIT 1) AS price_amount,
              (SELECT object_key FROM product_images pi
                WHERE pi.product_id = p.id
                ORDER BY pi.is_primary DESC, pi.sort_order ASC LIMIT 1) AS image_key
         FROM product_compatibility mine
         JOIN product_compatibility theirs
              ON theirs.device_model_id = mine.device_model_id
             AND theirs.product_id <> mine.product_id
             AND theirs.compatibility_level <> 'incompatible'
         JOIN products p ON p.id = theirs.product_id
                        AND p.status = 'active' AND p.archived_at IS NULL
         LEFT JOIN product_translations pt ON pt.product_id = p.id AND pt.locale = 'it'
         LEFT JOIN brands b ON b.id = p.brand_id
        WHERE mine.product_id = ?1 AND mine.compatibility_level <> 'incompatible'
        LIMIT 4`,
    )
      .bind(product.id)
      .all<{
        slug: string;
        name: string | null;
        brand_name: string | null;
        price_amount: number | null;
        image_key: string | null;
      }>(),

    /*
     * Published reviews only, newest first.
     *
     * Pending and rejected reviews are invisible here by construction rather
     * than by a filter somebody has to remember: the storefront asks for
     * `status = 'published'` and nothing else.
     */
    env.DB.prepare(
      `SELECT id, provenance, author_name, rating, title, body, published_at
         FROM product_reviews
        WHERE product_id = ?1 AND status = 'published'
        ORDER BY published_at DESC
        LIMIT 20`,
    )
      .bind(product.id)
      .all<{
        id: string;
        provenance: string;
        author_name: string;
        rating: number;
        title: string | null;
        body: string;
        published_at: number | null;
      }>(),

    /*
     * The rest of this product's family: the same item cut for other phones.
     *
     * Deliberately NOT the compatibility list. Compatibility says whether THIS
     * product fits a given phone; a family says a different version exists for
     * it. Showing one under the other's heading is how a customer is told a
     * case for an iPhone fits a Galaxy.
     */
    env.DB.prepare(
      `SELECT p.slug, COALESCE(pt.name, p.slug) AS name,
              (SELECT amount FROM variant_prices vp
                 JOIN product_variants v ON v.id = vp.variant_id
                WHERE v.product_id = p.id ORDER BY vp.amount ASC LIMIT 1) AS price_amount,
              (SELECT object_key FROM product_images pi
                WHERE pi.product_id = p.id
                ORDER BY pi.is_primary DESC, pi.sort_order ASC LIMIT 1) AS image_key
         FROM product_family_members mine
         JOIN product_family_members theirs
           ON theirs.product_family_id = mine.product_family_id
          AND theirs.product_id <> mine.product_id
         JOIN products p ON p.id = theirs.product_id
                        AND p.status = 'active' AND p.archived_at IS NULL
         LEFT JOIN product_translations pt ON pt.product_id = p.id AND pt.locale = 'it'
        WHERE mine.product_id = ?1
        ORDER BY theirs.sort_order
        LIMIT 12`,
    )
      .bind(product.id)
      .all<{
        slug: string;
        name: string;
        price_amount: number | null;
        image_key: string | null;
      }>(),
  ]);

  const settings: SettingsMap = Object.fromEntries(
    settingsResult.results.map((r) => [r.key, r.value]),
  );

  return {
    product,
    images: images.results,
    mediaBaseUrl: env.PUBLIC_MEDIA_BASE_URL?.replace(/\/$/, "") ?? "/media",
    variants: variants.results,
    /**
     * The server emits the FACTS. The browser resolves them against the device
     * held in localStorage, because SSR pages are cacheable and baking one
     * visitor's device into the HTML would serve it to the next
     * (docs/device-compatibility.md).
     */
    compatibilityRecords: compatibility.results.map((r) => ({
      deviceModelId: r.device_model_id,
      variantId: r.variant_id,
      level: r.compatibility_level as CompatibilityLevel,
      verified: r.verified === 1,
      note: r.note,
    })),
    deviceNames: Object.fromEntries(devices.results.map((d) => [d.id, d.name])),
    compatibleDevices: compatibility.results
      .filter((r) => r.compatibility_level !== "incompatible")
      .map((r) => r.device_name),
    specs: specs.results.filter((s) => s.value_text !== null || s.value_number !== null),
    reviews: reviewRows.results,
    // Other phones the same item is made for. Empty is the common case.
    family: familyRows.results,
    /*
     * The average is computed from what is PUBLISHED, which is the only set a
     * visitor can check. Rounded to one decimal for display and never stored:
     * 4.7 is not a rating anybody submitted.
     */
    reviewAverage:
      reviewRows.results.length > 0
        ? reviewRows.results.reduce((sum, r) => sum + r.rating, 0) / reviewRows.results.length
        : null,
    // Each reassurance is gated on the setting that makes it true. A promise
    // of collection from a shop that has not configured collection is the
    // kind of copy that ends up in a complaint.
    canPickUp: canOfferPickup(settings),
    canHelp: canShowPhone(settings) || canShowEmail(settings),
    related: related.results
      .filter((r) => r.price_amount !== null)
      .map<ProductCardData>((r) => ({
        slug: r.slug,
        name: r.name ?? r.slug,
        brandName: (brandCount?.n ?? 0) > 1 ? r.brand_name : null,
        priceAmount: r.price_amount!,
        imageKey: r.image_key,
      })),
  };
}

export default function ProductPage({ loaderData }: Route.ComponentProps) {
  const { pathname } = useLocation();
  const { locale } = parseLocalePath(pathname);
  const t = translator(locale);
  const {
    product,
    images,
    mediaBaseUrl,
    variants,
    compatibilityRecords,
    specs,
    compatibleDevices,
  } = loaderData;

  const variant = variants[0];
  const intl = locale === "it" ? "it-IT" : "en-GB";

  // Rendered server-side with no device selected, so it shows the honest
  // "check compatibility" state until the browser resolves a stored device.
  const compatibility = resolveCompatibility({
    records: compatibilityRecords as CompatibilityRecord[],
    selectedDeviceModelId: null,
    variantId: variant?.id ?? null,
  });

  const stock = variant
    ? availabilityState({
        variantId: variant.id,
        locationId: "",
        onHand: variant.on_hand ?? 0,
        reserved: variant.reserved ?? 0,
        incoming: 0,
        reorderThreshold: variant.reorder_threshold,
        allowBackorder: variant.allow_backorder === 1,
      })
    : "not_tracked";

  const discount = variant
    ? discountDisplay({
        currentPrice: money(variant.price_amount),
        priorPrice30d: variant.prior_price_30d ? money(variant.prior_price_30d) : null,
      })
    : null;

  return (
    <div className="page section product-page">
      <nav aria-label="breadcrumb" className="small muted">
        <Link to={localePath(locale, "/")}>{t("common.home")}</Link> /{" "}
        <Link to={localePath(locale, "/shop")}>{t("common.shop")}</Link> /{" "}
        <span>{product.name}</span>
      </nav>

      <div className="product-page__grid">
        {/*
          The gallery.

          No JavaScript: every view is an anchor to its own image, and the
          browser scrolls the strip. That means it works before hydration, works
          without it, and costs nothing to the bundle — where a carousel library
          would cost more than the images.

          Thumbnails appear only when there is more than one view. A single
          thumbnail under a single photograph is a control that does nothing.
        */}
        <div className="gallery">
          {/*
            The strip scrolls, so it must be reachable by keyboard.
            A region that scrolls and cannot be focused is unusable without a
            mouse — the browser gives arrow-key scrolling to a focusable
            element, and to nothing else. `tabindex={0}` plus a name is the
            documented remedy; axe flags its absence as
            `scrollable-region-focusable`.
          */}
          <div
            className="gallery__stage"
            role="group"
            aria-label={t("product.gallery")}
            tabIndex={0}
          >
            {images.length > 0 ? (
              images.map((img, index) => (
                <figure key={img.object_key} className="gallery__slide" id={`vista-${index + 1}`}>
                  <img
                    src={`${mediaBaseUrl}/${img.object_key}`}
                    /* The alt belongs to the image, not the product: these are
                       placeholder illustrations and say so. */
                    alt={(locale === "en" ? img.alt_en : img.alt_it) ?? ""}
                    width={img.width}
                    height={img.height}
                    /* The first is the LCP element of this page. The rest are
                       off to the side and can wait. */
                    fetchPriority={index === 0 ? "high" : "low"}
                    loading={index === 0 ? "eager" : "lazy"}
                    decoding="async"
                  />
                </figure>
              ))
            ) : (
              <div className="product-card__media-empty" aria-hidden="true" />
            )}
          </div>

          {images.length > 1 ? (
            <ul className="gallery__thumbs">
              {images.map((img, index) => (
                <li key={img.object_key}>
                  <a className="gallery__thumb" href={`#vista-${index + 1}`}>
                    <img
                      src={`${mediaBaseUrl}/${img.object_key}`}
                      alt={t("product.view_n", { n: index + 1 })}
                      width={120}
                      height={120}
                      loading="lazy"
                      decoding="async"
                    />
                  </a>
                </li>
              ))}
            </ul>
          ) : null}
        </div>

        <div className="product-page__info stack">
          {product.brand_name ? <p className="caption muted">{product.brand_name}</p> : null}
          <h1>{product.name}</h1>
          {product.short_description ? <p className="muted">{product.short_description}</p> : null}

          {variant ? (
            <>
              <p className="product-page__price">
                <span className="price">{formatMoney(money(variant.price_amount), intl)}</span>
                <span className="caption muted"> {t("common.vat_included")}</span>
              </p>
              {discount?.percentage !== null && discount?.priorPrice30d ? (
                <p className="price--reference">
                  {t("product.prior_price_note", {
                    price: formatMoney(discount.priorPrice30d, intl),
                  })}
                </p>
              ) : null}

              <p className={`small stock--${stock}`}>{t(availabilityLabelKey(stock))}</p>
              <p className="caption muted">
                {t("product.sku")}: <span className="numeric">{variant.sku}</span>
              </p>
            </>
          ) : null}

          {/*
            Compatibility sits next to the buy button, because that is the
            moment the customer needs it. A mismatch WARNS but never blocks:
            they may be buying for someone else.
          */}
          <CompatibilityBadge state={compatibility.state} deviceName={null} t={t} />

          {compatibility.state === "mismatch" ? (
            <p>
              <Link className="btn btn--secondary" to={localePath(locale, "/shop")}>
                {t("compatibility.see_alternatives")}
              </Link>
            </p>
          ) : null}

          {/* A real POST form. Adding to the cart works without JavaScript. */}
          <Form
            id="acquista"
            method="post"
            action={localePath(locale, "/carrello")}
            className="stack"
          >
            <input type="hidden" name="intent" value="add" />
            <input type="hidden" name="variantId" value={variant?.id ?? ""} />
            <div className="field" style={{ maxWidth: "8rem" }}>
              <label className="field__label" htmlFor="quantity">
                {t("common.quantity")}
              </label>
              <input
                id="quantity"
                name="quantity"
                type="number"
                inputMode="numeric"
                min={1}
                max={99}
                defaultValue={1}
                className="input numeric"
              />
            </div>
            <button
              type="submit"
              className="btn btn--primary"
              disabled={!variant || stock === "out_of_stock"}
            >
              {stock === "out_of_stock" ? t("product.sold_out") : t("product.add_to_cart")}
            </button>
          </Form>

          {/*
            The three doubts that stop an accessories purchase, answered where
            the decision is made rather than in a footer nobody scrolls to.

            Each is gated on the setting that makes it true, so a shop that has
            not configured collection does not promise it. The first is always
            true: it is a property of the catalogue, not a claim about service.
          */}
          <ul className="reassure">
            <li className="reassure__item">
              <strong>{t("product.reassure_fit")}</strong>
              <span>{t("product.reassure_fit_body")}</span>
            </li>
            {loaderData.canPickUp ? (
              <li className="reassure__item">
                <strong>{t("product.reassure_pickup")}</strong>
                <span>{t("product.reassure_pickup_body")}</span>
              </li>
            ) : null}
            {loaderData.canHelp ? (
              <li className="reassure__item">
                <strong>{t("product.reassure_help")}</strong>
                <span>{t("product.reassure_help_body")}</span>
              </li>
            ) : null}
          </ul>
        </div>
      </div>

      {/*
        Sticky purchase bar, phones only.

        A link to the form above rather than a second form: two forms posting
        the same variant would be two sources of truth for the quantity, and the
        one the customer did not look at would win. This scrolls them to the
        real control.
      */}
      <div className="buy-bar">
        <span className="buy-bar__price">
          {variant ? (
            <span className="price">{formatMoney(money(variant.price_amount), intl)}</span>
          ) : null}
          {stock !== "not_tracked" ? (
            <span className={`caption stock--${stock}`}>{t(availabilityLabelKey(stock))}</span>
          ) : null}
        </span>
        <a className="btn btn--primary" href="#acquista">
          {stock === "out_of_stock" ? t("product.sold_out") : t("product.add_to_cart")}
        </a>
      </div>

      {/* Native <details>: an accessible accordion with zero JavaScript. */}
      {product.full_description ? (
        <details className="panel" open>
          <summary>
            <h2 style={{ display: "inline" }}>{t("product.description")}</h2>
          </summary>
          <p>{product.full_description}</p>
        </details>
      ) : null}

      {/* Rows with no value are absent, so a half-filled table looks
          intentional rather than unfinished. */}
      {specs.length > 0 ? (
        <details className="panel">
          <summary>
            <h2 style={{ display: "inline" }}>{t("product.specifications")}</h2>
          </summary>
          <dl className="spec-list">
            {specs.map((spec) => (
              <div key={spec.spec_key}>
                <dt>{spec.spec_key}</dt>
                <dd className="numeric">
                  {spec.value_text ?? spec.value_number}
                  {spec.unit ? ` ${spec.unit}` : ""}
                </dd>
              </div>
            ))}
          </dl>
        </details>
      ) : null}

      {compatibleDevices.length > 0 ? (
        <details className="panel">
          <summary>
            <h2 style={{ display: "inline" }}>{t("compatibility.full_list")}</h2>
          </summary>
          <ul className="cluster">
            {compatibleDevices.map((name) => (
              <li key={name} className="badge">
                {name}
              </li>
            ))}
          </ul>
        </details>
      ) : null}

      {/*
        The same item, for other phones.

        Above the reviews and below the detail, because the customer this helps
        is the one who has just worked out that this particular one is not for
        their model — and the worst place to learn that is the bottom of the
        page.

        This is NOT the compatibility list. Compatibility says whether THIS
        product fits a phone; a family says a different version exists for it.
      */}
      {loaderData.family.length > 0 ? (
        <section className="section">
          <div className="section__head">
            <h2>{t("product.family_title")}</h2>
          </div>
          <div className="grid-products">
            {loaderData.family
              .filter((item) => item.price_amount !== null)
              .map((item) => (
                <ProductCard
                  key={item.slug}
                  product={{
                    slug: item.slug,
                    name: item.name,
                    priceAmount: item.price_amount!,
                    imageKey: item.image_key,
                    availability: null,
                  }}
                  locale={locale}
                  t={t}
                  mediaBaseUrl={mediaBaseUrl}
                />
              ))}
          </div>
        </section>
      ) : null}

      {/*
        Reviews.

        Two things are non-negotiable here, and both are legal rather than
        aesthetic (D.Lgs. 26/2023):

        1. Every review shows HOW it was obtained. "Acquisto verificato" is
           backed by a real order line — the database will not let that label
           exist without one — and "raccolta in negozio" is the honest weaker
           claim, where the shop vouches for it and the software does not.
        2. The page states how reviews are checked, in plain words, next to
           them rather than in a policy nobody opens.

        The average is over published reviews and is shown with the count, so
        "4.8" is never floating free of the fact that it is four people.
      */}
      {loaderData.reviews.length > 0 ? (
        <section className="section">
          <div className="section__head">
            <h2>{t("product.reviews_title")}</h2>
            {loaderData.reviewAverage !== null ? (
              <p className="review-summary">
                <strong>{loaderData.reviewAverage.toFixed(1)}</strong>
                <span aria-hidden="true"> ★ </span>
                <span className="muted">
                  {t("product.reviews_count", { count: String(loaderData.reviews.length) })}
                </span>
              </p>
            ) : null}
          </div>

          <p className="small muted review-disclosure">{t("product.reviews_disclosure")}</p>

          <ul className="review-list">
            {loaderData.reviews.map((review) => (
              <li className="review" key={review.id}>
                <p className="review__head">
                  <span className="review__rating">
                    <span aria-hidden="true">
                      {"★".repeat(review.rating)}
                      <span className="review__rating-empty">{"★".repeat(5 - review.rating)}</span>
                    </span>
                    <span className="visually-hidden">
                      {t("product.reviews_rating", { rating: String(review.rating) })}
                    </span>
                  </span>
                  <span className="review__author">{review.author_name}</span>
                  <span className="review__provenance">
                    {review.provenance === "verified_purchase"
                      ? t("product.reviews_verified")
                      : t("product.reviews_in_store")}
                  </span>
                </p>
                {review.title ? <p className="review__title">{review.title}</p> : null}
                <p className="review__body">{review.body}</p>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {/* Related by COMPATIBILITY, not by category and not by a "customers also
          bought" with no orders behind it. On an accessories catalogue the
          useful adjacency is "this also fits your phone". */}
      {loaderData.related.length > 0 ? (
        <section className="section">
          <div className="section__head">
            <h2>{t("product.related_title")}</h2>
          </div>
          <div className="grid-products">
            {loaderData.related.map((item) => (
              <ProductCard
                key={item.slug}
                product={item}
                locale={locale}
                t={t}
                mediaBaseUrl={mediaBaseUrl}
              />
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}
