import { useState } from "react";
import { Form, Link } from "react-router";
import { localePath, type Locale, type Translator } from "~/lib/i18n";

type Device = { handle: string; name: string; brand_name: string; product_count: number };

export function DeviceDiscovery({
  devices,
  locale,
  t,
}: {
  devices: Device[];
  locale: Locale;
  t: Translator;
}) {
  const [brand, setBrand] = useState("");
  const brands = [...new Set(devices.map((device) => device.brand_name))];
  const models = devices.filter((device) => !brand || device.brand_name === brand);
  return (
    <div className="discovery">
      <Form method="get" action={localePath(locale, "/shop")} className="discovery__form">
        <div className="field">
          <label htmlFor="discovery-brand">{t("device.select_brand")}</label>
          <select
            id="discovery-brand"
            className="input"
            value={brand}
            onChange={(event) => setBrand(event.target.value)}
          >
            <option value="">{t("home.discovery_all_brands")}</option>
            {brands.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="discovery-model">{t("device.select_model")}</label>
          <select
            key={brand}
            id="discovery-model"
            name="dispositivo"
            className="input"
            required
            defaultValue=""
          >
            <option value="" disabled>
              {t("device.select_model")}
            </option>
            {models.map((device) => (
              <option key={device.handle} value={device.handle}>
                {device.brand_name} · {device.name}
              </option>
            ))}
          </select>
        </div>
        <button className="btn btn--primary" type="submit">
          {t("common.search")}
        </button>
      </Form>
      <ul className="discovery__shortcuts">
        {models.slice(0, 6).map((device) => (
          <li key={device.handle}>
            <Link className="chip" to={localePath(locale, `/shop?dispositivo=${device.handle}`)}>
              {device.name} <span className="muted">({device.product_count})</span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
