import { Link } from "react-router";
import { localePath, DEFAULT_LOCALE, type Locale, type Translator } from "~/lib/i18n";
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
}

export function SiteFooter({ t, locale, settings, gates }: Props) {
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
  const shopName = settingValue(settings, SETTING_KEYS.shopName);
  const tagline = settingValue(settings, SETTING_KEYS.tagline);

  return (
    <footer className="site-footer">
      <div className="page site-footer__inner">
        {/*
          Who this is, first.

          A footer that opens with a link list assumes the reader already knows
          whose shop they are on. Rendered only when the merchant has supplied
          a name — never a placeholder, and never this project's own.
        */}
        {shopName ? (
          <section className="site-footer__column site-footer__brand">
            <p className="site-footer__wordmark">{shopName}</p>
            {tagline ? <p className="small">{tagline}</p> : null}
          </section>
        ) : null}

        <nav className="site-footer__column" aria-label={t("footer.shop")}>
          <h2 className="site-footer__heading">{t("footer.shop")}</h2>
          <ul>
            <li>
              <Link to={path("/shop")}>{t("common.shop")}</Link>
            </li>
            <li>
              <Link to={path("/trova-dispositivo")}>{t("nav.find_by_device")}</Link>
            </li>
          </ul>
        </nav>

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
            {hours ? <p className="small muted">{hours}</p> : null}
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

        <section className="site-footer__column">
          <h2 className="site-footer__heading">{t("footer.language")}</h2>
          <ul className="small">
            <li>
              <Link to={localePath(DEFAULT_LOCALE, "/")} lang="it" hrefLang="it">
                Italiano
              </Link>
            </li>
            <li>
              <Link to={localePath("en", "/")} lang="en" hrefLang="en">
                English
              </Link>
            </li>
          </ul>
        </section>
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
            {settingValue(settings, SETTING_KEYS.legalName)} — P.IVA{" "}
            {settingValue(settings, SETTING_KEYS.vatNumber)}
            {settingValue(settings, SETTING_KEYS.reaNumber)
              ? ` — REA ${settingValue(settings, SETTING_KEYS.reaNumber)}`
              : ""}
          </p>
        </div>
      ) : null}
    </footer>
  );
}
