import { Link, Form, useLocation } from "react-router";
import type { Route } from "./+types/device-finder";
import { cloudflareContext } from "../../../workers/app";
import { parseLocalePath, translator, localePath } from "~/lib/i18n";

/**
 * "Trova accessori per il tuo dispositivo"
 *
 * Brand → family → model, driven entirely by GET navigation. It works with no
 * JavaScript at all, every step is a shareable URL, and browser back moves back
 * one step rather than leaving the flow.
 *
 * Brands are read from the database, never hardcoded: this list changes every
 * year and a new brand must not require a deployment.
 */
export async function loader({ context, request }: Route.LoaderArgs) {
  const { env } = context.get(cloudflareContext);
  const url = new URL(request.url);

  const brand = url.searchParams.get("marca");
  const family = url.searchParams.get("famiglia");

  const brands = await env.DB.prepare(
    `SELECT handle, name FROM device_brands
      WHERE active = 1 AND archived_at IS NULL ORDER BY sort_order ASC, name ASC`,
  ).all<{ handle: string; name: string }>();

  const families = brand
    ? await env.DB.prepare(
        `SELECT f.handle, f.name FROM device_families f
           JOIN device_brands b ON b.id = f.device_brand_id
          WHERE b.handle = ?1 AND f.active = 1 AND f.archived_at IS NULL
          ORDER BY f.sort_order ASC, f.name ASC`,
      )
        .bind(brand)
        .all<{ handle: string; name: string }>()
    : null;

  const models = family
    ? await env.DB.prepare(
        `SELECT m.handle, m.name FROM device_models m
           JOIN device_families f ON f.id = m.device_family_id
          WHERE f.handle = ?1 AND m.active = 1 AND m.archived_at IS NULL
          ORDER BY m.sort_order ASC, m.name ASC`,
      )
        .bind(family)
        .all<{ handle: string; name: string }>()
    : null;

  // Popular devices lead the page so most customers pick in one tap rather
  // than walking three levels.
  const popular = await env.DB.prepare(
    `SELECT handle, name FROM device_models
      WHERE is_popular = 1 AND active = 1 AND archived_at IS NULL
      ORDER BY sort_order ASC LIMIT 12`,
  ).all<{ handle: string; name: string }>();

  return {
    brands: brands.results,
    families: families?.results ?? null,
    models: models?.results ?? null,
    popular: popular.results,
    selected: { brand, family },
  };
}

export default function DeviceFinder({ loaderData }: Route.ComponentProps) {
  const { pathname } = useLocation();
  const { locale } = parseLocalePath(pathname);
  const t = translator(locale);
  const path = (p: string) => localePath(locale, p);
  const { brands, families, models, popular, selected } = loaderData;

  const step = (params: Record<string, string>) =>
    `${path("/trova-dispositivo")}?${new URLSearchParams(params).toString()}`;

  return (
    <div className="page section stack">
      <h1>{t("device.finder_title")}</h1>
      <p className="muted">{t("device.finder_intro")}</p>

      {brands.length === 0 ? (
        /* No device data yet. Say so plainly rather than showing an empty box
           that looks broken. */
        <div className="empty-state">
          <p>{t("device.no_device_results")}</p>
          <Link className="btn btn--secondary" to={path("/shop")}>
            {t("common.shop")}
          </Link>
        </div>
      ) : (
        <>
          {popular.length > 0 && !selected.brand ? (
            <section className="stack">
              <h2>{t("device.popular_devices")}</h2>
              <ul className="cluster">
                {popular.map((model) => (
                  <li key={model.handle}>
                    <Link className="chip" to={`${path("/shop")}?dispositivo=${model.handle}`}>
                      {model.name}
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          <section className="stack">
            <h2>{t("device.select_brand")}</h2>
            <ul className="cluster">
              {brands.map((brand) => (
                <li key={brand.handle}>
                  <Link
                    className="chip"
                    aria-pressed={selected.brand === brand.handle}
                    to={step({ marca: brand.handle })}
                  >
                    {brand.name}
                  </Link>
                </li>
              ))}
            </ul>
          </section>

          {families ? (
            <section className="stack">
              <h2>{t("device.select_family")}</h2>
              {families.length === 0 ? (
                <p className="muted">{t("device.no_device_results")}</p>
              ) : (
                <ul className="cluster">
                  {families.map((family) => (
                    <li key={family.handle}>
                      <Link
                        className="chip"
                        aria-pressed={selected.family === family.handle}
                        to={step({ marca: selected.brand!, famiglia: family.handle })}
                      >
                        {family.name}
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          ) : null}

          {models ? (
            <section className="stack">
              <h2>{t("device.select_model")}</h2>
              {models.length === 0 ? (
                <p className="muted">{t("device.no_device_results")}</p>
              ) : (
                <ul className="cluster">
                  {models.map((model) => (
                    /* Choosing a model goes straight to the compatible
                       catalogue, which is what the customer actually wanted. */
                    <li key={model.handle}>
                      <Link className="chip" to={`${path("/shop")}?dispositivo=${model.handle}`}>
                        {model.name}
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          ) : null}
        </>
      )}

      {/* Search by alias, so "iphone16pro" or "16 pro" finds the model. */}
      <Form method="get" action={path("/shop")} className="cluster" role="search">
        <div className="field" style={{ flex: 1, minWidth: "16rem" }}>
          <label className="field__label" htmlFor="device-q">
            {t("device.search_device")}
          </label>
          <input id="device-q" name="q" type="search" className="input" />
        </div>
        <button type="submit" className="btn btn--primary">
          {t("common.search")}
        </button>
      </Form>

      <p className="caption muted">{t("device.saved_locally")}</p>
    </div>
  );
}
