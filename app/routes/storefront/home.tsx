import { Link, useLocation } from "react-router";
import type { Route } from "./+types/home";
import { cloudflareContext } from "../../../workers/app";
import { parseLocalePath, translator, localePath } from "~/lib/i18n";
import { canShowStoreSection, canOfferPickup, type SettingsMap } from "~/domain/content/gates";
import { ProductCard, type ProductCardData } from "~/components/storefront/product-card";

export function meta() {
  // Deliberately generic until the merchant supplies a brand name. A title
  // naming a shop that has not been named is an invention.
  return [{ title: "Accessori per smartphone" }];
}

export async function loader({ context }: Route.LoaderArgs) {
  const { env } = context.get(cloudflareContext);

  const [settingsResult, newArrivals, categories] = await Promise.all([
    env.DB.prepare(`SELECT key, value FROM store_settings`).all<{
      key: string;
      value: string;
    }>(),
    env.DB.prepare(
      `SELECT p.id, p.slug, pt.name,
              (SELECT amount FROM variant_prices vp
                 JOIN product_variants v ON v.id = vp.variant_id
                WHERE v.product_id = p.id ORDER BY vp.amount ASC LIMIT 1) AS price_amount,
              (SELECT object_key FROM product_images pi
                WHERE pi.product_id = p.id
                ORDER BY pi.is_primary DESC, pi.sort_order ASC LIMIT 1) AS image_key
         FROM products p
         LEFT JOIN product_translations pt ON pt.product_id = p.id AND pt.locale = 'it'
        WHERE p.status = 'active' AND p.archived_at IS NULL
        ORDER BY p.published_at DESC
        LIMIT 8`,
    ).all<{
      id: string;
      slug: string;
      name: string | null;
      price_amount: number | null;
      image_key: string | null;
    }>(),
    env.DB.prepare(
      `SELECT c.slug, ct.name
         FROM categories c
         LEFT JOIN category_translations ct ON ct.category_id = c.id AND ct.locale = 'it'
        WHERE c.visible = 1 AND c.archived_at IS NULL AND c.depth = 0
        ORDER BY c.sort_order ASC LIMIT 8`,
    ).all<{ slug: string; name: string | null }>(),
  ]);

  const settings: SettingsMap = Object.fromEntries(
    settingsResult.results.map((r) => [r.key, r.value]),
  );

  return {
    products: newArrivals.results
      .filter((p) => p.price_amount !== null)
      .map<ProductCardData>((p) => ({
        slug: p.slug,
        name: p.name ?? p.slug,
        priceAmount: p.price_amount!,
        imageKey: p.image_key,
      })),
    categories: categories.results.filter((c) => c.name),
    showStore: canShowStoreSection(settings) || canOfferPickup(settings),
  };
}

export default function Home({ loaderData }: Route.ComponentProps) {
  const { pathname } = useLocation();
  const { locale } = parseLocalePath(pathname);
  const t = translator(locale);
  const path = (p: string) => localePath(locale, p);

  return (
    <>
      {/*
        The hero is compact by design: it does not fill the viewport, so
        products stay reachable with one short scroll on a phone.
      */}
      <section className="hero">
        <div className="page hero__inner">
          <h1 className="hero__heading">
            {t("home.hero_heading")}
            <br />
            <span className="hero__heading-secondary">{t("home.hero_heading_line2")}</span>
          </h1>
          <p className="hero__body">{t("home.hero_body")}</p>
          <div className="cluster">
            <Link className="btn btn--primary" to={path("/shop")}>
              {t("home.shop_now")}
            </Link>
            <Link className="btn btn--secondary" to={path("/trova-dispositivo")}>
              {t("home.find_device")}
            </Link>
            {/* Only once the shop is genuinely configured. */}
            {loaderData.showStore ? (
              <Link className="btn btn--secondary" to={path("/negozio")}>
                {t("home.visit_store")}
              </Link>
            ) : null}
          </div>
        </div>
      </section>

      {/* Second on the page, right under the hero: on mobile a customer reaches
          the device finder with one short scroll. Moving it down measurably
          reduces its use. */}
      <section className="page section">
        <div className="panel device-finder-promo">
          <h2>{t("device.finder_title")}</h2>
          <p className="muted">{t("device.finder_intro")}</p>
          <Link className="btn btn--primary" to={path("/trova-dispositivo")}>
            {t("home.find_device")}
          </Link>
        </div>
      </section>

      {/* Sections with no data render NOTHING — not an empty frame. */}
      {loaderData.categories.length > 0 ? (
        <section className="page section">
          <h2>{t("home.popular_categories")}</h2>
          <ul className="cluster">
            {loaderData.categories.map((category) => (
              <li key={category.slug}>
                <Link className="chip" to={path(`/shop?categoria=${category.slug}`)}>
                  {category.name}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {loaderData.products.length > 0 ? (
        <section className="page section">
          <h2>{t("home.new_arrivals")}</h2>
          <div className="grid-products">
            {loaderData.products.map((product) => (
              <ProductCard key={product.slug} product={product} locale={locale} t={t} />
            ))}
          </div>
        </section>
      ) : null}
    </>
  );
}
