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

export function meta({ loaderData }: Route.MetaArgs) {
  // Falls back rather than inventing: an untranslated product still needs a
  // title, and its slug is a real fact about it where a made-up name is not.
  const name = loaderData?.product?.name ?? loaderData?.product?.slug ?? "Prodotto";
  return [{ title: name }];
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
  const image = await env.DB.prepare(
    `SELECT object_key, alt_it, alt_en, width, height
       FROM product_images
      WHERE product_id = ?1
      ORDER BY is_primary DESC, sort_order ASC
      LIMIT 1`,
  )
    .bind(product.id)
    .first<{
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

  return {
    product,
    image,
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
  };
}

export default function ProductPage({ loaderData }: Route.ComponentProps) {
  const { pathname } = useLocation();
  const { locale } = parseLocalePath(pathname);
  const t = translator(locale);
  const { product, image, mediaBaseUrl, variants, compatibilityRecords, specs, compatibleDevices } =
    loaderData;

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
        <div className="product-page__media">
          {image ? (
            <img
              src={`${mediaBaseUrl}/${image.object_key}`}
              /* The alt text belongs to the image, not to the product: these
                 are currently placeholder illustrations and say so. An empty
                 alt would be right for pure decoration, but this carries
                 information the sighted visitor is getting. */
              alt={(locale === "en" ? image.alt_en : image.alt_it) ?? ""}
              width={image.width}
              height={image.height}
              /* Above the fold on the page it belongs to — never lazy. */
              fetchPriority="high"
              decoding="async"
            />
          ) : (
            <div className="product-card__media-empty" aria-hidden="true" />
          )}
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
    </div>
  );
}
