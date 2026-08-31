import { env } from "cloudflare:test";
import { describe, it, expect, beforeEach } from "vitest";
import { createOrder, CreateOrderInput } from "~/application/commands/create-order";
import { fixedClock, cryptoIds } from "~/infrastructure/primitives";
import { seed, orderInput, IDS } from "../../tests/fixtures/seed";

/**
 * The customers view, against real SQLite.
 *
 * There is no customers table: the shop sells to guests, so a "customer" is a
 * history of orders sharing an email. That makes this screen a GROUP BY, and
 * the grouping is the part that can be quietly wrong — an email differing only
 * in case would split one person into two rows, and counting cancelled orders
 * as spend would overstate every customer who abandoned a basket.
 */

const NOW = 1_756_001_000_000;

/** The same grouping the route runs. */
async function customers(): Promise<
  { email: string; order_count: number; total_spent: number; verified_spent: number }[]
> {
  const { results } = await env.DB.prepare(
    `SELECT LOWER(o.customer_email) AS email,
            COUNT(*) AS order_count,
            COALESCE(SUM(CASE WHEN o.status NOT IN ('cancelled','expired')
                              THEN o.grand_total ELSE 0 END), 0) AS total_spent,
            COALESCE((SELECT SUM(p.amount_received) FROM order_payments p
                        JOIN orders o2 ON o2.id = p.order_id
                       WHERE LOWER(o2.customer_email) = LOWER(o.customer_email)
                         AND p.status = 'verified'), 0) AS verified_spent
       FROM orders o
      WHERE o.status NOT IN ('draft')
      GROUP BY LOWER(o.customer_email)`,
  ).all<{
    email: string;
    order_count: number;
    total_spent: number;
    verified_spent: number;
  }>();
  return results;
}

async function placeOrder(email: string, quantity = 1): Promise<string> {
  const result = await createOrder(
    CreateOrderInput.parse(
      orderInput({ customerEmail: email, lines: [{ variantId: IDS.variant, quantity }] }),
    ),
    {
      d1: env.DB,
      clock: fixedClock(NOW),
      ids: cryptoIds,
      vatBasisPoints: 2200,
      defaultLocationId: IDS.location,
    },
  );
  if (!("orderId" in result) || typeof result.orderId !== "string") {
    throw new Error(`Could not place an order: ${JSON.stringify(result)}`);
  }
  return result.orderId;
}

describe("grouping orders into customers", () => {
  beforeEach(async () => {
    await seed(env.DB, { onHand: 50 });
  });

  it("counts one customer per email", async () => {
    await placeOrder("mario@example.invalid");
    await placeOrder("mario@example.invalid");
    await placeOrder("lucia@example.invalid");

    const rows = await customers();
    expect(rows).toHaveLength(2);
    expect(rows.find((r) => r.email === "mario@example.invalid")!.order_count).toBe(2);
  });

  it("treats differently-cased addresses as one person", async () => {
    // Someone typing their address on a phone gets the capitalisation the
    // keyboard chose. Two rows for one buyer would be visibly wrong to the
    // shopkeeper, who knows perfectly well it is the same Mario.
    await placeOrder("mario@example.invalid");
    await placeOrder("Mario@Example.Invalid");

    const rows = await customers();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.order_count).toBe(2);
  });

  it("excludes cancelled and expired orders from the total ordered", async () => {
    const keep = await placeOrder("carla@example.invalid", 2);
    const drop = await placeOrder("carla@example.invalid", 3);

    const kept = await env.DB.prepare(`SELECT grand_total FROM orders WHERE id = ?1`)
      .bind(keep)
      .first<{ grand_total: number }>();

    await env.DB.prepare(`UPDATE orders SET status = 'cancelled' WHERE id = ?1`).bind(drop).run();

    const row = (await customers()).find((r) => r.email === "carla@example.invalid")!;
    // Still two orders — the cancellation happened, and hiding it would make
    // the count disagree with the order list. But not two orders' worth of
    // money.
    expect(row.order_count).toBe(2);
    expect(row.total_spent).toBe(kept!.grand_total);
  });

  it("reports nothing as collected until a payment is verified", async () => {
    await placeOrder("nuovo@example.invalid");

    const row = (await customers()).find((r) => r.email === "nuovo@example.invalid")!;
    expect(row.total_spent).toBeGreaterThan(0);
    // Ordered is not paid. Reporting the first figure as revenue would count
    // every abandoned order as money in the till.
    expect(row.verified_spent).toBe(0);
  });

  it("counts money only once a human has verified it", async () => {
    const orderId = await placeOrder("pagante@example.invalid");

    await env.DB.prepare(
      `UPDATE order_payments SET status = 'verified', amount_received = 1234, verified_at = ?1
        WHERE order_id = ?2`,
    )
      .bind(NOW, orderId)
      .run();

    const row = (await customers()).find((r) => r.email === "pagante@example.invalid")!;
    expect(row.verified_spent).toBe(1234);
  });

  it("leaves drafts out entirely", async () => {
    const orderId = await placeOrder("bozza@example.invalid");
    await env.DB.prepare(`UPDATE orders SET status = 'draft' WHERE id = ?1`).bind(orderId).run();

    // A draft is an abandoned basket, not a customer.
    expect((await customers()).find((r) => r.email === "bozza@example.invalid")).toBeUndefined();
  });

  it("returns nothing when the shop has no orders", async () => {
    expect(await customers()).toEqual([]);
  });
});

describe("the returning-customer view", () => {
  beforeEach(async () => {
    await seed(env.DB, { onHand: 50 });
  });

  it("counts only those who ordered more than once", async () => {
    await placeOrder("una-volta@example.invalid");
    await placeOrder("due-volte@example.invalid");
    await placeOrder("due-volte@example.invalid");

    const row = await env.DB.prepare(
      `SELECT COUNT(*) AS n FROM (
         SELECT 1 FROM orders o WHERE o.status NOT IN ('draft')
          GROUP BY LOWER(o.customer_email) HAVING COUNT(*) > 1)`,
    ).first<{ n: number }>();

    expect(row!.n).toBe(1);
  });
});
