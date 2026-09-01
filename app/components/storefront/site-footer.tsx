import { Link } from "react-router";
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
      {/*
        Who this is, first — on its own tier.

        A footer that opens with a link list assumes the reader already knows
        whose shop they are on. This used to be the first cell of the link grid,
        which stretched it to the height of the tallest column and left a void
        under the name the size of a paragraph. It is a band now: the name gets
        its own line, the columns start clean beneath it, and nothing is
        stretched to fill space it does not want.

        Rendered only when the merchant has supplied a name — never a
        placeholder, and never this project's own.
      */}
      <div className="page site-footer__masthead">
        <BrandLockup brand={brand} locale={locale} variant="footer" />
        {tagline ? <p className="site-footer__tagline">{tagline}</p> : null}
      </div>

      <div className="page site-footer__inner">
        {/*
          The full category list, from the SAME source as the header rail.
          Two hand-maintained copies of a taxonomy drift, and the footer is the
          copy nobody notices has drifted.
        */}
        <nav className="site-footer__column" aria-label={t("footer.categories")}>
          <h2 className="site-footer__heading">{t("footer.categories")}</h2>
          <ul>
            {navigation.map((item) => (
              <li key={item.slug}>
                <Link to={path(`/shop?categoria=${item.slug}`)}>{item.name}</Link>
              </li>
            ))}
          </ul>
        </nav>

        <nav className="site-footer__column" aria-label={t("footer.shop")}>
          <h2 className="site-footer__heading">{t("footer.shop")}</h2>
          <ul>
            <li>
              <Link to={path("/shop")}>{t("common.shop")}</Link>
            </li>
            <li>
              <Link to={path("/trova-dispositivo")}>{t("nav.find_by_device")}</Link>
            </li>
            {extraNav.map((item) => (
              <li key={item.url}>
                <Link to={path(item.url)}>{item.label}</Link>
              </li>
            ))}
          </ul>
        </nav>

        {/*
          Services, in a column of their own.

          They used to be a second heading inside "Acquista", which made them
          look like a subsection of shopping. They are the half of the business
          that happens at a counter, and burying them under a shop heading was
          the layout disagreeing with the positioning.

          Still not links: there is no page behind any of them yet, and a link
          to nowhere is worse than plain text.
        */}
        {gates.store ? (
          <section className="site-footer__column">
            <h2 className="site-footer__heading">{t("footer.services")}</h2>
            <ul className="site-footer__plain">
              <li>{t("footer.repairs")}</li>
              <li>{t("footer.screen_installation")}</li>
              <li>{t("footer.device_assistance")}</li>
            </ul>
          </section>
        ) : null}

        {/*
          The merchant's own pages. Absent entirely when none are published —
          a heading over an empty list is the thing this footer exists to avoid.
        */}
        {pages.length > 0 ? (
          <nav className="site-footer__column" aria-label={t("footer.information")}>
            <h2 className="site-footer__heading">{t("footer.information")}</h2>
            <ul>
              {pages.map((item) => (
                <li key={item.slug}>
                  <Link to={path(`/pagine/${item.slug}`)}>{item.title}</Link>
                </li>
              ))}
            </ul>
          </nav>
        ) : null}

        {/* The address is known, so this renders. The shop NAME is not, so the
            store page link only appears once it is configured. */}
        {street && postcode && city ? (
          <section className="site-footer__column">
            <h2 className="site-footer__heading">{t("store.address")}</h2>
            <address className="small">
              {street}
              <br />
              {postcode} {city}
              {province ? ` (${province})` : ""}
            </address>
            {gates.store ? (
              <p className="small">
                <Link to={path("/negozio")}>{t("store.title")}</Link>
              </p>
            ) : null}
            {hours ? <p className="small site-footer__hours">{hours}</p> : null}
            {directions ? (
              <p className="small">
                {/* Opens a map application. `noreferrer` because the
                    destination has no business knowing which page sent them. */}
                <a href={directions} target="_blank" rel="noopener noreferrer">
                  {t("store.directions")}
                </a>
              </p>
            ) : null}
          </section>
        ) : null}

        {gates.phone || gates.email ? (
          <section className="site-footer__column">
            <h2 className="site-footer__heading">{t("footer.support")}</h2>
            <ul className="small">
              {phone ? (
                <li>
                  <a href={`tel:${phone.replace(/\s+/g, "")}`}>{phone}</a>
                </li>
              ) : null}
              {email ? (
                <li>
                  <a href={`mailto:${email}`}>{email}</a>
                </li>
              ) : null}
              {gates.whatsapp && whatsapp ? (
                <li>
                  {/* wa.me takes digits only — no plus, no spaces. */}
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

        {/*
          Legal.

          Rendered only for documents that actually have a published version
          with text in it. A footer that lists "Privacy" and links to nothing is
          worse than one that does not mention it: the link is itself a claim
          that the document exists.
        */}
        {legal.length > 0 ? (
          <nav className="site-footer__column" aria-label={t("footer.legal")}>
            <h2 className="site-footer__heading">{t("footer.legal")}</h2>
            <ul>
              {legal.map((doc) => (
                <li key={doc.code}>
                  <Link to={path(`/legale/${doc.code}`)}>{doc.name}</Link>
                </li>
              ))}
            </ul>
          </nav>
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
              to={localePath(code, "/")}
              className="lang-switch__option"
              lang={code}
              hrefLang={code}
              aria-current={locale === code ? "true" : undefined}
            >
              <span className="lang-switch__code">{short}</span>
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
