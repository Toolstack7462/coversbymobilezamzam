import { Link, Form } from "react-router";
import { localePath, type Locale, type Translator } from "~/lib/i18n";

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
  /** `business.brand_name` — a marketing name, if the merchant uses one. */
  brandName: string | null;
  /** `store.name` — the name over the door. Nothing is invented (invariant 12). */
  shopName: string | null;
}

export const PRIMARY_NAV = [
  { key: "nav.cases", slug: "cover" },
  { key: "nav.screen_protection", slug: "protezione-schermo" },
  { key: "nav.chargers", slug: "caricatori" },
  { key: "nav.cables", slug: "cavi" },
  { key: "nav.power_banks", slug: "power-bank" },
  { key: "nav.magsafe", slug: "magsafe" },
  { key: "nav.audio", slug: "audio" },
  { key: "nav.car_mounts", slug: "supporti-auto" },
] as const;

export function SiteHeader({ t, locale, brandName, shopName }: Props) {
  const path = (p: string) => localePath(locale, p);

  return (
    <header className="site-header">
      <div className="page site-header__inner">
        <Link to={path("/")} className="site-header__brand">
          {/*
            The merchant's name, and never this project's.

            The fallback used to be "Italian Tech Atelier", which is the
            INTERNAL project name — and with no brand configured, that is what
            every customer saw in the header of a real shop. A developer's
            working title presented as a wordmark is worse than no wordmark:
            it looks deliberate, so nobody reports it.

            Order: a marketing brand name if one is used, otherwise the name
            over the door, otherwise the generic word — which says nothing
            false and is obviously unfinished to the merchant.
          */}
          {brandName ?? shopName ?? t("common.shop")}
        </Link>

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
            {PRIMARY_NAV.map((item) => (
              <li key={item.slug}>
                <Link to={path(`/shop?categoria=${item.slug}`)}>{t(item.key)}</Link>
              </li>
            ))}
          </ul>
        </div>
      </nav>
    </header>
  );
}
