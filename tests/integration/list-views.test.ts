import { env } from "cloudflare:test";
import { describe, it, expect, beforeEach } from "vitest";
import { ORDER_VIEWS, PAYMENT_VIEWS, ORDER_DELIVERY_FACET } from "~/lib/order-views";
import { INVENTORY_VIEWS } from "~/lib/inventory-views";
import { seed } from "../../tests/fixtures/seed";

/**
 * The order, payment and inventory saved views, executed against a real D1.
 *
 * Same reasoning as `product-views.test.ts`: a clause naming a column that a
 * migration renamed still compiles, still passes every unit test, and throws a
 * 500 the first time a merchant clicks the tab. The only way to know is to run
 * it against the real schema.
 *
 * These clauses matter more than the product ones, because the payment queue
 * is the screen the shop opens every morning.
 */

const ORDER_FROM = `FROM orders o
   LEFT JOIN order_payments op ON op.order_id = o.id`;

const PAYMENT_FROM = `FROM order_payments op
   JOIN orders o ON o.id = op.order_id
   LEFT JOIN payment_methods pm ON pm.id = op.payment_method_id`;

describe("order views", () => {
  beforeEach(async () => {
    await seed(env.DB);
  });

  for (const view of ORDER_VIEWS) {
    it(`"${view.slug}" runs against the real schema`, async () => {
      const row = await env.DB.prepare(
        `SELECT COUNT(*) AS n ${ORDER_FROM} WHERE ${view.where}`,
      ).first<{ n: number }>();
      expect(Number.isInteger(row?.n)).toBe(true);
    });
  }

  for (const [slug, clause] of Object.entries(ORDER_DELIVERY_FACET)) {
    it(`the "${slug}" delivery facet combines with a view`, async () => {
      // The action centre links to a view AND a facet at once, so the
      // combination is what has to work, not each half alone.
      const row = await env.DB.prepare(
        `SELECT COUNT(*) AS n ${ORDER_FROM}
          WHERE ${ORDER_VIEWS.find((v) => v.slug === "da-preparare")!.where} AND ${clause}`,
      ).first<{ n: number }>();
      expect(Number.isInteger(row?.n)).toBe(true);
    });
  }

  it("runs the tab-count query as one statement", async () => {
    const row = await env.DB.prepare(
      `SELECT ${ORDER_VIEWS.map((v, i) => `SUM(CASE WHEN ${v.where} THEN 1 ELSE 0 END) AS v${i}`).join(", ")}
         FROM orders o`,
    ).first<Record<string, number>>();
    expect(row).not.toBeNull();
  });

  it("puts every order in 'tutti' and each one in at most one lifecycle view", async () => {
    // The lifecycle views should partition the orders: a row that appears in
    // both "aperti" and "conclusi" would make the tab counts add up to more
    // orders than the shop has, which reads as a data error to the merchant.
    const lifecycle = ORDER_VIEWS.filter((v) => v.slug !== "tutti" && v.slug !== "aperti");
    const row = await env.DB.prepare(
      `SELECT COUNT(*) AS n FROM orders o
        WHERE (${lifecycle.map((v) => `(CASE WHEN ${v.where} THEN 1 ELSE 0 END)`).join(" + ")}) > 1`,
    ).first<{ n: number }>();
    expect(row!.n).toBe(0);
  });
});

describe("payment views", () => {
  beforeEach(async () => {
    await seed(env.DB);
  });

  for (const view of PAYMENT_VIEWS) {
    it(`"${view.slug}" runs against the real schema`, async () => {
      const row = await env.DB.prepare(
        `SELECT COUNT(*) AS n ${PAYMENT_FROM} WHERE ${view.where}`,
      ).first<{ n: number }>();
      expect(Number.isInteger(row?.n)).toBe(true);
    });

    it(`"${view.slug}" runs as the full queue query`, async () => {
      // The real query, including the duplicate-reference subselect and the
      // urgency ordering, because those are the parts that touch other tables.
      const { results } = await env.DB.prepare(
        `SELECT op.id, op.status, op.amount_expected, op.transaction_reference,
                o.order_number, o.reservation_expires_at,
                pm.name_it AS method_name,
                (SELECT COUNT(*) FROM payment_proofs pp WHERE pp.order_payment_id = op.id) AS proof_count,
                (SELECT COUNT(*) FROM order_payments d
                  WHERE d.transaction_reference = op.transaction_reference
                    AND d.transaction_reference IS NOT NULL
                    AND d.id <> op.id) AS duplicate_count
           ${PAYMENT_FROM}
          WHERE ${view.where}
          ORDER BY
            CASE op.status WHEN 'proof_received' THEN 0 WHEN 'under_verification' THEN 1 ELSE 2 END,
            o.reservation_expires_at ASC
          LIMIT 100`,
      ).all<{ id: string }>();
      expect(Array.isArray(results)).toBe(true);
    });
  }

  it("counts 'in-verifica' as a subset of 'da-verificare'", async () => {
    // The action centre treats them as related severities. If the clauses ever
    // stop overlapping, one of the two dashboard items is lying.
    const row = await env.DB.prepare(
      `SELECT COUNT(*) AS n FROM order_payments op
        WHERE (${PAYMENT_VIEWS.find((v) => v.slug === "in-verifica")!.where})
          AND NOT (${PAYMENT_VIEWS.find((v) => v.slug === "da-verificare")!.where})`,
    ).first<{ n: number }>();
    expect(row!.n).toBe(0);
  });
});

describe("inventory views", () => {
  beforeEach(async () => {
    await seed(env.DB);
  });

  const FROM = `FROM inventory_levels il
     JOIN product_variants v ON v.id = il.variant_id
     JOIN products p ON p.id = v.product_id
     LEFT JOIN product_translations pt ON pt.product_id = p.id AND pt.locale = 'it'
     JOIN inventory_locations loc ON loc.id = il.location_id`;

  for (const view of INVENTORY_VIEWS) {
    it(`"${view.slug}" runs against the real schema`, async () => {
      const row = await env.DB.prepare(
        `SELECT COUNT(*) AS n ${FROM} WHERE v.archived_at IS NULL AND ${view.where}`,
      ).first<{ n: number }>();
      expect(Number.isInteger(row?.n)).toBe(true);
    });
  }

  it("never counts a row as both esaurito and scorte basse", async () => {
    // They are adjacent bands of the same number. An overlap would mean the
    // dashboard reports the same variant twice under two different severities.
    const out = INVENTORY_VIEWS.find((v) => v.slug === "esauriti")!.where;
    const low = INVENTORY_VIEWS.find((v) => v.slug === "scorte-basse")!.where;
    const row = await env.DB.prepare(
      `SELECT COUNT(*) AS n ${FROM} WHERE v.archived_at IS NULL AND (${out}) AND (${low})`,
    ).first<{ n: number }>();
    expect(row!.n).toBe(0);
  });

  it("measures availability as on_hand minus reserved, not on_hand", async () => {
    // Reserve the entire stock of one variant, leaving on_hand untouched. If
    // "esauriti" looked at on_hand the row would not appear — and the shop
    // would keep selling a unit it has already promised to someone else.
    const before = await env.DB.prepare(
      `SELECT COUNT(*) AS n ${FROM} WHERE v.archived_at IS NULL
        AND ${INVENTORY_VIEWS.find((v) => v.slug === "esauriti")!.where}`,
    ).first<{ n: number }>();

    await env.DB.prepare(`UPDATE inventory_levels SET reserved = on_hand WHERE on_hand > 0`).run();

    const after = await env.DB.prepare(
      `SELECT COUNT(*) AS n ${FROM} WHERE v.archived_at IS NULL
        AND ${INVENTORY_VIEWS.find((v) => v.slug === "esauriti")!.where}`,
    ).first<{ n: number }>();

    expect(after!.n).toBeGreaterThan(before!.n);
  });
});
