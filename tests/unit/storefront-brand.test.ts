import { describe, it, expect } from "vitest";
import { storefrontBrand } from "~/domain/content/brand";
import { SETTING_KEYS, type SettingsMap } from "~/domain/content/gates";

/**
 * The storefront's brand, resolved in one place.
 *
 * These lock the rules the header, the footer, the document title and
 * `og:site_name` all now depend on. Before this module each of those built the
 * name from its own copy of the fallback chain, so "what is this shop called"
 * had four answers that happened to agree.
 */
const settings = (entries: Record<string, string>): SettingsMap => entries;

describe("storefrontBrand", () => {
  it("puts the marketing brand over the store identity", () => {
    const brand = storefrontBrand(
      settings({
        [SETTING_KEYS.brandName]: "Covers by Mobile",
        [SETTING_KEYS.brandSecondary]: "Zam Zam",
      }),
      "Negozio",
    );

    expect(brand.primary).toBe("Covers by Mobile");
    expect(brand.secondary).toBe("Zam Zam");
    // One string for the places that have only one line to put it on.
    expect(brand.full).toBe("Covers by Mobile Zam Zam");
  });

  it("falls back to the name over the door when no marketing brand is set", () => {
    const brand = storefrontBrand(
      settings({ [SETTING_KEYS.shopName]: "Covers by Mobile" }),
      "Negozio",
    );
    expect(brand.primary).toBe("Covers by Mobile");
    expect(brand.secondary).toBeNull();
  });

  it("never renders the internal project name", () => {
    /*
     * The fallback was once "Italian Tech Atelier" — this project's working
     * title, presented to customers as a wordmark. Worse than no wordmark,
     * because it looks deliberate and so nobody reports it.
     */
    const brand = storefrontBrand(settings({}), "Negozio");
    expect(brand.primary).toBe("Negozio");
    expect(brand.full).not.toMatch(/italian tech atelier/i);
  });

  it("drops a secondary line that repeats the primary", () => {
    // An easy thing for a merchant to do, and the result would be the shop's
    // name printed twice, the second time quietly.
    const brand = storefrontBrand(
      settings({
        [SETTING_KEYS.brandName]: "Covers by Mobile",
        [SETTING_KEYS.brandSecondary]: "covers by mobile",
      }),
      "Negozio",
    );

    expect(brand.secondary).toBeNull();
    expect(brand.full).toBe("Covers by Mobile");
  });

  it("treats an empty secondary setting as absent", () => {
    const brand = storefrontBrand(
      settings({ [SETTING_KEYS.brandName]: "Covers by Mobile", [SETTING_KEYS.brandSecondary]: "" }),
      "Negozio",
    );
    expect(brand.secondary).toBeNull();
  });
});
