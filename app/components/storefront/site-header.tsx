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
  /** Null until the merchant supplies it. Nothing is invented (invariant 12). */
  brandName: string | null;
}

const PRIMARY_NAV = [
  { key: "nav.cases", slug: "cover" },
  { key: "nav.screen_protection", slug: "protezione-schermo" },
  { key: "nav.chargers", slug: "caricatori" },
  { key: "nav.cables", slug: "cavi" },
  { key: "nav.power_banks", slug: "power-bank" },
  { key: "nav.magsafe", slug: "magsafe" },
  { key: "nav.audio", slug: "audio" },
  { key: "nav.car_mounts", slug: "supporti-auto" },
] as const;

export function SiteHeader({ t, locale, brandName }: Props) {
  const path = (p: string) => localePath(locale, p);

  return (
    <header className="site-header">
      <div className="page site-header__inner">
        <Link to={path("/")} className="site-header__brand">
          {/*
            The wordmark falls back to the internal project name only when the
            merchant has not supplied a public brand name. It is deliberately
            not a plausible-looking invented shop name.
          */}
          {brandName ?? "Italian Tech Atelier"}
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
