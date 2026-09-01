import { settingValue, SETTING_KEYS, type SettingsMap } from "./gates";

/**
 * The storefront's brand identity — the one place it is decided.
 *
 * ── Why this exists ──────────────────────────────────────────────────────────
 *
 * The wordmark was assembled inline in the header (`brandName ?? shopName ??
 * t("common.shop")`) and the footer separately reproduced the same chain. Two
 * copies of a naming rule is one naming rule and one bug waiting: the day
 * somebody adds a second line, or changes the fallback order, the two drift and
 * the header and footer of the same shop disagree about what it is called.
 *
 * Every surface that names the shop now asks this: the header lockup, the
 * footer lockup, the document title, and `og:site_name`.
 *
 * ── The two lines ────────────────────────────────────────────────────────────
 *
 * `Covers by Mobile` over `Zam Zam` — a primary trading name with a store
 * identity beneath it. Both come from settings the merchant controls, because
 * a brand is a merchant fact and this project does not invent those.
 *
 * The secondary line is OPTIONAL and absent by default. A shop that has not set
 * one gets a single-line wordmark rather than an empty second line, which is
 * what every shop other than this one will want.
 *
 * ── What must never appear ───────────────────────────────────────────────────
 *
 * "Italian Tech Atelier" is the internal project name. It was once the header's
 * fallback, which meant an unconfigured shop presented a developer's working
 * title to customers as its wordmark — worse than no wordmark, because it looks
 * deliberate and so nobody reports it. The fallback is a generic word instead,
 * which says nothing false and is obviously unfinished to the merchant. A
 * locale test guards the project name.
 */
export interface StorefrontBrand {
  /** The wordmark. Never empty — falls back to a generic word. */
  primary: string;
  /** The line beneath it. Null when the merchant has not set one. */
  secondary: string | null;
  /**
   * Both lines as one string, for a document title or `og:site_name` where
   * there is no second line to put anything on.
   */
  full: string;
}

/**
 * @param settings the storefront settings snapshot
 * @param fallback what to call the shop when nothing is configured — passed in
 *   rather than imported so this stays free of the translator, and so the
 *   caller's locale decides.
 */
export function storefrontBrand(settings: SettingsMap, fallback: string): StorefrontBrand {
  const primary =
    settingValue(settings, SETTING_KEYS.brandName) ??
    settingValue(settings, SETTING_KEYS.shopName) ??
    fallback;

  const secondaryRaw = settingValue(settings, SETTING_KEYS.brandSecondary);

  /*
   * A secondary line identical to the primary is dropped.
   *
   * It is an easy thing for a merchant to do — filling in both fields with the
   * same words — and the result would be the shop's name printed twice, once
   * quietly. Better to render the single line they meant.
   */
  const secondary =
    secondaryRaw && secondaryRaw.toLowerCase() !== primary.toLowerCase() ? secondaryRaw : null;

  return {
    primary,
    secondary,
    full: secondary ? `${primary} ${secondary}` : primary,
  };
}
