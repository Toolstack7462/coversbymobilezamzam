import { Link, Form } from "react-router";
import { localePath, type Locale, type Translator } from "~/lib/i18n";
import type { StorefrontBrand } from "~/domain/content/brand";
import { BrandLockup } from "./brand-lockup";

/**
 * Header.
 *
 * No JavaScript required: search is a real GET form, navigation is real links,
 * and the mobile menu is a native `<details>`. Everything works before any
 * script loads, which is also the fastest it will ever be.
 */

interface Props {
  t: Translator;
  locale: Locale;
  /**
   * The resolved brand, from app/domain/content/brand.ts.
   *
   * Not the raw settings: the header used to assemble the wordmark itself and
   * the footer assembled it again, which is one naming rule kept in two places.
   */
  brand: StorefrontBrand;
  /**
   * The categories the shop actually has, in the merchant's order, already
   * translated. Loaded once in the storefront layout and shared with the
   * footer.
   *
   * This was a hardcoded constant of eight slugs, and the catalogue held four
   * under different names — so every link in the primary navigation went to a
   * page reading "0 prodotti". The menu is the catalogue now; it cannot point
   * at a category that is not there.
   */
  navigation: { slug: string; name: string }[];
  /** Merchant-added links, appended after the derived category rail. */
  extraNav: { label: string; url: string }[];
}

export function SiteHeader({ t, locale, brand, navigation, extraNav }: Props) {
  const path = (p: string) => localePath(locale, p);

  return (
    <header className="site-header">
      <div className="page site-header__inner">
        <BrandLockup brand={brand} locale={locale} variant="header" />

        <Form method="get" action={path("/shop")} role="search" className="site-header__search">
          <label htmlFor="q" className="visually-hidden">
            {t("common.search")}
          </label>
          <input
            id="q"
            name="q"
            type="search"
            className="input"
            placeholder={t("common.search_placeholder")}
            autoComplete="off"
          />
          <button type="submit" className="btn btn--primary">
            {t("common.search")}
          </button>
        </Form>

        <nav className="site-header__actions" aria-label={t("common.menu")}>
          <Link to={path("/trova-dispositivo")} className="btn btn--ghost">
            {t("nav.find_by_device")}
          </Link>
          <Link to={path("/carrello")} className="btn btn--ghost">
            {t("common.cart")}
          </Link>
        </nav>
      </div>

      <nav className="site-header__nav" aria-label={t("nav.find_by_device")}>
        <div className="page site-header__nav-inner">
          <ul className="cluster">
            {navigation.map((item) => (
              <li key={item.slug}>
                <Link to={path(`/shop?categoria=${item.slug}`)}>{item.name}</Link>
              </li>
            ))}
            {/* The merchant's own links, after the taxonomy rather than mixed
                into it: these are not categories and should not look like one
                more of them. */}
            {extraNav.map((item) => (
              <li key={item.url}>
                <Link to={path(item.url)}>{item.label}</Link>
              </li>
            ))}
          </ul>
        </div>
      </nav>
    </header>
  );
}
