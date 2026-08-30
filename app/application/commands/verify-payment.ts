import { z } from "zod";
import { money, type Money } from "~/domain/pricing/money";
import { assertTransition, isPaymentStatus, type PaymentStatus } from "~/domain/payments/status";
import { assertTransition as assertOrderTransition, isOrderStatus } from "~/domain/orders/status";
import type { Clock, IdGenerator } from "~/application/ports";
import type { StaffActor } from "~/infrastructure/auth/session.server";
import { consumeStepUp } from "~/infrastructure/auth/session.server";

/**
 * Payment verification — invariant 6.
 *
 * **This is the only path to `verified`.** Not a proof upload, not an amount
 * match, not a WhatsApp click, not a customer saying so. A screenshot is an
 * image; it is trivially edited and says nothing about settlement.
 *
 * Reaching it requires ALL of:
 *   - an authenticated staff user holding `payment.verify`
 *   - a valid, unconsumed step-up authentication
 *   - an amount actually received
 *   - a transaction reference, OR an explicit written reason for its absence
 *
 * The caller has already checked the first. This function checks the rest, and
 * refuses if any is missing.
 */

export const VerifyPaymentInput = z
  .object({
    orderPaymentId: z.string().min(1),
    /** The status staff are moving to. Only human-verifiable outcomes. */
    outcome: z.enum(["verified", "partially_paid", "overpaid", "rejected"]),
    /** What staff actually SAW in the account, in minor units. */
    amountReceived: z.number().int().min(0).optional(),
    transactionReference: z.string().trim().max(200).optional(),
    /** Required when no reference can be given. */
    note: z.string().trim().max(1000).optional(),
  })
  .refine(
    (input) =>
      input.outcome === "rejected" ||
      input.transactionReference !== undefined ||
      (input.note !== undefined && input.note.length > 0),
    {
      message:
        "A transaction reference is required, or an explicit note explaining why there is none.",
      path: ["transactionReference"],
    },
  )
  .refine((input) => input.outcome === "rejected" || input.amountReceived !== undefined, {
    message: "Record the amount actually received.",
    path: ["amountReceived"],
  });

export type VerifyPaymentInput = z.infer<typeof VerifyPaymentInput>;

export type VerifyPaymentResult =
  | { ok: true; from: PaymentStatus; to: PaymentStatus; duplicateReference: boolean }
  | { ok: false; reason: "not_found" }
  | { ok: false; reason: "invalid_transition"; from: PaymentStatus }
  | { ok: false; reason: "step_up_required" }
  | { ok: false; reason: "amount_mismatch"; expected: Money; received: Money };

export interface VerifyPaymentDeps {
  env: Env;
  clock: Clock;
  ids: IdGenerator;
  actor: StaffActor;
}

export async function verifyPayment(
  input: VerifyPaymentInput,
  deps: VerifyPaymentDeps,
): Promise<VerifyPaymentResult> {
  const { env, clock, ids, actor } = deps;
  const now = clock.now();

  // Belt and braces: the route checks this too, but a use case that trusts its
  // caller is one refactor from being called from somewhere that does not.
  if (!actor.permissions.includes("payment.verify")) {
    return { ok: false, reason: "step_up_required" };
  }

  const payment = await env.DB.prepare(
    `SELECT op.id, op.order_id, op.status, op.amount_expected, op.currency,
            o.status AS order_status, o.order_number
       FROM order_payments op
       JOIN orders o ON o.id = op.order_id
      WHERE op.id = ?1`,
  )
    .bind(input.orderPaymentId)
    .first<{
      id: string;
      order_id: string;
      status: string;
      amount_expected: number;
      currency: string;
      order_status: string;
      order_number: string;
    }>();

  if (!payment) return { ok: false, reason: "not_found" };
  if (!isPaymentStatus(payment.status)) return { ok: false, reason: "not_found" };

  const from = payment.status;
  const to = input.outcome;

  try {
    assertTransition(from, to);
  } catch {
    return { ok: false, reason: "invalid_transition", from };
  }

  /**
   * CONSUME the step-up, do not merely check it.
   *
   * Conditional on `consumed_at IS NULL`, so two concurrent verifications
   * cannot both spend the same one. If it fails, the step-up is missing,
   * expired, or already used — all of which mean stop.
   */
  const stepUpOk = await consumeStepUp(env, actor.userId, "payment.verify", now);
  if (!stepUpOk) return { ok: false, reason: "step_up_required" };

  const expected = money(payment.amount_expected);
  const received = money(input.amountReceived ?? 0);

  // A mismatched amount is not an error to swallow — it is a different outcome.
  // Staff must choose partially_paid or overpaid deliberately rather than have
  // the system decide for them.
  if (to === "verified" && received.amount !== expected.amount) {
    return { ok: false, reason: "amount_mismatch", expected, received };
  }

  /**
   * Duplicate references are FLAGGED, never auto-rejected. Duplicates are
   * frequently legitimate — one transfer covering two orders, or a customer
   * reusing a reference by mistake — and auto-rejecting would block real
   * payments. A human decides.
   */
  let duplicateReference = false;
  if (input.transactionReference) {
    const existing = await env.DB.prepare(
      `SELECT id FROM order_payments
        WHERE transaction_reference = ?1 AND id <> ?2 LIMIT 1`,
    )
      .bind(input.transactionReference, payment.id)
      .first<{ id: string }>();
    duplicateReference = existing !== null;
  }

  // The order status follows the payment, where the transition is legal.
  const orderTo = to === "verified" ? "paid" : payment.order_status;
  const orderTransitionValid =
    orderTo === payment.order_status ||
    (isOrderStatus(payment.order_status) &&
      isOrderStatus(orderTo) &&
      (() => {
        try {
          assertOrderTransition(payment.order_status, orderTo);
          return true;
        } catch {
          return false;
        }
      })());

  const statements: D1PreparedStatement[] = [
    env.DB.prepare(
      `UPDATE order_payments
          SET status = ?1, amount_received = ?2, transaction_reference = ?3,
              verification_note = ?4, verified_by = ?5, verified_at = ?6, updated_at = ?6
        WHERE id = ?7 AND status = ?8`,
    ).bind(
      to,
      input.amountReceived ?? null,
      input.transactionReference ?? null,
      input.note ?? null,
      actor.userId,
      now,
      payment.id,
      from,
    ),

    env.DB.prepare(
      `INSERT INTO payment_status_history
         (id, order_payment_id, from_status, to_status, amount_at_transition, reason, actor, is_correction, created_at)
       VALUES (?1,?2,?3,?4,?5,?6,?7,0,?8)`,
    ).bind(
      ids.generate(),
      payment.id,
      from,
      to,
      input.amountReceived ?? null,
      input.note ?? null,
      actor.userId,
      now,
    ),

    // Invariant 8: payment verification is a sensitive mutation.
    env.DB.prepare(
      `INSERT INTO audit_logs
         (id, actor_id, actor_label, action, entity_type, entity_id, before_value, after_value, created_at)
       VALUES (?1,?2,?3,'payment.verify','order_payment',?4,?5,?6,?7)`,
    ).bind(
      ids.generate(),
      actor.userId,
      actor.displayName,
      payment.id,
      JSON.stringify({ status: from }),
      JSON.stringify({
        status: to,
        amountReceived: input.amountReceived ?? null,
        // The reference is recorded; it is not a secret. The IBAN is, and never
        // appears here.
        transactionReference: input.transactionReference ?? null,
        duplicateReference,
      }),
      now,
    ),

    env.DB.prepare(
      `INSERT INTO order_events (id, order_id, event_type, payload, customer_visible, created_at)
       VALUES (?1,?2,?3,?4,1,?5)`,
    ).bind(
      ids.generate(),
      payment.order_id,
      to === "verified" ? "payment_verified" : `payment_${to}`,
      JSON.stringify({ orderNumber: payment.order_number }),
      now,
    ),
  ];

  if (orderTo !== payment.order_status && orderTransitionValid) {
    statements.push(
      env.DB.prepare(`UPDATE orders SET status = ?1, updated_at = ?2 WHERE id = ?3`).bind(
        orderTo,
        now,
        payment.order_id,
      ),
      env.DB.prepare(
        `INSERT INTO order_status_history (id, order_id, from_status, to_status, reason, actor, created_at)
         VALUES (?1,?2,?3,?4,'payment verified',?5,?6)`,
      ).bind(ids.generate(), payment.order_id, payment.order_status, orderTo, actor.userId, now),
    );
  }

  // When payment is settled the hold becomes a consumption: stock leaves
  // on_hand rather than returning to the shelf.
  if (to === "verified") {
    statements.push(
      env.DB.prepare(
        `UPDATE stock_reservations SET status = 'consumed', updated_at = ?1
          WHERE order_id = ?2 AND status = 'active'`,
      ).bind(now, payment.order_id),
      env.DB.prepare(
        `UPDATE inventory_levels
            SET on_hand = on_hand - (
                  SELECT COALESCE(SUM(r.quantity), 0) FROM stock_reservations r
                   WHERE r.order_id = ?1 AND r.variant_id = inventory_levels.variant_id
                     AND r.location_id = inventory_levels.location_id),
                reserved = reserved - (
                  SELECT COALESCE(SUM(r.quantity), 0) FROM stock_reservations r
                   WHERE r.order_id = ?1 AND r.variant_id = inventory_levels.variant_id
                     AND r.location_id = inventory_levels.location_id),
                updated_at = ?2
          WHERE EXISTS (
            SELECT 1 FROM stock_reservations r
             WHERE r.order_id = ?1 AND r.variant_id = inventory_levels.variant_id
               AND r.location_id = inventory_levels.location_id)`,
      ).bind(payment.order_id, now),
    );
  }

  await env.DB.batch(statements);

  return { ok: true, from, to, duplicateReference };
}
