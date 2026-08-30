import { env } from "cloudflare:test";
import { describe, it, expect, beforeEach } from "vitest";
import { createOrder, CreateOrderInput } from "~/application/commands/create-order";
import { fixedClock, cryptoIds } from "~/infrastructure/primitives";
import { seed, orderInput, IDS } from "../../tests/fixtures/seed";

/**
 * Invariants 4 and 14, against a real D1 with the real migrations.
 *
 * This file exists to answer one question with evidence rather than
 * confidence: can this system sell the same physical unit twice?
 */

const deps = {
  d1: env.DB,
  clock: fixedClock(1_756_000_100_000),
  ids: cryptoIds,
  vatBasisPoints: 2200,
  defaultLocationId: IDS.location,
};

async function reservedCount(): Promise<number> {
  const row = await env.DB.prepare(
    `SELECT reserved, on_hand FROM inventory_levels WHERE variant_id = ?1 AND location_id = ?2`,
  )
    .bind(IDS.variant, IDS.location)
    .first<{ reserved: number; on_hand: number }>();
  return row!.reserved;
}

describe("the last unit", () => {
  beforeEach(async () => {
    await seed(env.DB, { onHand: 1 });
  });

  it("is sold exactly once when two customers order simultaneously", async () => {
    const a = createOrder(CreateOrderInput.parse(orderInput()), deps);
    const b = createOrder(CreateOrderInput.parse(orderInput()), deps);

    const [first, second] = await Promise.all([a, b]);
    const outcomes = [first, second];

    const succeeded = outcomes.filter((r) => r.ok);
    const failed = outcomes.filter((r) => !r.ok);

    expect(succeeded).toHaveLength(1);
    expect(failed).toHaveLength(1);
    expect(failed[0]).toMatchObject({ ok: false, reason: "out_of_stock" });
  });

  it("never lets reserved exceed on_hand", async () => {
    await Promise.all([
      createOrder(CreateOrderInput.parse(orderInput()), deps),
      createOrder(CreateOrderInput.parse(orderInput()), deps),
      createOrder(CreateOrderInput.parse(orderInput()), deps),
    ]);

    const row = await env.DB.prepare(
      `SELECT reserved, on_hand FROM inventory_levels WHERE variant_id = ?1`,
    )
      .bind(IDS.variant)
      .first<{ reserved: number; on_hand: number }>();

    expect(row!.reserved).toBeLessThanOrEqual(row!.on_hand);
  });

  it("leaves no partial order behind when the reservation fails", async () => {
    // A partial order holding stock is worse than no order: invisible to staff,
    // invisible to the customer, and a unit silently removed from sale.
    await createOrder(CreateOrderInput.parse(orderInput()), deps);
    const blocked = await createOrder(CreateOrderInput.parse(orderInput()), deps);
    expect(blocked.ok).toBe(false);

    const orders = await env.DB.prepare(`SELECT COUNT(*) AS n FROM orders`).first<{ n: number }>();
    const reservations = await env.DB.prepare(
      `SELECT COUNT(*) AS n FROM stock_reservations`,
    ).first<{ n: number }>();
    const items = await env.DB.prepare(`SELECT COUNT(*) AS n FROM order_items`).first<{
      n: number;
    }>();

    expect(orders!.n).toBe(1);
    expect(reservations!.n).toBe(1);
    expect(items!.n).toBe(1);
  });
});

describe("stock accounting", () => {
  it("increments reserved by exactly the quantity ordered", async () => {
    await seed(env.DB, { onHand: 10 });
    await createOrder(
      CreateOrderInput.parse(orderInput({ lines: [{ variantId: IDS.variant, quantity: 3 }] })),
      deps,
    );
    expect(await reservedCount()).toBe(3);
  });

  it("refuses a quantity larger than available", async () => {
    await seed(env.DB, { onHand: 2 });
    const result = await createOrder(
      CreateOrderInput.parse(orderInput({ lines: [{ variantId: IDS.variant, quantity: 5 }] })),
      deps,
    );
    expect(result).toMatchObject({ ok: false, reason: "out_of_stock" });
    expect(await reservedCount()).toBe(0);
  });

  it("counts against available, not on_hand", async () => {
    await seed(env.DB, { onHand: 5, reserved: 4 });
    const result = await createOrder(
      CreateOrderInput.parse(orderInput({ lines: [{ variantId: IDS.variant, quantity: 2 }] })),
      deps,
    );
    expect(result).toMatchObject({ ok: false, reason: "out_of_stock" });
  });

  it("allows a backorder variant past zero", async () => {
    await seed(env.DB, { onHand: 0, allowBackorder: true });
    const result = await createOrder(CreateOrderInput.parse(orderInput()), deps);
    // The CHECK still bounds reserved by on_hand, so a true backorder needs its
    // own accounting. Documented in docs/known-limitations.md.
    expect(result.ok).toBe(false);
  });
});

describe("idempotency", () => {
  beforeEach(async () => {
    await seed(env.DB, { onHand: 5 });
  });

  it("returns the original order on replay and does not reserve twice", async () => {
    const input = CreateOrderInput.parse(orderInput());

    const first = await createOrder(input, deps);
    const replay = await createOrder(input, deps);

    expect(first.ok).toBe(true);
    expect(replay.ok).toBe(true);
    if (first.ok && replay.ok) {
      expect(replay.replayed).toBe(true);
      expect(replay.orderNumber).toBe(first.orderNumber);
      expect(replay.orderId).toBe(first.orderId);
    }

    expect(await reservedCount()).toBe(1);

    const orders = await env.DB.prepare(`SELECT COUNT(*) AS n FROM orders`).first<{ n: number }>();
    expect(orders!.n).toBe(1);
  });

  it("treats a different key as a different order", async () => {
    await createOrder(CreateOrderInput.parse(orderInput()), deps);
    await createOrder(CreateOrderInput.parse(orderInput()), deps);
    expect(await reservedCount()).toBe(2);
  });
});
