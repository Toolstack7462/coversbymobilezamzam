import { env } from "cloudflare:test";
import { describe, it, expect, beforeEach } from "vitest";
import { createOrder, CreateOrderInput } from "~/application/commands/create-order";
import { verifyPayment, VerifyPaymentInput } from "~/application/commands/verify-payment";
import { fixedClock, cryptoIds } from "~/infrastructure/primitives";
import { seed, orderInput, IDS } from "../fixtures/seed";
import { seedStaff, grantTestStepUp, paymentFor } from "../fixtures/staff";

/**
 * Invariant 6 — the most important rule in this system.
 *
 * **Only an authorised human may mark an order paid**, after checking the real
 * bank account or merchant app. These tests exist so that a future change which
 * makes verification "more convenient" fails loudly.
 */

const NOW = 1_756_000_100_000;

const orderDeps = {
  d1: env.DB,
  clock: fixedClock(NOW),
  ids: cryptoIds,
  vatBasisPoints: 2200,
  defaultLocationId: IDS.location,
};

async function placeOrder() {
  const result = await createOrder(CreateOrderInput.parse(orderInput()), orderDeps);
  if (!result.ok) throw new Error(`expected the order to succeed: ${result.reason}`);
  const payment = await paymentFor(env.DB, result.orderId);
  return { ...result, paymentId: payment!.id };
}

describe("only a human may verify a payment", () => {
  beforeEach(async () => {
    await seed(env.DB, { onHand: 5, price: 3990 });
  });

  it("refuses a user WITHOUT payment.verify", async () => {
    const order = await placeOrder();
    // An order manager: can do almost everything with orders, but not this.
    const actor = await seedStaff(env.DB, {
      permissions: ["order.read", "order.write", "payment.read"],
    });
    await grantTestStepUp(env.DB, actor.userId, "payment.verify", NOW);

    const result = await verifyPayment(
      VerifyPaymentInput.parse({
        orderPaymentId: order.paymentId,
        outcome: "verified",
        amountReceived: 3990,
        transactionReference: "TRN-1",
      }),
      { env, clock: fixedClock(NOW), ids: cryptoIds, actor },
    );

    expect(result.ok).toBe(false);

    const payment = await paymentFor(env.DB, order.orderId);
    expect(payment!.status).not.toBe("verified");
    expect(payment!.verified_by).toBeNull();
  });

  it("refuses a user WITH the permission but WITHOUT step-up", async () => {
    // A live session is not enough. A borrowed laptop or a stolen cookie does
    // the most damage precisely here.
    const order = await placeOrder();
    const actor = await seedStaff(env.DB, { permissions: ["payment.read", "payment.verify"] });

    const result = await verifyPayment(
      VerifyPaymentInput.parse({
        orderPaymentId: order.paymentId,
        outcome: "verified",
        amountReceived: 3990,
        transactionReference: "TRN-2",
      }),
      { env, clock: fixedClock(NOW), ids: cryptoIds, actor },
    );

    expect(result).toMatchObject({ ok: false, reason: "step_up_required" });

    const payment = await paymentFor(env.DB, order.orderId);
    expect(payment!.status).not.toBe("verified");
  });

  it("succeeds with the permission AND a valid step-up", async () => {
    const order = await placeOrder();
    const actor = await seedStaff(env.DB, { permissions: ["payment.read", "payment.verify"] });
    await grantTestStepUp(env.DB, actor.userId, "payment.verify", NOW);

    const result = await verifyPayment(
      VerifyPaymentInput.parse({
        orderPaymentId: order.paymentId,
        outcome: "verified",
        amountReceived: 3990,
        transactionReference: "TRN-3",
      }),
      { env, clock: fixedClock(NOW), ids: cryptoIds, actor },
    );

    expect(result.ok).toBe(true);

    const payment = await paymentFor(env.DB, order.orderId);
    expect(payment!.status).toBe("verified");
    expect(payment!.amount_received).toBe(3990);
    expect(payment!.verified_by).toBe(actor.userId);
    expect(payment!.verified_at).toBe(NOW);
  });

  it("CONSUMES the step-up, so it cannot verify a second payment", async () => {
    const first = await placeOrder();
    const second = await placeOrder();
    const actor = await seedStaff(env.DB, { permissions: ["payment.read", "payment.verify"] });
    await grantTestStepUp(env.DB, actor.userId, "payment.verify", NOW);

    const deps = { env, clock: fixedClock(NOW), ids: cryptoIds, actor };

    const a = await verifyPayment(
      VerifyPaymentInput.parse({
        orderPaymentId: first.paymentId,
        outcome: "verified",
        amountReceived: 3990,
        transactionReference: "TRN-A",
      }),
      deps,
    );
    const b = await verifyPayment(
      VerifyPaymentInput.parse({
        orderPaymentId: second.paymentId,
        outcome: "verified",
        amountReceived: 3990,
        transactionReference: "TRN-B",
      }),
      deps,
    );

    expect(a.ok).toBe(true);
    expect(b).toMatchObject({ ok: false, reason: "step_up_required" });
  });
});

describe("a proof is not evidence", () => {
  beforeEach(async () => {
    await seed(env.DB, { onHand: 5 });
  });

  it("uploading a payment proof does NOT change payment status", async () => {
    // A screenshot is an image. It is trivially edited and says nothing about
    // settlement.
    const order = await placeOrder();
    const before = await paymentFor(env.DB, order.orderId);

    await env.DB.prepare(
      `INSERT INTO payment_proofs (id, order_payment_id, object_key, mime_type, file_size, uploaded_at)
       VALUES (?1,?2,'private/random-key.jpg','image/jpeg',12345,?3)`,
    )
      .bind(cryptoIds.generate(), order.paymentId, NOW)
      .run();

    const after = await paymentFor(env.DB, order.orderId);
    expect(after!.status).toBe(before!.status);
    expect(after!.verified_by).toBeNull();
  });
});

describe("amounts and references", () => {
  beforeEach(async () => {
    await seed(env.DB, { onHand: 5, price: 3990 });
  });

  async function verifierWithStepUp() {
    const actor = await seedStaff(env.DB, { permissions: ["payment.read", "payment.verify"] });
    await grantTestStepUp(env.DB, actor.userId, "payment.verify", NOW);
    return actor;
  }

  it("refuses `verified` when the amount does not match", async () => {
    // Staff must choose partially_paid or overpaid deliberately rather than
    // have the system quietly decide.
    const order = await placeOrder();
    const actor = await verifierWithStepUp();

    const result = await verifyPayment(
      VerifyPaymentInput.parse({
        orderPaymentId: order.paymentId,
        outcome: "verified",
        amountReceived: 3000,
        transactionReference: "TRN-SHORT",
      }),
      { env, clock: fixedClock(NOW), ids: cryptoIds, actor },
    );

    expect(result).toMatchObject({ ok: false, reason: "amount_mismatch" });
    const payment = await paymentFor(env.DB, order.orderId);
    expect(payment!.status).not.toBe("verified");
  });

  it("allows a deliberate partial payment", async () => {
    const order = await placeOrder();
    const actor = await verifierWithStepUp();

    const result = await verifyPayment(
      VerifyPaymentInput.parse({
        orderPaymentId: order.paymentId,
        outcome: "partially_paid",
        amountReceived: 3000,
        transactionReference: "TRN-PARTIAL",
      }),
      { env, clock: fixedClock(NOW), ids: cryptoIds, actor },
    );

    expect(result.ok).toBe(true);
    const payment = await paymentFor(env.DB, order.orderId);
    expect(payment!.status).toBe("partially_paid");
  });

  it("requires a reference OR an explicit note", () => {
    expect(() =>
      VerifyPaymentInput.parse({
        orderPaymentId: "x",
        outcome: "verified",
        amountReceived: 3990,
      }),
    ).toThrow();

    // A note explaining the absence is acceptable.
    expect(() =>
      VerifyPaymentInput.parse({
        orderPaymentId: "x",
        outcome: "verified",
        amountReceived: 3990,
        note: "Contanti in negozio, nessun riferimento bancario",
      }),
    ).not.toThrow();
  });

  it("FLAGS a duplicate reference rather than rejecting it", async () => {
    // Duplicates are frequently legitimate - one transfer covering two orders.
    // Auto-rejecting would block real payments.
    const first = await placeOrder();
    const second = await placeOrder();

    const actorA = await verifierWithStepUp();
    await verifyPayment(
      VerifyPaymentInput.parse({
        orderPaymentId: first.paymentId,
        outcome: "verified",
        amountReceived: 3990,
        transactionReference: "SHARED-REF",
      }),
      { env, clock: fixedClock(NOW), ids: cryptoIds, actor: actorA },
    );

    const actorB = await seedStaff(env.DB, {
      userId: "user_second",
      permissions: ["payment.read", "payment.verify"],
    });
    await grantTestStepUp(env.DB, actorB.userId, "payment.verify", NOW);

    const result = await verifyPayment(
      VerifyPaymentInput.parse({
        orderPaymentId: second.paymentId,
        outcome: "verified",
        amountReceived: 3990,
        transactionReference: "SHARED-REF",
      }),
      { env, clock: fixedClock(NOW), ids: cryptoIds, actor: actorB },
    );

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.duplicateReference).toBe(true);
  });
});

describe("verification is audited (invariant 8)", () => {
  beforeEach(async () => {
    await seed(env.DB, { onHand: 5 });
  });

  it("writes an audit row, payment history and an order event", async () => {
    const order = await placeOrder();
    const actor = await seedStaff(env.DB, { permissions: ["payment.read", "payment.verify"] });
    await grantTestStepUp(env.DB, actor.userId, "payment.verify", NOW);

    await verifyPayment(
      VerifyPaymentInput.parse({
        orderPaymentId: order.paymentId,
        outcome: "verified",
        amountReceived: 3990,
        transactionReference: "TRN-AUDIT",
      }),
      { env, clock: fixedClock(NOW), ids: cryptoIds, actor },
    );

    const audit = await env.DB.prepare(
      `SELECT actor_id, action, after_value FROM audit_logs WHERE action = 'payment.verify'`,
    ).first<{ actor_id: string; action: string; after_value: string }>();

    expect(audit).not.toBeNull();
    expect(audit!.actor_id).toBe(actor.userId);
    // The reference is recorded; an IBAN never is.
    expect(audit!.after_value).toContain("TRN-AUDIT");
    expect(audit!.after_value).not.toMatch(/IT\d{2}[A-Z]/);

    const history = await env.DB.prepare(
      `SELECT COUNT(*) AS n FROM payment_status_history WHERE order_payment_id = ?1`,
    )
      .bind(order.paymentId)
      .first<{ n: number }>();
    expect(history!.n).toBeGreaterThan(0);

    const event = await env.DB.prepare(
      `SELECT COUNT(*) AS n FROM order_events WHERE order_id = ?1 AND event_type = 'payment_verified'`,
    )
      .bind(order.orderId)
      .first<{ n: number }>();
    expect(event!.n).toBe(1);
  });

  it("moves the order to paid and consumes the stock hold", async () => {
    const order = await placeOrder();
    const actor = await seedStaff(env.DB, { permissions: ["payment.read", "payment.verify"] });
    await grantTestStepUp(env.DB, actor.userId, "payment.verify", NOW);

    const before = await env.DB.prepare(
      `SELECT on_hand, reserved FROM inventory_levels WHERE variant_id = ?1`,
    )
      .bind(IDS.variant)
      .first<{ on_hand: number; reserved: number }>();
    expect(before!.reserved).toBe(1);

    await verifyPayment(
      VerifyPaymentInput.parse({
        orderPaymentId: order.paymentId,
        outcome: "verified",
        amountReceived: 3990,
        transactionReference: "TRN-STOCK",
      }),
      { env, clock: fixedClock(NOW), ids: cryptoIds, actor },
    );

    // Paying CONSUMES the hold: the unit leaves on_hand rather than returning
    // to the shelf.
    const after = await env.DB.prepare(
      `SELECT on_hand, reserved FROM inventory_levels WHERE variant_id = ?1`,
    )
      .bind(IDS.variant)
      .first<{ on_hand: number; reserved: number }>();

    expect(after!.on_hand).toBe(before!.on_hand - 1);
    expect(after!.reserved).toBe(0);

    const orderRow = await env.DB.prepare(`SELECT status FROM orders WHERE id = ?1`)
      .bind(order.orderId)
      .first<{ status: string }>();
    expect(orderRow!.status).toBe("paid");
  });
});
