import { describe, it, expect } from "vitest";
import * as order from "~/domain/orders/status";
import * as payment from "~/domain/payments/status";
import * as fulfilment from "~/domain/fulfilment/status";

/**
 * Invariant 7.
 *
 * The valuable assertions here are the NEGATIVE ones. Any status machine allows
 * its happy path; what stops an order being marked paid out of nowhere is that
 * every other transition is refused.
 */

describe("order status machine", () => {
  it("walks the ordinary shipping path", () => {
    const path: order.OrderStatus[] = [
      "draft",
      "awaiting_customer_contact",
      "awaiting_payment",
      "payment_under_review",
      "paid",
      "processing",
      "shipped",
      "delivered",
    ];
    for (let i = 0; i < path.length - 1; i++) {
      expect(order.canTransition(path[i]!, path[i + 1]!)).toBe(true);
    }
  });

  it("walks the ordinary pickup path", () => {
    expect(order.canTransition("processing", "ready_for_pickup")).toBe(true);
    expect(order.canTransition("ready_for_pickup", "collected")).toBe(true);
  });

  it("returns to awaiting_payment when a proof is rejected", () => {
    // The customer gets another go rather than losing the order to a bad
    // screenshot.
    expect(order.canTransition("payment_under_review", "awaiting_payment")).toBe(true);
  });

  it("rejects every transition out of a terminal status", () => {
    for (const terminal of order.TERMINAL_STATUSES) {
      for (const target of order.ORDER_STATUSES) {
        expect(order.canTransition(terminal, target)).toBe(false);
      }
    }
  });

  it("rejects the whole cartesian product of illegal transitions", () => {
    for (const from of order.ORDER_STATUSES) {
      const allowed = order.allowedTransitions(from);
      for (const to of order.ORDER_STATUSES) {
        if (!allowed.includes(to)) {
          expect(order.canTransition(from, to)).toBe(false);
          expect(() => order.assertTransition(from, to)).toThrow(order.InvalidOrderTransition);
        }
      }
    }
  });

  it("never allows a jump straight from draft to paid", () => {
    expect(order.canTransition("draft", "paid")).toBe(false);
  });

  it("knows which statuses hold stock", () => {
    expect(order.isReserving("awaiting_payment")).toBe(true);
    expect(order.isReserving("payment_under_review")).toBe(true);
    expect(order.isReserving("paid")).toBe(false);
    expect(order.isReserving("cancelled")).toBe(false);
  });

  it("releases stock when leaving a reserving status for cancelled or expired", () => {
    expect(order.releasesStock("awaiting_payment", "cancelled")).toBe(true);
    expect(order.releasesStock("awaiting_payment", "expired")).toBe(true);
    // Paying consumes the hold, it does not release it back to the shelf.
    expect(order.releasesStock("awaiting_payment", "paid")).toBe(false);
    expect(order.consumesStock("awaiting_payment", "paid")).toBe(true);
  });
});

describe("payment status machine", () => {
  it("walks the ordinary verification path", () => {
    expect(payment.canTransition("awaiting_customer_contact", "awaiting_payment")).toBe(true);
    expect(payment.canTransition("awaiting_payment", "proof_received")).toBe(true);
    expect(payment.canTransition("proof_received", "under_verification")).toBe(true);
    expect(payment.canTransition("under_verification", "verified")).toBe(true);
  });

  it("lets staff verify without a proof ever being uploaded", () => {
    // Staff routinely spot a transfer before the customer says anything.
    expect(payment.canTransition("awaiting_payment", "under_verification")).toBe(true);
  });

  it("does NOT allow verified to fall back to awaiting_payment", () => {
    // Silently un-verifying would erase the evidence that someone got it wrong.
    // Reversal goes through a privileged correction event instead.
    expect(payment.canTransition("verified", "awaiting_payment")).toBe(false);
    expect(payment.canTransition("verified", "under_verification")).toBe(false);
    expect(payment.canTransition("verified", "rejected")).toBe(false);
  });

  it("only allows a refund out of verified", () => {
    expect(payment.allowedTransitions("verified")).toEqual(["refunded"]);
  });

  it("marks verified, partial, over and rejected as requiring a human", () => {
    expect(payment.requiresHumanVerification("verified")).toBe(true);
    expect(payment.requiresHumanVerification("partially_paid")).toBe(true);
    expect(payment.requiresHumanVerification("overpaid")).toBe(true);
    expect(payment.requiresHumanVerification("rejected")).toBe(true);
    expect(payment.requiresHumanVerification("proof_received")).toBe(false);
  });

  it("never lets a proof upload reach verified in one step", () => {
    expect(payment.canTransition("proof_received", "verified")).toBe(false);
  });

  it("refuses to expire a settled payment", () => {
    // The sweeper re-checks this AFTER claiming a reservation, which closes the
    // race where a customer pays at minute 119 and staff verify at minute 121.
    expect(payment.canExpire("verified")).toBe(false);
    expect(payment.canExpire("partially_paid")).toBe(false);
    expect(payment.canExpire("awaiting_payment")).toBe(true);
  });

  it("rejects the whole cartesian product of illegal transitions", () => {
    for (const from of payment.PAYMENT_STATUSES) {
      const allowed = payment.allowedTransitions(from);
      for (const to of payment.PAYMENT_STATUSES) {
        if (!allowed.includes(to)) {
          expect(payment.canTransition(from, to)).toBe(false);
          expect(() => payment.assertTransition(from, to)).toThrow(
            payment.InvalidPaymentTransition,
          );
        }
      }
    }
  });
});

describe("fulfilment status machine", () => {
  it("walks the shipping path", () => {
    expect(fulfilment.canTransition("pending", "picking", "shipping")).toBe(true);
    expect(fulfilment.canTransition("picking", "packed", "shipping")).toBe(true);
    expect(fulfilment.canTransition("packed", "handed_to_carrier", "shipping")).toBe(true);
    expect(fulfilment.canTransition("handed_to_carrier", "in_transit", "shipping")).toBe(true);
    expect(fulfilment.canTransition("in_transit", "delivered", "shipping")).toBe(true);
  });

  it("walks the pickup path", () => {
    expect(fulfilment.canTransition("packed", "ready_for_pickup", "pickup")).toBe(true);
    expect(fulfilment.canTransition("ready_for_pickup", "collected", "pickup")).toBe(true);
  });

  it("keeps the two routes separate", () => {
    // A shipping fulfilment cannot become ready for pickup, and a pickup
    // fulfilment cannot be handed to a carrier.
    expect(fulfilment.canTransition("packed", "ready_for_pickup", "shipping")).toBe(false);
    expect(fulfilment.canTransition("packed", "handed_to_carrier", "pickup")).toBe(false);
  });

  it("does not auto-restock an uncollected order", () => {
    // Contacting the customer, extending, or returning to shelf is a human
    // decision, and each writes its own movement.
    const allowed = fulfilment.allowedTransitions("not_collected", "pickup");
    expect(allowed).toContain("collected");
    expect(allowed).toContain("cancelled");
    expect(allowed).not.toContain("picking");
  });

  it("requires staff action for the states that assert a physical fact", () => {
    expect(fulfilment.requiresStaffAction("ready_for_pickup")).toBe(true);
    expect(fulfilment.requiresStaffAction("collected")).toBe(true);
    expect(fulfilment.requiresStaffAction("pending")).toBe(false);
  });

  it("rejects illegal transitions on both routes", () => {
    for (const type of ["shipping", "pickup"] as const) {
      for (const from of fulfilment.FULFILMENT_STATUSES) {
        const allowed = fulfilment.allowedTransitions(from, type);
        for (const to of fulfilment.FULFILMENT_STATUSES) {
          if (!allowed.includes(to)) {
            expect(fulfilment.canTransition(from, to, type)).toBe(false);
          }
        }
      }
    }
  });
});
