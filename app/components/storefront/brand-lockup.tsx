import { Link } from "react-router";
import { localePath, type Locale } from "~/lib/i18n";
import type { StorefrontBrand } from "~/domain/content/brand";

/**
 * The brand lockup, used by the header and the footer.
 *
 * One component rather than two similar blocks, because the header and the
 * footer of the same shop disagreeing about its name is the exact failure this
 * replaces — they previously each built the wordmark from their own copy of the
 * fallback chain.
 *
 * The two lines are one unit: a `<span>` pair inside a single link, so a screen
 * reader announces "Covers by Mobile Zam Zam" as one destination rather than
 * reading a heading and then an orphaned phrase. The second line is not a
 * separate link, because it is not a separate place.
 */
export function BrandLockup({
  brand,
  locale,
  variant,
}: {
  brand: StorefrontBrand;
  locale: Locale;
  /** `header` is the wordmark; `footer` is the masthead, one step larger. */
  variant: "header" | "footer";
}) {
  return (
    <Link
      to={localePath(locale, "/")}
      className={`brand-lockup brand-lockup--${variant}`}
      // The accessible name is both lines, so it does not depend on how the
      // two spans happen to be concatenated by a given screen reader.
      aria-label={brand.full}
    >
      <span className="brand-lockup__primary">{brand.primary}</span>
      {brand.secondary ? (
        <span className="brand-lockup__secondary" aria-hidden="true">
          {brand.secondary}
        </span>
      ) : null}
    </Link>
  );
}
