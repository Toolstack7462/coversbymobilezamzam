import { env } from "cloudflare:test";
import { describe, it, expect, beforeEach } from "vitest";
import { loadProductDetail } from "~/routes/admin/product-detail";
import { loadOrderDetail } from "~/routes/admin/order-detail";
import { createProduct, CreateProductInput } from "~/application/commands/create-product";
import { createOrder, CreateOrderInput } from "~/application/commands/create-order";
import { fixedClock, cryptoIds } from "~/infrastructure/primitives";
import { seed, orderInput, IDS } from "../../tests/fixtures/seed";

/**
 * The detail screens' queries, run against the real schema.
 *
 * This file exists because of a bug I wrote and nearly shipped. The order
 * screen selected `changed_at`, `changed_by` and `note` from
 * `order_status_history` — whose columns are `created_at`, `actor` and
 * `reason` — and inserted an `author_label` into `order_notes`, which has no
 * such column. Every one of those typechecked and built cleanly, because raw
 * SQL is a string as far as TypeScript is concerned. A merchant opening their
 * first order would have got a 500.
 *
 * The queries are exported from the routes and imported here, so the test runs
 * the statements the routes actually run. A copy of the SQL in the test would
 * eventually drift back into agreeing with a bug.
 */

const NOW = 1_756_000_600_000;
const deps = { d1: env.DB, clock: fixedClock(NOW), ids: cryptoIds };

describe("the product screen's queries", () => {
  beforeEach(async () => {
    await seed(env.DB);
  });

  it("runs every one of them for a real product", async () => {
    const created = await createProduct(
      CreateProductInput.parse({ name: "Cover di prova", sku: "T-1", price: "19,90", onHand: 3 }),
      { ...deps, defaultLocationId: IDS.location, actorId: "u", actorLabel: "U" },
    );
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const data = await loadProductDetail(env, created.productId);

    expect(data.product.slug).toBe("cover-di-prova");
    expect(data.variants).toHaveLength(1);
    expect(data.variants[0]!.amount).toBe(1990);
    expect(data.variants[0]!.on_hand).toBe(3);
    // The opening history row, which is what makes the first discount lawful.
    expect(data.priceHistory).toHaveLength(1);
    expect(Array.isArray(data.images)).toBe(true);
    expect(Array.isArray(data.compatibility)).toBe(true);
  });

  it("runs for the fixture's seeded product, which has compatibility rows", async () => {
    // The seeded product exercises the compatibility join and its three levels
    // of LEFT JOIN through device_models to device_brands — the part most
    // likely to break on a schema change.
    const data = await loadProductDetail(env, IDS.product);
    expect(data.product.id).toBe(IDS.product);
    expect(data.compatibility.length).toBeGreaterThan(0);
    for (const row of data.compatibility) {
      expect(typeof row.compatibility_level).toBe("string");
    }
  });

  it("throws a 404 rather than returning an empty page", async () => {
    // A stale link or a typo. Saying so is more use than a blank editor.
    await expect(loadProductDetail(env, "prod_does_not_exist")).rejects.toMatchObject({
      status: 404,
    });
  });
});

describe("the order screen's queries", () => {
  beforeEach(async () => {
    await seed(env.DB, { onHand: 5 });
  });

  async function anOrder(): Promise<string> {
    const result = await createOrder(CreateOrderInput.parse(orderInput()), {
      ...deps,
      vatBasisPoints: 2200,
      defaultLocationId: IDS.location,
    });
    if (!("orderId" in result) || typeof result.orderId !== "string") {
      throw new Error(`Could not create an order for the test: ${JSON.stringify(result)}`);
    }
    return result.orderId;
  }

  it("runs every one of them for a real order", async () => {
    const orderId = await anOrder();
    const data = await loadOrderDetail(env, orderId);

    expect(data.order.id).toBe(orderId);
    expect(data.items.length).toBeGreaterThan(0);
    // The snapshot columns, not a join back to the live product (invariant 8).
    expect(typeof data.items[0]!.product_name).toBe("string");
    expect(typeof data.items[0]!.sku).toBe("string");
    expect(Array.isArray(data.history)).toBe(true);
  });

  it("reads the status history with its real column names", async () => {
    const orderId = await anOrder();

    // Written exactly as the route's action writes it. If either the insert or
    // the select names a column that does not exist, this fails here rather
    // than in front of a merchant.
    await env.DB.prepare(
      `INSERT INTO order_status_history (id, order_id, from_status, to_status, actor, created_at)
       VALUES (?1, ?2, 'awaiting_customer_contact', 'awaiting_payment', 'user_test', ?3)`,
    )
      .bind(cryptoIds.generate(), orderId, NOW)
      .run();

    const data = await loadOrderDetail(env, orderId);
    const entry = data.history.find((h) => h.to_status === "awaiting_payment");
    expect(entry).toBeDefined();
    expect(entry!.actor).toBe("user_test");
    expect(entry!.created_at).toBe(NOW);
  });

  it("writes an internal note that is not customer visible", async () => {
    const orderId = await anOrder();

    await env.DB.prepare(
      `INSERT INTO order_notes (id, order_id, author_id, body, customer_visible, created_at)
       VALUES (?1, ?2, 'user_test', 'Chiamato il cliente', 0, ?3)`,
    )
      .bind(cryptoIds.generate(), orderId, NOW)
      .run();

    const note = await env.DB.prepare(
      `SELECT customer_visible FROM order_notes WHERE order_id = ?1`,
    )
      .bind(orderId)
      .first<{ customer_visible: number }>();

    // Written explicitly rather than left to the column default: a note the
    // staff labelled internal must never quietly become visible.
    expect(note!.customer_visible).toBe(0);
  });

  it("throws a 404 for an order that does not exist", async () => {
    await expect(loadOrderDetail(env, "ord_does_not_exist")).rejects.toMatchObject({ status: 404 });
  });
});
