import type { Locale } from "./i18n";

/** A presentation preference only; it grants no access and stores no identity. */
export const ADMIN_LANGUAGE_COOKIE = "admin_language";

export function adminLocaleFromCookie(cookie: string | null): Locale {
  const value = cookie
    ?.split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${ADMIN_LANGUAGE_COOKIE}=`))
    ?.split("=")[1];
  return value === "en" ? "en" : "it";
}

/** Only return to an existing admin URL on this origin. */
export function adminLanguageReturnTo(value: unknown): string {
  // Reject controls before URL normalisation can hide them.
  // eslint-disable-next-line no-control-regex
  if (typeof value !== "string" || /[\\\u0000-\u0020\u007f]/.test(value)) return "/admin";
  try {
    const url = new URL(value, "https://admin.invalid");
    if (url.origin !== "https://admin.invalid" || !/^\/admin(?:\/|$)/.test(url.pathname))
      return "/admin";
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return "/admin";
  }
}

export function adminLocaleFromMatches(
  matches: readonly ({ id?: string; loaderData?: unknown } | undefined)[],
): Locale {
  const data = matches.find((match) => match?.id === "root")?.loaderData as
    { adminLocale?: Locale } | undefined;
  return data?.adminLocale === "en" ? "en" : "it";
}
