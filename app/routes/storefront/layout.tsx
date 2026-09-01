import { Outlet, useLocation } from "react-router";
import type { Route } from "./+types/layout";
import { cloudflareContext } from "../../../workers/app";
import { systemClock } from "~/infrastructure/primitives";
import { parseLocalePath, translator } from "~/lib/i18n";
import {
  canShowStoreSection,
  canShowPhone,
  canShowEmail,
  canShowWhatsApp,
  canShowLegalIdentity,
  settingValue,
  SETTING_KEYS,
  type SettingsMap,
} from "~/domain/content/gates";
import { SiteHeader } from "~/components/storefront/site-header";
import { SiteFooter } from "~/components/storefront/site-footer";
import { MobileNav } from "~/components/storefront/mobile-nav";

/**
 * The storefront shell.
 *
 * Loads merchant settings once and passes them down, so every configuration
 * gate answers from the same snapshot rather than each component querying
 * independently.
 */
export async function loader({ context, request }: Route.LoaderArgs) {
  const { env } = context.get(cloudflareContext);

  const { results } = await env.DB.prepare(`SELECT key, value FROM store_settings`).all<{
    key: string;
    value: string;
  }>();

  const settings: SettingsMap = Object.fromEntries(results.map((r) => [r.key, r.value]));

  /*
   * The navigation, read from the catalogue.
   *
   * It used to be a hardcoded list of eight slugs in site-header.tsx, and the
   * catalogue held four categories under DIFFERENT slugs. Nothing matched, so
   * every category link in the header led to a page reading "0 prodotti" — and
   * the footer, built from the same constant, repeated all eight broken links.
   * A shop whose own menu goes nowhere.
   *
   * The taxonomy has one home now: the categories table. A category that does
   * not exist cannot appear in the menu, and one that is renamed is renamed in
   * the menu at the same instant. That class of bug is gone rather than fixed.
   *
   * `visible` and `archived_at` are honoured here because the merchant's
   * decision to hide a category has to mean it disappears from the navigation,
   * not just from the listing.
   */
  const { locale } = parseLocalePath(new URL(request.url).pathname);

  const { results: navRows } = await env.DB.prepare(
    `SELECT c.slug, COALESCE(ct.name, ct_fallback.name) AS name
       FROM categories c
       LEFT JOIN category_translations ct
         ON ct.category_id = c.id AND ct.locale = ?
       LEFT JOIN category_translations ct_fallback
         ON ct_fallback.category_id = c.id AND ct_fallback.locale = 'it'
      WHERE c.visible = 1 AND c.archived_at IS NULL AND c.depth = 0
      ORDER BY c.sort_order ASC, c.slug ASC`,
  )
    .bind(locale)
    .all<{ slug: string; name: string | null }>();

  /*
   * The merchant's published pages, for the footer.
   *
   * Read rather than hardcoded for the same reason as the category rail: a
   * footer listing pages a constant believes in is a footer that links to 404s
   * the day one is unpublished. A page removed here disappears from the site
   * the moment it is removed, which is what unpublishing has to mean.
   */
  const { results: pageRows } = await env.DB.prepare(
    `SELECT p.slug, COALESCE(t.title, fallback.title) AS title
       FROM pages p
       LEFT JOIN page_translations t        ON t.page_id = p.id AND t.locale = ?1
       LEFT JOIN page_translations fallback ON fallback.page_id = p.id AND fallback.locale = 'it'
      WHERE p.status = 'published'
        AND p.archived_at IS NULL
        AND (p.publish_at IS NULL OR p.publish_at <= ?2)
      ORDER BY p.sort_order ASC, p.slug ASC
      LIMIT 12`,
  )
    .bind(locale, Date.now())
    .all<{ slug: string; title: string | null }>();

  /*
   * The merchant's extra menu links.
   *
   * Appended to the derived category rail, never replacing it. Each is checked
   * against something that exists at RENDER time as well as at save time: a
   * page unpublished after the link was made would otherwise stay in the menu
   * pointing at a 404, which is precisely the class of bug the derived rail
   * exists to prevent.
   */
  const { results: extraNav } = await env.DB.prepare(
    `SELECT i.label_it, i.label_en, i.url, m.code AS menu_code
       FROM navigation_items i
       JOIN navigation_menus m ON m.id = i.menu_id
      WHERE i.visible = 1
        AND (
          i.url IN ('/', '/shop', '/trova-dispositivo', '/negozio', '/carrello')
          OR EXISTS (
            SELECT 1 FROM pages p
             WHERE p.status = 'published' AND p.archived_at IS NULL
               AND i.url = '/pagine/' || p.slug
          )
          OR EXISTS (
            SELECT 1 FROM categories c
             WHERE c.visible = 1 AND c.archived_at IS NULL
               AND i.url = '/shop?categoria=' || c.slug
          )
        )
      ORDER BY m.code, i.sort_order`,
  ).all<{ label_it: string; label_en: string; url: string; menu_code: string }>();

  return {
    settings,
    extraNav: extraNav.map((item) => ({
      label: locale === "en" ? item.label_en : item.label_it,
      url: item.url,
      menu: item.menu_code,
    })),
    /*
     * The year for the footer, from the server's clock.
     *
     * Not `new Date()` in the component: that would read the VISITOR's clock,
     * so a browser with the wrong date — or one an hour the other side of new
     * year — would show a copyright line the shop never wrote. The year is a
     * fact about the shop, so the shop's environment supplies it.
     */
    year: new Date(systemClock.now()).getFullYear(),
    pages: pageRows.filter((r) => r.title).map((r) => ({ slug: r.slug, title: r.title as string })),
    // A category with no name in any locale is not shown. Rendering a link
    // labelled with a slug is worse than a shorter menu.
    navigation: navRows
      .filter((r) => r.name)
      .map((r) => ({ slug: r.slug, name: r.name as string })),
    // Drives the preview banner. Read from the environment rather than guessed
    // from the hostname: a hostname check would silently stop working the day
    // a custom domain is attached to a preview.
    appEnv: env.APP_ENV ?? "development",
    gates: {
      store: canShowStoreSection(settings),
      phone: canShowPhone(settings),
      email: canShowEmail(settings),
      whatsapp: canShowWhatsApp(settings),
      legal: canShowLegalIdentity(settings),
    },
    brandName: settingValue(settings, SETTING_KEYS.brandName),
    shopName: settingValue(settings, SETTING_KEYS.shopName),
  };
}

export default function StorefrontLayout({ loaderData }: Route.ComponentProps) {
  const { pathname } = useLocation();
  const { locale } = parseLocalePath(pathname);
  const t = translator(locale);

  return (
    <>
      <SiteHeader
        t={t}
        locale={locale}
        brandName={loaderData.brandName}
        shopName={loaderData.shopName}
        navigation={loaderData.navigation}
        extraNav={loaderData.extraNav.filter((i) => i.menu === "header_extra")}
      />
      <main id="main">
        <Outlet />
      </main>
      <SiteFooter
        t={t}
        locale={locale}
        settings={loaderData.settings}
        gates={loaderData.gates}
        navigation={loaderData.navigation}
        pages={loaderData.pages}
        year={loaderData.year}
        extraNav={loaderData.extraNav.filter((i) => i.menu === "footer_extra")}
      />

      {/* Phones only — see mobile-nav.tsx. Last in the DOM so it is last in the
          tab order, where a persistent navigation bar belongs. */}
      <MobileNav t={t} locale={locale} />

      {/*
        Last thing in the document, and never in production.

        It used to sit between the last section and the footer, where it
        interrupted the page exactly as the dark footer was meant to close it.
        A warning about the environment is not content; it belongs after the
        content, quietly.
      */}
      {loaderData.appEnv !== "production" ? <PreviewBanner env={loaderData.appEnv} /> : null}
    </>
  );
}

/**
 * Says, on every page, that this is not the shop.
 *
 * A preview is a working copy of a real business on a real HTTPS address. Anyone
 * who is sent the link — a friend, a supplier, the merchant's accountant — has
 * no way to tell it apart from the live shop, and the prices, stock and
 * compatibility on it are all invented. Saying so once, quietly, at the bottom
 * of the page, costs nothing and prevents somebody acting on demo data.
 *
 * Deliberately not a floating overlay: this is a shop, and something that
 * covers the product on a phone screen is worse than the problem it solves.
 */
function PreviewBanner({ env }: { env: string }) {
  return (
    <aside className="preview-banner" role="note">
      <span className="preview-banner__dot" aria-hidden="true" />
      <span>
        <strong>Ambiente di prova</strong> {"·"} prodotti e prezzi non sono reali
      </span>
      <span className="preview-banner__env">{env}</span>
    </aside>
  );
}
