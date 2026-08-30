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
      <SiteFooter t={t} locale={locale} settings={loaderData.settings} gates={loaderData.gates} />
    </>
  );
}
