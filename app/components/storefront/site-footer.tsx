import { Link, useLocation } from "react-router";
import { localePath, DEFAULT_LOCALE, type Locale, type Translator } from "~/lib/i18n";
import type { StorefrontBrand } from "~/domain/content/brand";
import { BrandLockup } from "./brand-lockup";
import { settingValue, SETTING_KEYS, type SettingsMap } from "~/domain/content/gates";

/**
 * Footer.
 *
 * Every block here is gated on real merchant data. A block whose data is
 * missing renders NOTHING — not a heading over a blank space, not a
 * placeholder. An absent section looks finished; an empty one looks broken
 * (invariant 12).
 */

interface Props {
  t: Translator;
  locale: Locale;
  settings: SettingsMap;
  gates: {
    store: boolean;
    phone: boolean;
    email: boolean;
    whatsapp: boolean;
    legal: boolean;
  };
  /** The same catalogue-derived list the header rail renders. */
  navigation: { slug: string; name: string }[];
  /** The merchant's published content pages, in their chosen order. */
  pages: { slug: string; title: string }[];
  /** From the server's clock, not the visitor's. See the layout loader. */
  year: number;
  /** Merchant-added links for the shop column. */
  extraNav: { label: string; url: string }[];
  /** Published legal documents. Empty until a professional has written them. */
  legal: { code: string; name: string }[];
  /** The same resolved brand the header renders. One rule, one place. */
  brand: StorefrontBrand;
}

export function SiteFooter({
  t,
  locale,
  settings,
  gates,
  navigation,
  pages,
  year,
  extraNav,
  legal,
  brand,
}: Props) {
  const location = useLocation();
  const path = (p: string) => localePath(locale, p);

  const street = settingValue(settings, SETTING_KEYS.storeStreet);
  const postcode = settingValue(settings, SETTING_KEYS.storePostcode);
  const city = settingValue(settings, SETTING_KEYS.storeCity);
  const province = settingValue(settings, SETTING_KEYS.storeProvince);
  const hours = settingValue(settings, SETTING_KEYS.storeHoursDisplay);
  const phone = settingValue(settings, SETTING_KEYS.phone);
  const email = settingValue(settings, SETTING_KEYS.email);
  const whatsapp = settingValue(settings, SETTING_KEYS.whatsappNumber);
  const directions = settingValue(settings, SETTING_KEYS.storeDirectionsUrl);
  const tagline = settingValue(settings, SETTING_KEYS.tagline);

  return (
    <footer className="site-footer">
      <div className="page site-footer__inner">
        <section className="site-footer__column site-footer__brand">
          <BrandLockup brand={brand} locale={locale} variant="footer" />
          {tagline ? <p className="site-footer__tagline">{tagline}</p> : null}
          {gates.store ? <Link to={path("/negozio")}>{t("home.visit_store")}</Link> : null}
        </section>
        <nav className="site-footer__column" aria-label={t("footer.shop")}>
          <h2 className="site-footer__heading">{t("footer.shop")}</h2>
          <ul>
            <li>
              <Link to={path("/shop")}>{t("common.shop")}</Link>
            </li>
            <li>
              <Link to={path("/trova-dispositivo")}>{t("nav.find_by_device")}</Link>
            </li>
            {navigation.slice(0, 4).map((item) => (
              <li key={item.slug}>
                <Link to={path(`/shop?categoria=${item.slug}`)}>{item.name}</Link>
              </li>
            ))}
            {extraNav.map((item) => (
              <li key={item.url}>
                <Link to={path(item.url)}>{item.label}</Link>
              </li>
            ))}
          </ul>
        </nav>
        {pages.length > 0 || legal.length > 0 ? (
          <nav className="site-footer__column" aria-label={t("footer.information")}>
            <h2 className="site-footer__heading">{t("footer.information")}</h2>
            <ul>
              {pages.map((item) => (
                <li key={item.slug}>
                  <Link to={path(`/pagine/${item.slug}`)}>{item.title}</Link>
                </li>
              ))}
              {legal.map((doc) => (
                <li key={doc.code}>
                  <Link to={path(`/legale/${doc.code}`)}>{doc.name}</Link>
                </li>
              ))}
            </ul>
          </nav>
        ) : null}
        {street || gates.phone || gates.email || gates.whatsapp ? (
          <section className="site-footer__column">
            <h2 className="site-footer__heading">{t("footer.support")}</h2>
            {street && postcode && city ? (
              <address>
                {street}
                <br />
                {postcode} {city}
                {province ? ` (${province})` : ""}
              </address>
            ) : null}
            {hours ? <p className="site-footer__hours">{hours}</p> : null}
            <ul>
              {directions ? (
                <li>
                  <a href={directions} target="_blank" rel="noopener noreferrer">
                    {t("store.directions")}
                  </a>
                </li>
              ) : null}
              {gates.phone && phone ? (
                <li>
                  <a href={`tel:${phone.replace(/\s+/g, "")}`}>{phone}</a>
                </li>
              ) : null}
              {gates.email && email ? (
                <li>
                  <a href={`mailto:${email}`}>{email}</a>
                </li>
              ) : null}
              {gates.whatsapp && whatsapp ? (
                <li>
                  <a
                    href={`https://wa.me/${whatsapp.replace(/\D/g, "")}`}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {t("footer.whatsapp")}
                  </a>
                </li>
              ) : null}
            </ul>
          </section>
        ) : null}
      </div>

      {/*
        Trader identification required by D.Lgs. 70/2003.

        All or nothing: a partial legal footer looks like compliance without
        being it, so this renders only once ragione sociale, P.IVA and the
        registered address are all present.
      */}
      {gates.legal ? (
        <div className="page site-footer__legal small muted">
          <p>
            {settingValue(settings, SETTING_KEYS.legalName)}, P.IVA{" "}
            {settingValue(settings, SETTING_KEYS.vatNumber)}
            {settingValue(settings, SETTING_KEYS.reaNumber)
              ? `, REA ${settingValue(settings, SETTING_KEYS.reaNumber)}`
              : ""}
          </p>
        </div>
      ) : null}

      {/*
        The closing line: the year, and who built it.

        Separate from the legal block above on purpose. That block is a legal
        obligation about the MERCHANT and renders all-or-nothing; this one is a
        credit for the people who made the site, and the two must not be
        mistaken for each other — a build credit sitting inside a trader
        identification block reads as part of the disclosure.

        The year is computed, not written. A footer that says 2026 forever is
        the most common way a site announces that nobody has touched it.
      */}
      <div className="page site-footer__colophon small">
        {/*
          The language switcher.

          It used to be a column of two plain links under a heading, which read
          as content rather than as a control — you had to notice "Lingua" and
          then read two words to find out it was a choice.

          A segmented control says "one of these is on" at a glance. They stay
          LINKS rather than buttons because they navigate, and `aria-current`
          rather than `aria-pressed` for the same reason: pressed describes a
          toggle, current describes where you are. `hrefLang` and `lang` are on
          each so a screen reader announces "English" in English.
        */}
        <nav className="lang-switch" aria-label={t("footer.language")}>
          {(
            [
              [DEFAULT_LOCALE, "IT", "Italiano"],
              ["en", "EN", "English"],
            ] as const
          ).map(([code, short, name]) => (
            <Link
              key={code}
              to={localePath(code, `${location.pathname}${location.search}`)}
              reloadDocument
              onClick={(event) => {
                // Fragments are never sent to SSR. Preserve them at activation
                // without producing different server/client hydration markup.
                event.currentTarget.hash = window.location.hash;
              }}
              className="lang-switch__option"
              lang={code}
              hrefLang={code}
              aria-current={locale === code ? "true" : undefined}
            >
              <span className="lang-switch__code" aria-hidden="true">
                {short}
              </span>
              <span className="lang-switch__name">{name}</span>
            </Link>
          ))}
        </nav>

        <p>
          © {year} {brand.full}
        </p>
        <p>
          {t("footer.made_by")}{" "}
          <a
            className="site-footer__maker"
            href="https://genzdigitalstore.com/"
            target="_blank"
            rel="noopener noreferrer"
          >
            Gen Z Digital Store
          </a>
        </p>
      </div>
    </footer>
  );
}
