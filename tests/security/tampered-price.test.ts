import { env } from "cloudflare:test";
import { describe, it, expect, beforeEach } from "vitest";
import { createOrder, CreateOrderInput } from "~/application/commands/create-order";
import { fixedClock, cryptoIds } from "~/infrastructure/primitives";
import { seed, orderInput, IDS } from "../fixtures/seed";

/**
 * Invariant 2: the server is the only authority.
 *
 * The interesting assertion here is not that a tampered price is rejected — it
 * is that a tampered price has nowhere to GO. The input schema has no price
 * field, so a submitted one is dropped at the boundary rather than validated
 * and trusted.
 */

const deps = {
  d1: env.DB,
  clock: fixedClock(1_756_000_100_000),
  ids: cryptoIds,
  vatBasisPoints: 2200,
  defaultLocationId: IDS.location,
};

async function storedTotal(orderNumber: string): Promise<number> {
  const row = await env.DB.prepare(`SELECT grand_total FROM orders WHERE order_number = ?1`)
    .bind(orderNumber)
    .first<{ grand_total: number }>();
  return row!.grand_total;
}

describe("price tampering", () => {
  beforeEach(async () => {
    await seed(env.DB, { onHand: 10, price: 3990 });
  });

  it("ignores a price submitted by the client", async () => {
    const tampered = {
      ...orderInput(),
      // None of these fields exist in CreateOrderInput. Zod strips them.
      grandTotal: 1,
      itemSubtotal: 1,
      lines: [{ variantId: IDS.variant, quantity: 1, unitPrice: 1, price: 1 }],
    };

    const parsed = CreateOrderInput.parse(tampered);
    const result = await createOrder(parsed, deps);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // The database price, not the submitted one.
    expect(await storedTotal(result.orderNumber)).toBe(3990);
    expect(result.total.amount).toBe(3990);
  });

  it("drops unknown fields at the schema boundary", () => {
    const parsed = CreateOrderInput.parse({
      ...orderInput(),
      grandTotal: 1,
      status: "paid",
      paymentStatus: "verified",
    });

    expect(parsed).not.toHaveProperty("grandTotal");
    expect(parsed).not.toHaveProperty("status");
    expect(parsed).not.toHaveProperty("paymentStatus");
    expect(parsed.lines[0]).not.toHaveProperty("unitPrice");
  });

  it("recomputes the total from the database on every line", async () => {
    const result = await createOrder(
      CreateOrderInput.parse(orderInput({ lines: [{ variantId: IDS.variant, quantity: 3 }] })),
      deps,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(await storedTotal(result.orderNumber)).toBe(3990 * 3);
  });

  it("uses the price at order time, not the price when the cart was filled", async () => {
    // The merchant raises the price between browsing and confirming.
    await env.DB.prepare(`UPDATE variant_prices SET amount = 4990 WHERE variant_id = ?1`)
      .bind(IDS.variant)
      .run();

    const result = await createOrder(CreateOrderInput.parse(orderInput()), deps);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(await storedTotal(result.orderNumber)).toBe(4990);
  });

  it("rejects a non-integer or negative quantity", () => {
    expect(() =>
      CreateOrderInput.parse(orderInput({ lines: [{ variantId: IDS.variant, quantity: -1 }] })),
    ).toThrow();
    expect(() =>
      CreateOrderInput.parse(orderInput({ lines: [{ variantId: IDS.variant, quantity: 1.5 }] })),
    ).toThrow();
    expect(() =>
      CreateOrderInput.parse(orderInput({ lines: [{ variantId: IDS.variant, quantity: 0 }] })),
    ).toThrow();
  });

  it("refuses an order created with a disabled payment method", async () => {
    // A method whose merchant data is missing must not be usable even if its
    // id is submitted directly (invariant 12).
    await seed(env.DB, { onHand: 5, paymentMethodActive: false });

    const result = await createOrder(CreateOrderInput.parse(orderInput()), deps);
    expect(result).toMatchObject({ ok: false, reason: "payment_method_unavailable" });

    const orders = await env.DB.prepare(`SELECT COUNT(*) AS n FROM orders`).first<{ n: number }>();
    expect(orders!.n).toBe(0);
  });

  it("refuses to order an archived product", async () => {
    await env.DB.prepare(`UPDATE products SET archived_at = ?1 WHERE id = ?2`)
      .bind(1_756_000_000_000, IDS.product)
      .run();

    const result = await createOrder(CreateOrderInput.parse(orderInput()), deps);
    expect(result).toMatchObject({ ok: false, reason: "unavailable" });
  });
});

describe("order identifiers", () => {
  beforeEach(async () => {
    await seed(env.DB, { onHand: 10 });
  });

  it("issues a tracking token that is not derivable from the order number", async () => {
    // The order number carries its own date and is therefore partly guessable,
    // which is exactly why it never authorises access on its own.
    const result = await createOrder(CreateOrderInput.parse(orderInput()), deps);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.trackingToken).toHaveLength(32);
    expect(result.trackingToken).not.toContain(result.orderNumber);
    expect(result.orderNumber).not.toContain(result.trackingToken);
  });

  it("issues a different token to every order", async () => {
    const a = await createOrder(CreateOrderInput.parse(orderInput()), deps);
    const b = await createOrder(CreateOrderInput.parse(orderInput()), deps);
    if (!a.ok || !b.ok) throw new Error("expected both orders to succeed");
    expect(a.trackingToken).not.toBe(b.trackingToken);
    expect(a.orderNumber).not.toBe(b.orderNumber);
  });
});
