import { describe, expect, it } from "vitest";
import {
  adminLocaleFromCookie,
  adminLanguageReturnTo,
  adminLocaleFromMatches,
} from "~/lib/admin-locale";
import { adminTranslator } from "~/lib/admin-i18n";
import { localePath } from "~/lib/i18n";
import english from "~/locales/admin/en.json";
import { parseSpecValues } from "~/domain/catalogue/product-types";

describe("admin language preference", () => {
  it("never turns an English ten-thousand capacity into ten", () => {
    const read = (raw: string) => (field: string) => (field === "capacity_mah" ? raw : null);
    expect(parseSpecValues("powerbank", read("10,000"), "en").values.capacity_mah).toBe(10000);
    expect(parseSpecValues("powerbank", read("10.000"), "it").values.capacity_mah).toBe(10000);
    expect(parseSpecValues("powerbank", read("10.000"), "en").errors).toHaveLength(1);
    expect(parseSpecValues("powerbank", read("10 000"), "en").values.capacity_mah).toBe(10000);
  });
  it("accepts only the dedicated valid cookie", () => {
    expect(adminLocaleFromCookie("other=en; admin_language=en; session=unchanged")).toBe("en");
    for (const cookie of [
      null,
      "other_admin_language=en",
      "admin_language=fr",
      "admin_language=enough",
    ])
      expect(adminLocaleFromCookie(cookie)).toBe("it");
    expect(adminLocaleFromMatches([{ id: "root", loaderData: { adminLocale: "en" } }])).toBe("en");
  });
  it("retains admin filters and fragments without allowing redirects off site", () => {
    expect(adminLanguageReturnTo("/admin/prodotti?vista=senza-foto#immagini")).toBe(
      "/admin/prodotti?vista=senza-foto#immagini",
    );
    for (const path of [
      "https://evil.invalid/admin",
      "//evil.invalid/admin",
      "/administrator",
      "/admin/../../shop",
      "/admin\\evil",
      "/admin\n/evil",
      "javascript:alert(1)",
      null,
    ])
      expect(adminLanguageReturnTo(path)).toBe("/admin");
  });
  it("translates controlled copy while retaining interpolated data", () => {
    const t = adminTranslator("en");
    expect(t("Salva dettagli")).toBe("Save details");
    expect(t('Variante "{{v0}}" aggiunta.', { v0: "Blu / SKU-42" })).toBe(
      "Variant “Blu / SKU-42” added.",
    );
    expect(t('Variante "Blu / SKU-42" aggiunta.')).toBe("Variant “Blu / SKU-42” added.");
    expect(t("Merchant's untouched product name")).toBe("Merchant's untouched product name");
    expect(adminTranslator("it")(" Salva ")).toBe(" Salva ");
  });
  it("retains every interpolation token in the English catalogue", () => {
    const tokens = (text: string) => [...text.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]).sort();
    for (const [source, translation] of Object.entries(english)) {
      expect(translation.trim(), source).not.toBe("");
      expect(tokens(translation), source).toEqual(tokens(source));
    }
  });
});

describe("storefront language links", () => {
  it("preserves product paths, encoded filters, tracking tokens and fragments", () => {
    for (const path of [
      "/prodotti/cover?variante=blu#foto",
      "/shop?q=USB%20C&pagina=2",
      "/ordine/ABC?t=opaque",
      "/carrello",
    ]) {
      expect(localePath("en", path)).toBe(`/en${path}`);
      expect(localePath("it", `/en${path}`)).toBe(path);
      expect(localePath("en", `/en${path}`)).toBe(`/en${path}`);
    }
    expect(localePath("it", "/en")).toBe("/");
    expect(localePath("en", "/en?x=1")).toBe("/en/?x=1");
    expect(localePath("en", "/enclosures")).toBe("/en/enclosures");
  });
});
