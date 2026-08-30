/**
 * Payment status machine (invariants 6 and 7).
 *
 * Every state here is a statement about what a human has or has not confirmed
 * against the real bank account or merchant app. The database records what was
 * OBSERVED there; it is not itself the authority on whether money moved.
 */

export const PAYMENT_STATUSES = [
  "awaiting_customer_contact",
  "awaiting_payment",
  "proof_received",
  "under_verification",
  "verified",
  "partially_paid",
  "overpaid",
  "rejected",
  "expired",
  "refunded",
  "cancelled",
] as const;

export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

const TRANSITIONS: Record<PaymentStatus, readonly PaymentStatus[]> = {
  awaiting_customer_contact: ["awaiting_payment", "cancelled"],
  awaiting_payment: [
    "proof_received",
    // Staff routinely spot a transfer before the customer says anything.
    "under_verification",
    "expired",
    "cancelled",
  ],
  proof_received: ["under_verification", "cancelled", "expired"],
  under_verification: ["verified", "partially_paid", "overpaid", "rejected", "cancelled"],
  // Both keep the reservation alive: the shortfall or excess is a conversation,
  // not an automatic outcome.
  partially_paid: ["verified", "under_verification", "rejected", "cancelled", "refunded"],
  overpaid: ["verified", "under_verification", "refunded", "cancelled"],
  // A rejected proof returns the customer to paying, rather than killing the
  // order over one bad screenshot.
  rejected: ["awaiting_payment", "cancelled", "expired"],
  // NOTE: `verified` deliberately does NOT lead back to awaiting_payment.
  // Correcting a mistaken verification goes through a privileged correction
  // event that records the reversal beside the original - silently
  // un-verifying would erase the evidence that someone got it wrong.
  verified: ["refunded"],
  // Staff may reopen an expired window if the customer got in touch.
  expired: ["awaiting_payment", "cancelled"],
  refunded: [],
  cancelled: [],
};

/**
 * The ONLY status reachable through the verification use case. Nothing else may
 * write it - not a proof upload, not an amount match, not a WhatsApp click.
 */
export const HUMAN_VERIFICATION_REQUIRED: readonly PaymentStatus[] = [
  "verified",
  "partially_paid",
  "overpaid",
  "rejected",
];

/** Statuses in which stock is still held for the order. */
export const HOLDING_STATUSES: readonly PaymentStatus[] = [
  "awaiting_customer_contact",
  "awaiting_payment",
  "proof_received",
  "under_verification",
  "partially_paid",
];

export class InvalidPaymentTransition extends Error {
  constructor(
    readonly from: PaymentStatus,
    readonly to: PaymentStatus,
  ) {
    super(`Payment cannot move from "${from}" to "${to}".`);
    this.name = "InvalidPaymentTransition";
  }
}

export function canTransition(from: PaymentStatus, to: PaymentStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

export function assertTransition(from: PaymentStatus, to: PaymentStatus): void {
  if (!canTransition(from, to)) throw new InvalidPaymentTransition(from, to);
}

export function allowedTransitions(from: PaymentStatus): readonly PaymentStatus[] {
  return TRANSITIONS[from];
}

export const requiresHumanVerification = (to: PaymentStatus): boolean =>
  HUMAN_VERIFICATION_REQUIRED.includes(to);

export const isHolding = (s: PaymentStatus): boolean => HOLDING_STATUSES.includes(s);

export const isSettled = (s: PaymentStatus): boolean => s === "verified";

/**
 * The sweeper may only expire a payment that is not settled. It re-checks this
 * AFTER claiming the reservation, which closes the race where a customer pays
 * at minute 119 and staff verify at minute 121.
 */
export function canExpire(s: PaymentStatus): boolean {
  return s === "awaiting_payment" || s === "awaiting_customer_contact" || s === "proof_received";
}

export function isPaymentStatus(value: string): value is PaymentStatus {
  return (PAYMENT_STATUSES as readonly string[]).includes(value);
}
