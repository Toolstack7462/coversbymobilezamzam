import { useRouteLoaderData } from "react-router";
import { adminTranslator } from "~/lib/admin-i18n";
import type { Locale } from "~/lib/i18n";

const translators = { it: adminTranslator("it"), en: adminTranslator("en") };

export function useAdminTranslator() {
  const root = useRouteLoaderData<{ adminLocale?: Locale }>("root");
  return translators[root?.adminLocale === "en" ? "en" : "it"];
}
