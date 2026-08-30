import { env } from "cloudflare:test";
import { describe, it, expect, beforeEach } from "vitest";
import { createOrder, CreateOrderInput } from "~/application/commands/create-order";
import { fixedClock, cryptoIds } from "~/infrastructure/primitives";
import { seed, orderInput, IDS } from "../fixtures/seed";

/**
 * Invariant 5: order items are snapshots, not projections.
 *
 * An order is the record of an agreement at a moment. If renaming a product or
 * fixing a price rewrote past orders, the shop could not answer "what did I
 * actually sell them?" — and neither could an auditor.
 */

const deps = {
  d1: env.DB,
  clock: fixedClock(1_756_000_100_000),
  ids: cryptoIds,
  vatBasisPoints: 2200,
  defaultLocationId: IDS.location,
};

async function itemsFor(orderId: string) {
  const { results } = await env.DB.prepare(
    `SELECT product_name, variant_label, sku, unit_price, line_total, compatibility_state
       FROM order_items WHERE order_id = ?1`,
  )
    .bind(orderId)
    .all<{
      product_name: string;
      variant_label: string | null;
      sku: string;
      unit_price: number;
      line_total: number;
      compatibility_state: string | null;
    }>();
  return results;
}

describe("order item snapshots", () => {
  beforeEach(async () => {
    await seed(env.DB, { onHand: 10, price: 3990 });
  });

  it("survives the product being renamed", async () => {
    const order = await createOrder(CreateOrderInput.parse(orderInput()), deps);
    if (!order.ok) throw new Error("expected the order to succeed");

    await env.DB.prepare(
      `UPDATE product_translations SET name = 'Nome completamente diverso' WHERE product_id = ?1`,
    )
      .bind(IDS.product)
      .run();

    const items = await itemsFor(order.orderId);
    expect(items[0]!.product_name).toBe("Cover di prova");
    expect(items[0]!.product_name).not.toContain("diverso");
  });

  it("survives the price changing", async () => {
    const order = await createOrder(CreateOrderInput.parse(orderInput()), deps);
    if (!order.ok) throw new Error("expected the order to succeed");

    await env.DB.prepare(`UPDATE variant_prices SET amount = 9990 WHERE variant_id = ?1`)
      .bind(IDS.variant)
      .run();

    const items = await itemsFor(order.orderId);
    expect(items[0]!.unit_price).toBe(3990);
    expect(items[0]!.line_total).toBe(3990);

    const total = await env.DB.prepare(`SELECT grand_total FROM orders WHERE id = ?1`)
      .bind(order.orderId)
      .first<{ grand_total: number }>();
    expect(total!.grand_total).toBe(3990);
  });

  it("survives the SKU changing", async () => {
    const order = await createOrder(CreateOrderInput.parse(orderInput()), deps);
    if (!order.ok) throw new Error("expected the order to succeed");

    await env.DB.prepare(`UPDATE product_variants SET sku = 'SKU-CHANGED' WHERE id = ?1`)
      .bind(IDS.variant)
      .run();

    const items = await itemsFor(order.orderId);
    expect(items[0]!.sku).toBe("SKU-BLACK");
  });

  it("survives the product being archived", async () => {
    const order = await createOrder(CreateOrderInput.parse(orderInput()), deps);
    if (!order.ok) throw new Error("expected the order to succeed");

    await env.DB.prepare(`UPDATE products SET archived_at = ?1 WHERE id = ?2`)
      .bind(1_756_000_900_000, IDS.product)
      .run();

    // The historical order still renders in full.
    const items = await itemsFor(order.orderId);
    expect(items).toHaveLength(1);
    expect(items[0]!.product_name).toBe("Cover di prova");
  });

  it("snapshots the compatibility state the customer was shown", async () => {
    const order = await createOrder(
      CreateOrderInput.parse(orderInput({ deviceModelId: IDS.deviceModel })),
      deps,
    );
    if (!order.ok) throw new Error("expected the order to succeed");

    const before = await itemsFor(order.orderId);
    expect(before[0]!.compatibility_state).toBe("exact");

    // A later data correction must not rewrite what the customer was told.
    await env.DB.prepare(
      `UPDATE product_compatibility SET compatibility_level = 'incompatible' WHERE product_id = ?1`,
    )
      .bind(IDS.product)
      .run();

    const after = await itemsFor(order.orderId);
    expect(after[0]!.compatibility_state).toBe("exact");
  });

  it("refuses to delete a product an order references", async () => {
    // ON DELETE RESTRICT. Deleting would either break the order or silently
    // lose what was sold, so archiving is the only route (invariant 13).
    const order = await createOrder(CreateOrderInput.parse(orderInput()), deps);
    if (!order.ok) throw new Error("expected the order to succeed");

    await expect(
      env.DB.prepare(`DELETE FROM products WHERE id = ?1`).bind(IDS.product).run(),
    ).rejects.toThrow();
  });
});
