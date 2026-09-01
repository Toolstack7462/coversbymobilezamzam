import { Link } from "react-router";
import { money, format as formatMoney } from "~/domain/pricing/money";
import { discountDisplay } from "~/domain/pricing/resolve";
import { localePath, type Locale, type Translator } from "~/lib/i18n";
import { CompatibilityBadge } from "./compatibility-badge";
import type { CompatibilityState } from "~/domain/compatibility/resolve";
import { availabilityLabelKey, type AvailabilityState } from "~/domain/inventory/availability";

export interface ProductCardData {
  slug: string;
  name: string;
  priceAmount: number;
  imageKey: string | null;
  /** Only present when the merchant recorded a genuine previous price. */
  previousPriceAmount?: number | null;
  /** The evidenced 30-day low. Without it, no percentage is shown. */
  priorPrice30dAmount?: number | null;
  /**
   * Availability, resolved in the domain layer and passed in.
   *
   * On the card because it is one of the two questions a customer opens the
   * product page to answer — the other being fit. A grid that answers
   * neither costs a click per product.
   */
  availability?: AvailabilityState | null;
  compatibility?: CompatibilityState;
  deviceName?: string | null;
  /**
   * The maker, when knowing it tells the customer something.
   *
   * Suppressed by the loader when the whole catalogue carries ONE brand: this
   * shop's demo data is all "Marchio generico", and printing it on twenty-four
   * cards is twenty-four repetitions of a word that distinguishes nothing. A
   * label every row shares is not information, it is furniture.
   */
  brandName?: string | null;
}

interface Props {
  product: ProductCardData;
  locale: Locale;
  t: Translator;
  mediaBaseUrl?: string | null;
}

export function ProductCard({ product, locale, t, mediaBaseUrl }: Props) {
  const price = money(product.priceAmount);

  // The discount rules live in the domain layer, so no template can invent a
  // percentage that the data does not support (invariant 11).
  const discount = discountDisplay({
    currentPrice: price,
    previousPrice: product.previousPriceAmount ? money(product.previousPriceAmount) : null,
    priorPrice30d: product.priorPrice30dAmount ? money(product.priorPrice30dAmount) : null,
  });

  return (
    <article className="card product-card">
      <Link to={localePath(locale, `/prodotti/${product.slug}`)} className="product-card__link">
        <div className="product-card__media">
          {product.imageKey && mediaBaseUrl ? (
            <img
              src={`${mediaBaseUrl}/${product.imageKey}`}
              alt=""
              /* Dimensions reserve the space so the card does not shift when
                 the image arrives (CLS). */
              width={640}
              height={640}
              loading="lazy"
              decoding="async"
            />
          ) : (
            /* No stock photography and no competitor imagery. An honest empty
               frame beats a picture of something the shop may not stock. */
            <div className="product-card__media-empty" aria-hidden="true" />
          )}
        </div>

        <div className="product-card__body">
          {product.brandName ? <p className="caption muted">{product.brandName}</p> : null}
          <h3 className="product-card__title">{product.name}</h3>

          {product.compatibility ? (
            <CompatibilityBadge
              state={product.compatibility}
              deviceName={product.deviceName ?? null}
              t={t}
              compact
            />
          ) : null}

          {/* `not_tracked` says nothing useful to a customer, so it says
              nothing at all rather than filling the line. */}
          {product.availability && product.availability !== "not_tracked" ? (
            <p className={`product-card__stock small stock--${product.availability}`}>
              {t(availabilityLabelKey(product.availability))}
            </p>
          ) : null}

          <p className="product-card__price">
            <span className="price">{formatMoney(price, locale === "it" ? "it-IT" : "en-GB")}</span>
            {discount.showStrikethrough && discount.previousPrice ? (
              <span className="price--previous">
                {formatMoney(discount.previousPrice, locale === "it" ? "it-IT" : "en-GB")}
              </span>
            ) : null}
            {/* Renders ONLY when a 30-day reference price exists. */}
            {discount.percentage !== null ? (
              <span className="badge badge--sale">
                {t("product.save_percent", { percent: discount.percentage })}
              </span>
            ) : null}
          </p>
        </div>
      </Link>
    </article>
  );
}
