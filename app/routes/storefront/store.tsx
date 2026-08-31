import { useLocation } from "react-router";
import type { Route } from "./+types/store";
import { cloudflareContext } from "../../../workers/app";
import { parseLocalePath, translator } from "~/lib/i18n";
import {
  canShowStoreSection,
  canShowOpeningHours,
  canEmitStructuredHours,
  canEmitLocalBusinessSchema,
  canShowPhone,
  canShowEmail,
  settingValue,
  SETTING_KEYS,
  type SettingsMap,
} from "~/domain/content/gates";

/**
 * The shop page.
 *
 * Every element is gated. The address is known from the brief and renders; the
 * shop name, hours and contact details do not exist yet and therefore render
 * nothing at all.
 */
export function meta() {
  return [
    { title: "Il negozio" },
    {
      name: "description",
      content: "Dove siamo, quando siamo aperti e come ritirare un ordine in negozio.",
    },
  ];
}

export async function loader({ context }: Route.LoaderArgs) {
  const { env } = context.get(cloudflareContext);
  const { results } = await env.DB.prepare(`SELECT key, value FROM store_settings`).all<{
    key: string;
    value: string;
  }>();
  const settings: SettingsMap = Object.fromEntries(results.map((r) => [r.key, r.value]));

  return {
    name: settingValue(settings, SETTING_KEYS.shopName),
    street: settingValue(settings, SETTING_KEYS.storeStreet),
    postcode: settingValue(settings, SETTING_KEYS.storePostcode),
    city: settingValue(settings, SETTING_KEYS.storeCity),
    province: settingValue(settings, SETTING_KEYS.storeProvince),
    latitude: settingValue(settings, SETTING_KEYS.storeLatitude),
    longitude: settingValue(settings, SETTING_KEYS.storeLongitude),
    hoursDisplay: canShowOpeningHours(settings)
      ? settingValue(settings, SETTING_KEYS.storeHoursDisplay)
      : null,
    hoursStructured: canEmitStructuredHours(settings)
      ? settingValue(settings, SETTING_KEYS.storeHoursStructured)
      : null,
    phone: canShowPhone(settings) ? settingValue(settings, SETTING_KEYS.phone) : null,
    email: canShowEmail(settings) ? settingValue(settings, SETTING_KEYS.email) : null,
    directionsUrl: settingValue(settings, SETTING_KEYS.storeDirectionsUrl),
    parking: settingValue(settings, SETTING_KEYS.storeParkingInfo),
    accessibility: settingValue(settings, SETTING_KEYS.storeAccessibilityInfo),
    canShowSection: canShowStoreSection(settings),
    canEmitSchema: canEmitLocalBusinessSchema(settings),
  };
}

export default function StorePage({ loaderData }: Route.ComponentProps) {
  const { pathname } = useLocation();
  const { locale } = parseLocalePath(pathname);
  const t = translator(locale);
  const d = loaderData;

  return (
    <div className="page section stack">
      <h1>{d.name ?? t("store.title")}</h1>

      {d.street && d.postcode && d.city ? (
        <section className="panel stack">
          <h2>{t("store.address")}</h2>
          <address>
            {d.street}
            <br />
            {d.postcode} {d.city}
            {d.province ? ` (${d.province})` : ""}
          </address>

          {/*
            A privacy-conscious directions LINK rather than an embedded map.
            An iframe from a mapping provider loads third-party scripts and sets
            cookies before the customer has agreed to anything.
          */}
          {d.directionsUrl ? (
            <p>
              <a
                className="btn btn--secondary"
                href={d.directionsUrl}
                rel="noopener noreferrer"
                target="_blank"
              >
                {t("store.directions")}
              </a>
            </p>
          ) : d.latitude && d.longitude ? (
            <p>
              <a
                className="btn btn--secondary"
                href={`https://www.openstreetmap.org/?mlat=${d.latitude}&mlon=${d.longitude}#map=18/${d.latitude}/${d.longitude}`}
                rel="noopener noreferrer"
                target="_blank"
              >
                {t("store.directions")}
              </a>
            </p>
          ) : null}
        </section>
      ) : null}

      {/* Hours render only when the merchant has stated them. An invented
          opening time sends a real person to a closed door. */}
      {d.hoursDisplay ? (
        <section className="panel stack">
          <h2>{t("store.opening_hours")}</h2>
          <p style={{ whiteSpace: "pre-line" }}>{d.hoursDisplay}</p>
        </section>
      ) : null}

      {d.phone || d.email ? (
        <section className="panel stack">
          <h2>{t("footer.support")}</h2>
          <ul>
            {d.phone ? (
              <li>
                <a href={`tel:${d.phone.replace(/\s+/g, "")}`}>{d.phone}</a>
              </li>
            ) : null}
            {d.email ? (
              <li>
                <a href={`mailto:${d.email}`}>{d.email}</a>
              </li>
            ) : null}
          </ul>
        </section>
      ) : null}

      {d.parking || d.accessibility ? (
        <section className="panel stack">
          {d.parking ? <p>{d.parking}</p> : null}
          {d.accessibility ? <p>{d.accessibility}</p> : null}
        </section>
      ) : null}

      {/*
        LocalBusiness structured data, emitted ONLY from verified details.
        Publishing a wrong address to search engines is worse than publishing
        none, so the gate requires the shop name AND coordinates. `openingHours`
        is added separately, because a merchant may know their hours without
        being sure of the schema.org format.
      */}
      {d.canEmitSchema ? (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify({
              "@context": "https://schema.org",
              "@type": "LocalBusiness",
              name: d.name,
              address: {
                "@type": "PostalAddress",
                streetAddress: d.street,
                postalCode: d.postcode,
                addressLocality: d.city,
                addressRegion: d.province ?? undefined,
                addressCountry: "IT",
              },
              geo: {
                "@type": "GeoCoordinates",
                latitude: d.latitude,
                longitude: d.longitude,
              },
              ...(d.hoursStructured ? { openingHours: d.hoursStructured } : {}),
              ...(d.phone ? { telephone: d.phone } : {}),
              ...(d.email ? { email: d.email } : {}),
            }),
          }}
        />
      ) : null}
    </div>
  );
}
