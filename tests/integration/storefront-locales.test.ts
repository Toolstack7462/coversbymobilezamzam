import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { RouterContextProvider } from "react-router";
import { appContext } from "~/runtime/context";
import { testAppEnv } from "../helpers/app-env";
import { seed, IDS } from "../fixtures/seed";
import { loader as home } from "~/routes/storefront/home";
import { loader as product } from "~/routes/storefront/product";
import { loader as collection } from "~/routes/storefront/collection";
import { readCartLines } from "~/lib/cart.server";
import { action as language } from "~/routes/admin/language";

function args(path: string) {
  const context = new RouterContextProvider();
  context.set(appContext, { env: testAppEnv(env), platform: "cloudflare", waitUntil: () => {} });
  return {
    request: new Request(`https://shop.invalid${path}`),
    params: { slug: "cover-silicone" },
    context,
    url: new URL(`https://shop.invalid${path}`),
    pattern: "/",
  };
}

describe("actual storefront loaders use merchant translations", () => {
  beforeEach(async () => {
    await seed(env.DB);
    await env.DB.prepare(
      `UPDATE products SET slug = 'cover-silicone', is_featured = 1 WHERE id = ?1`,
    )
      .bind(IDS.product)
      .run();
    await env.DB.prepare(
      `INSERT INTO product_translations (id, product_id, locale, name, short_description, full_description) VALUES ('locale-product-en', ?1, 'en', 'Merchant English case', '', 'Merchant English details') ON CONFLICT(product_id, locale) DO UPDATE SET name = excluded.name, short_description = excluded.short_description, full_description = excluded.full_description`,
    )
      .bind(IDS.product)
      .run();
    await env.DB.prepare(
      `UPDATE product_translations SET short_description = 'Descrizione italiana' WHERE product_id = ?1 AND locale = 'it'`,
    )
      .bind(IDS.product)
      .run();
    await env.DB.prepare(
      `INSERT INTO category_translations (id, category_id, locale, name, description) VALUES ('locale-category-en', ?1, 'en', 'Merchant cases', 'English category') ON CONFLICT(category_id, locale) DO UPDATE SET name = excluded.name, description = excluded.description`,
    )
      .bind(IDS.category)
      .run();
  });
  it("reads English on PDP and falls back per empty field", async () => {
    const result = await product(args("/en/prodotti/cover-silicone"));
    expect(result.product.name).toBe("Merchant English case");
    expect(result.product.short_description).toBe("Descrizione italiana");
    expect(result.product.full_description).toBe("Merchant English details");
    const italian = await product(args("/prodotti/cover-silicone"));
    expect(italian.product.name).not.toBe("Merchant English case");
  });
  it("reads English in homepage and filtered collection, including category copy", async () => {
    const homepage = await home(args("/en/"));
    expect(JSON.stringify(homepage)).toContain("Merchant English case");
    expect(JSON.stringify(homepage)).toContain("Merchant cases");
    const listing = await collection(args("/en/shop?categoria=cover"));
    expect(JSON.stringify(listing)).toContain("Merchant English case");
    expect(listing.activeCategory?.name).toBe("Merchant cases");
    expect(listing.activeCategory?.description).toBe("English category");
  });
  it("reflects a subsequent CMS edit without a deployment", async () => {
    await env.DB.prepare(
      `UPDATE product_translations SET name = 'Changed by merchant' WHERE product_id = ?1 AND locale = 'en'`,
    )
      .bind(IDS.product)
      .run();
    expect((await product(args("/en/prodotti/cover-silicone"))).product.name).toBe(
      "Changed by merchant",
    );
    await env.DB.prepare(`DELETE FROM product_translations WHERE product_id = ?1 AND locale = 'en'`)
      .bind(IDS.product)
      .run();
    expect((await product(args("/en/prodotti/cover-silicone"))).product.name).toBe(
      (await product(args("/prodotti/cover-silicone"))).product.name,
    );
  });
  it("keeps cart identity and quantities when translating its product names", async () => {
    await env.DB.prepare(
      `INSERT INTO carts (id, token, currency, expires_at, created_at, updated_at) VALUES ('locale-cart', 'locale-token', 'EUR', 9999999999999, 1, 1)`,
    ).run();
    await env.DB.prepare(
      `INSERT INTO cart_items (id, cart_id, variant_id, quantity, created_at, updated_at) VALUES ('locale-line', 'locale-cart', ?1, 2, 1, 1)`,
    )
      .bind(IDS.variant)
      .run();
    const db = testAppEnv(env).DB;
    const en = await readCartLines(db, "locale-cart", "en");
    const it = await readCartLines(db, "locale-cart", "it");
    expect(en[0]?.productName).toBe("Merchant English case");
    expect(en.map(({ productName: _name, ...line }) => line)).toEqual(
      it.map(({ productName: _name, ...line }) => line),
    );
  });
});

describe("admin language action", () => {
  function post(origin: string, languageValue: string, returnTo: string) {
    return language({
      ...args("/admin/lingua"),
      request: new Request("https://shop.invalid/admin/lingua", {
        method: "POST",
        headers: { Origin: origin },
        body: new URLSearchParams({ language: languageValue, returnTo }),
      }),
    });
  }
  it("sets only the private presentation cookie and redirects to the same admin page", async () => {
    const response = await post("https://shop.invalid", "en", "/admin/prodotti?vista=attivi#foto");
    expect(response.status).toBe(303);
    expect(response.headers.get("Location")).toBe("/admin/prodotti?vista=attivi#foto");
    expect(response.headers.get("Set-Cookie")).toContain("admin_language=en; Path=/admin;");
    expect(response.headers.get("Set-Cookie")).toContain("HttpOnly; Secure; SameSite=Lax");
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  });
  it("rejects cross-origin changes and unsupported languages", async () => {
    expect((await post("https://other.invalid", "en", "/admin")).status).toBe(403);
    expect((await post("https://shop.invalid", "fr", "/admin")).status).toBe(400);
    expect(
      (await post("https://shop.invalid", "it", "//other.invalid/admin")).headers.get("Location"),
    ).toBe("/admin");
  });
});
