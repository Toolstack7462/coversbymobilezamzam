import it from "~/locales/it.json";
import en from "~/locales/en.json";

/**
 * Interface translation.
 *
 * Italian is the default and the fallback. Language is chosen by URL prefix
 * (`/en/...`), so a page has one canonical address and a shared link shows the
 * recipient the same language the sender saw (ADR 0009).
 *
 * Merchant content — product names, descriptions, pages — is NOT here. That
 * lives in D1 and is edited in the admin.
 */

export const DEFAULT_LOCALE = "it";
export const SUPPORTED_LOCALES = ["it", "en"] as const;
export type Locale = (typeof SUPPORTED_LOCALES)[number];

const DICTIONARIES: Record<Locale, unknown> = { it, en };

/** Locales that read right-to-left. None enabled yet; see ADR 0009. */
const RTL_LOCALES = ["ar", "he", "fa", "ur"];

export function isLocale(value: string): value is Locale {
  return (SUPPORTED_LOCALES as readonly string[]).includes(value);
}

export function direction(locale: string): "ltr" | "rtl" {
  return RTL_LOCALES.includes(locale) ? "rtl" : "ltr";
}

/**
 * Splits a pathname into its locale and the rest.
 *
 * `/en/prodotti/cover` -> { locale: "en", pathname: "/prodotti/cover" }
 * `/prodotti/cover`    -> { locale: "it", pathname: "/prodotti/cover" }
 */
export function parseLocalePath(pathname: string): { locale: Locale; pathname: string } {
  const [, maybeLocale, ...rest] = pathname.split("/");
  if (maybeLocale && isLocale(maybeLocale)) {
    return { locale: maybeLocale, pathname: `/${rest.join("/")}` };
  }
  return { locale: DEFAULT_LOCALE, pathname };
}

/** Builds a path in the given locale. Italian carries no prefix. */
export function localePath(locale: Locale, pathname: string): string {
  const clean = pathname.startsWith("/") ? pathname : `/${pathname}`;
  return locale === DEFAULT_LOCALE ? clean : `/${locale}${clean}`;
}

function lookup(dictionary: unknown, key: string): string | undefined {
  const value = key
    .split(".")
    .reduce<unknown>(
      (acc, part) =>
        acc !== null && typeof acc === "object"
          ? (acc as Record<string, unknown>)[part]
          : undefined,
      dictionary,
    );
  return typeof value === "string" ? value : undefined;
}

export type Translator = (key: string, vars?: Record<string, string | number>) => string;

/**
 * Returns a translator for a locale.
 *
 * A missing key falls back to Italian, then returns the key itself. It never
 * renders `undefined` to a customer — and `npm run locales:check` fails the
 * build before a missing key can reach here anyway.
 */
export function translator(locale: Locale): Translator {
  const primary = DICTIONARIES[locale];
  const fallback = DICTIONARIES[DEFAULT_LOCALE];

  return (key, vars) => {
    const template = lookup(primary, key) ?? lookup(fallback, key) ?? key;
    if (!vars) return template;
    return template.replace(/\{\{(\w+)\}\}/g, (match, name: string) =>
      name in vars ? String(vars[name]) : match,
    );
  };
}

/**
 * Italian pluralisation, which has two forms: one and other.
 *
 * Written explicitly rather than reached for by string concatenation, so the
 * key exists statically and the parity check can see it.
 */
export function plural(t: Translator, baseKey: string, count: number): string {
  const suffix = count === 1 ? "one" : "other";
  return t(`${baseKey}_${suffix}`, { count });
}

/** Customer-facing dates are Italian local time, whatever the storage says. */
export function formatDateTime(epochMs: number, locale: Locale): string {
  return new Intl.DateTimeFormat(locale === "it" ? "it-IT" : "en-GB", {
    timeZone: "Europe/Rome",
    dateStyle: "long",
    timeStyle: "short",
  }).format(new Date(epochMs));
}
