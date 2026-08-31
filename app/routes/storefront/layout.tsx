import { Outlet, useLocation } from "react-router";
import type { Route } from "./+types/layout";
import { cloudflareContext } from "../../../workers/app";
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

/**
 * The storefront shell.
 *
 * Loads merchant settings once and passes them down, so every configuration
 * gate answers from the same snapshot rather than each component querying
 * independently.
 */
export async function loader({ context }: Route.LoaderArgs) {
  const { env } = context.get(cloudflareContext);

  const { results } = await env.DB.prepare(`SELECT key, value FROM store_settings`).all<{
    key: string;
    value: string;
  }>();

  const settings: SettingsMap = Object.fromEntries(results.map((r) => [r.key, r.value]));

  return {
    settings,
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
      <SiteHeader t={t} locale={locale} brandName={loaderData.brandName} />
      <main id="main">
        <Outlet />
      </main>
      {loaderData.appEnv !== "production" ? <PreviewBanner env={loaderData.appEnv} /> : null}

      <SiteFooter t={t} locale={locale} settings={loaderData.settings} gates={loaderData.gates} />
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
      <strong>Ambiente di prova</strong> — questo non è il negozio. Prodotti, prezzi, disponibilità
      e compatibilità sono inventati a scopo di test, e nessun ordine è reale.{" "}
      <span className="caption">({env})</span>
    </aside>
  );
}
