import { env } from "cloudflare:test";
import { describe, it, expect, beforeEach } from "vitest";
import { createOrder, CreateOrderInput } from "~/application/commands/create-order";
import { expireReservations } from "~/application/commands/expire-reservations";
import { fixedClock, cryptoIds } from "~/infrastructure/primitives";
import { seed, orderInput, IDS } from "../fixtures/seed";

/**
 * The race this system exists to survive: a customer pays at minute 119, staff
 * verify at minute 121, and the sweeper is running at the same moment.
 *
 * The outcome must be consistent either way — the order is paid and its stock
 * stays reserved, OR it expired and the stock came back. Never both.
 */

const T0 = 1_756_000_100_000;
const MINUTE = 60 * 1000;

const depsAt = (now: number) => ({
  d1: env.DB,
  clock: fixedClock(now),
  ids: cryptoIds,
  vatBasisPoints: 2200,
  defaultLocationId: IDS.location,
});

async function reserved(): Promise<number> {
  const row = await env.DB.prepare(`SELECT reserved FROM inventory_levels WHERE variant_id = ?1`)
    .bind(IDS.variant)
    .first<{ reserved: number }>();
  return row!.reserved;
}

async function statuses(orderId: string) {
  const row = await env.DB.prepare(
    `SELECT o.status AS order_status, op.status AS payment_status,
            (SELECT status FROM stock_reservations WHERE order_id = o.id LIMIT 1) AS reservation_status
       FROM orders o LEFT JOIN order_payments op ON op.order_id = o.id
      WHERE o.id = ?1`,
  )
    .bind(orderId)
    .first<{ order_status: string; payment_status: string; reservation_status: string }>();
  return row!;
}

async function verifyPayment(orderId: string, now: number): Promise<void> {
  // Stands in for the verification use case: what matters to this test is that
  // payment reaches `verified` before the sweeper re-checks it.
  await env.DB.batch([
    env.DB.prepare(
      `UPDATE order_payments SET status = 'verified', verified_at = ?1, verified_by = 'staff_1', updated_at = ?1
        WHERE order_id = ?2`,
    ).bind(now, orderId),
    env.DB.prepare(`UPDATE orders SET status = 'paid', updated_at = ?1 WHERE id = ?2`).bind(
      now,
      orderId,
    ),
  ]);
}

describe("reservation expiry", () => {
  beforeEach(async () => {
    await seed(env.DB, { onHand: 5 });
  });

  it("releases stock for an unpaid order past its window", async () => {
    const order = await createOrder(CreateOrderInput.parse(orderInput()), depsAt(T0));
    expect(order.ok).toBe(true);
    if (!order.ok) return;

    expect(await reserved()).toBe(1);

    // The seeded method holds for 1440 minutes.
    const result = await expireReservations(depsAt(T0 + 1441 * MINUTE));

    expect(result.released).toBe(1);
    expect(await reserved()).toBe(0);

    const after = await statuses(order.orderId);
    expect(after.order_status).toBe("expired");
    expect(after.reservation_status).toBe("expired");
  });

  it("does NOT release stock for an order that is still within its window", async () => {
    const order = await createOrder(CreateOrderInput.parse(orderInput()), depsAt(T0));
    if (!order.ok) return;

    const result = await expireReservations(depsAt(T0 + 60 * MINUTE));

    expect(result.examined).toBe(0);
    expect(result.released).toBe(0);
    expect(await reserved()).toBe(1);
  });

  it("does NOT release stock for an order paid just before the sweep", async () => {
    // The race. Payment is verified at minute 1440; the sweeper runs at 1441
    // and must notice.
    const order = await createOrder(CreateOrderInput.parse(orderInput()), depsAt(T0));
    if (!order.ok) return;

    await verifyPayment(order.orderId, T0 + 1440 * MINUTE);

    const result = await expireReservations(depsAt(T0 + 1441 * MINUTE));

    expect(result.skippedPaid).toBe(1);
    expect(result.released).toBe(0);

    // Stock stays held for the paid order.
    expect(await reserved()).toBe(1);

    const after = await statuses(order.orderId);
    expect(after.order_status).toBe("paid");
    expect(after.payment_status).toBe("verified");
    // The reservation was claimed and then handed back, so it is active again.
    expect(after.reservation_status).toBe("active");
  });

  it("is idempotent: a second sweep releases nothing further", async () => {
    const order = await createOrder(CreateOrderInput.parse(orderInput()), depsAt(T0));
    if (!order.ok) return;

    const first = await expireReservations(depsAt(T0 + 1441 * MINUTE));
    const second = await expireReservations(depsAt(T0 + 1442 * MINUTE));

    expect(first.released).toBe(1);
    expect(second.released).toBe(0);
    expect(second.examined).toBe(0);

    // Crucially, reserved did not go negative from a double release.
    expect(await reserved()).toBe(0);
  });

  it("survives two sweeps running at the same instant", async () => {
    // Cloudflare cron is at-least-once, so overlapping runs are expected. The
    // conditional claim is what stops both from releasing the same hold.
    const order = await createOrder(CreateOrderInput.parse(orderInput()), depsAt(T0));
    if (!order.ok) return;

    const [a, b] = await Promise.all([
      expireReservations(depsAt(T0 + 1441 * MINUTE)),
      expireReservations(depsAt(T0 + 1441 * MINUTE)),
    ]);

    expect(a.released + b.released).toBe(1);
    expect(await reserved()).toBe(0);
  });

  it("records every run, so a stopped sweeper is visible", async () => {
    await expireReservations(depsAt(T0 + 1441 * MINUTE));

    const run = await env.DB.prepare(
      `SELECT job_name, status FROM scheduled_job_runs ORDER BY started_at DESC LIMIT 1`,
    ).first<{ job_name: string; status: string }>();

    expect(run!.job_name).toBe("expire_reservations");
    expect(run!.status).toBe("completed");
  });

  it("returns released stock to the pool for the next customer", async () => {
    await seed(env.DB, { onHand: 1 });

    const first = await createOrder(CreateOrderInput.parse(orderInput()), depsAt(T0));
    expect(first.ok).toBe(true);

    // While held, nobody else can buy it.
    const blocked = await createOrder(CreateOrderInput.parse(orderInput()), depsAt(T0));
    expect(blocked).toMatchObject({ ok: false, reason: "out_of_stock" });

    await expireReservations(depsAt(T0 + 1441 * MINUTE));

    const afterExpiry = await createOrder(
      CreateOrderInput.parse(orderInput()),
      depsAt(T0 + 1442 * MINUTE),
    );
    expect(afterExpiry.ok).toBe(true);
  });
});
