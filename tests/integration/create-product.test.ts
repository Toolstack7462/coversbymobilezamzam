import { env } from "cloudflare:test";
import { describe, it, expect, beforeEach } from "vitest";
import { createProduct, CreateProductInput } from "~/application/commands/create-product";
import { fixedClock, cryptoIds } from "~/infrastructure/primitives";
import { seed, IDS } from "../../tests/fixtures/seed";

/**
 * Product creation, against a real D1 with the real migrations.
 *
 * The thing being proved is that a product is never HALF created. A row in
 * `products` with no variant is a name, not a product; a variant with no
 * `inventory_levels` row is not at zero stock but at *unknown* stock, which the
 * availability logic treats differently. Either would look fine in the admin
 * list and be unsellable on the storefront, with nothing on screen explaining
 * why.
 */

const NOW = 1_756_000_500_000;

const deps = {
  d1: env.DB,
  clock: fixedClock(NOW),
  ids: cryptoIds,
  defaultLocationId: IDS.location,
  actorId: "user_test",
  actorLabel: "Test Staff",
};

const input = (over: Record<string, unknown> = {}) =>
  CreateProductInput.parse({ name: "Cover iPhone 15 Pro", sku: "COV-15-PRO", ...over });

describe("a new product", () => {
  beforeEach(async () => {
    await seed(env.DB);
  });

  it("creates the five rows that make it sellable, in one batch", async () => {
    const result = await createProduct(input({ price: "39,90", onHand: 12 }), deps);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const product = await env.DB.prepare(`SELECT * FROM products WHERE id = ?1`)
      .bind(result.productId)
      .first<Record<string, unknown>>();
    expect(product).not.toBeNull();
    expect(product!.slug).toBe("cover-iphone-15-pro");

    const translation = await env.DB.prepare(
      `SELECT name FROM product_translations WHERE product_id = ?1 AND locale = 'it'`,
    )
      .bind(result.productId)
      .first<{ name: string }>();
    expect(translation!.name).toBe("Cover iPhone 15 Pro");

    const variant = await env.DB.prepare(
      `SELECT id, sku, is_default FROM product_variants WHERE product_id = ?1`,
    )
      .bind(result.productId)
      .first<{ id: string; sku: string; is_default: number }>();
    expect(variant!.is_default).toBe(1);

    const level = await env.DB.prepare(
      `SELECT on_hand, reserved FROM inventory_levels WHERE variant_id = ?1`,
    )
      .bind(variant!.id)
      .first<{ on_hand: number; reserved: number }>();
    expect(level).toMatchObject({ on_hand: 12, reserved: 0 });

    const price = await env.DB.prepare(
      `SELECT amount, currency FROM variant_prices WHERE variant_id = ?1`,
    )
      .bind(variant!.id)
      .first<{ amount: number; currency: string }>();
    // 39,90 as integer minor units. Never 39.9 as a float.
    expect(price).toMatchObject({ amount: 3990, currency: "EUR" });
  });

  it("opens the price history so the first discount can be evidenced", async () => {
    // Without an opening row there is no baseline for the 30-day prior price,
    // and the first announced discount would be unlawful (D.Lgs. 84/2022).
    const result = await createProduct(input({ price: "39,90" }), deps);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const history = await env.DB.prepare(
      `SELECT ph.old_amount, ph.new_amount, ph.effective_from, ph.effective_to
         FROM price_history ph
         JOIN product_variants v ON v.id = ph.variant_id
        WHERE v.product_id = ?1`,
    )
      .bind(result.productId)
      .first<Record<string, number | null>>();

    expect(history).not.toBeNull();
    expect(history!.old_amount).toBeNull();
    expect(history!.new_amount).toBe(3990);
    // Still open: it is the current price, not a superseded one.
    expect(history!.effective_to).toBeNull();
  });

  it("is a draft unless publishing was asked for", async () => {
    // Publishing by default would put an unpriced, unphotographed product on a
    // live shop the moment someone typed a name.
    const drafted = await createProduct(input(), deps);
    expect(drafted.ok).toBe(true);
    if (!drafted.ok) return;

    const row = await env.DB.prepare(`SELECT status, published_at FROM products WHERE id = ?1`)
      .bind(drafted.productId)
      .first<{ status: string; published_at: number | null }>();
    expect(row).toMatchObject({ status: "draft", published_at: null });
  });

  it("records who created it", async () => {
    const result = await createProduct(input(), deps);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const audit = await env.DB.prepare(
      `SELECT actor_id, action FROM audit_logs WHERE entity_id = ?1`,
    )
      .bind(result.productId)
      .first<{ actor_id: string; action: string }>();
    expect(audit).toMatchObject({ actor_id: "user_test", action: "product.create" });
  });
});

describe("a product without a price", () => {
  beforeEach(async () => {
    await seed(env.DB);
  });

  it("is created, but with no price row at all", async () => {
    // Deliberately not a zero price. A missing price and a free product are
    // different facts, and the "Senza prezzo" view exists to surface the first.
    const result = await createProduct(input({ price: "" }), deps);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const price = await env.DB.prepare(
      `SELECT COUNT(*) AS n FROM variant_prices vp
         JOIN product_variants v ON v.id = vp.variant_id
        WHERE v.product_id = ?1`,
    )
      .bind(result.productId)
      .first<{ n: number }>();
    expect(price!.n).toBe(0);
  });

  it("still gets a stock row, so its availability is known rather than unknown", async () => {
    const result = await createProduct(input({ price: "" }), deps);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const level = await env.DB.prepare(
      `SELECT COUNT(*) AS n FROM inventory_levels il
         JOIN product_variants v ON v.id = il.variant_id
        WHERE v.product_id = ?1`,
    )
      .bind(result.productId)
      .first<{ n: number }>();
    expect(level!.n).toBe(1);
  });
});

describe("refusals leave nothing behind", () => {
  beforeEach(async () => {
    await seed(env.DB);
  });

  it("refuses an unreadable price and writes no rows", async () => {
    const before = await env.DB.prepare(`SELECT COUNT(*) AS n FROM products`).first<{
      n: number;
    }>();

    const result = await createProduct(input({ price: "trentanove euro" }), deps);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("39,90");

    const after = await env.DB.prepare(`SELECT COUNT(*) AS n FROM products`).first<{ n: number }>();
    expect(after!.n).toBe(before!.n);
  });

  it("refuses a duplicate SKU with a sentence, not a constraint error", async () => {
    // Two physical piles the system believes are one is a stocktake that can
    // never be reconciled.
    const first = await createProduct(input({ sku: "DUP-1" }), deps);
    expect(first.ok).toBe(true);

    const second = await createProduct(input({ name: "Altro prodotto", sku: "DUP-1" }), deps);
    expect(second.ok).toBe(false);
    if (second.ok) return;
    expect(second.error).toContain("DUP-1");
  });

  it("treats SKUs case-insensitively by uppercasing on save", async () => {
    const first = await createProduct(input({ sku: "abc-1" }), deps);
    expect(first.ok).toBe(true);

    const second = await createProduct(input({ name: "Secondo", sku: "ABC-1" }), deps);
    expect(second.ok).toBe(false);
  });
});

describe("slugs", () => {
  beforeEach(async () => {
    await seed(env.DB);
  });

  it("gives a second product with the same name a readable suffix", async () => {
    const first = await createProduct(input({ sku: "S-1" }), deps);
    const second = await createProduct(input({ sku: "S-2" }), deps);

    expect(first.ok && first.slug).toBe("cover-iphone-15-pro");
    expect(second.ok && second.slug).toBe("cover-iphone-15-pro-2");
  });

  it("handles Italian accents and apostrophes", async () => {
    const result = await createProduct(
      input({ name: "Custodia dell'iPhone in città", sku: "ACC-1" }),
      deps,
    );
    expect(result.ok && result.slug).toBe("custodia-dell-iphone-in-citta");
  });
});
