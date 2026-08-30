/**
 * Order status machine (invariant 7).
 *
 * Order status answers "where is this order in its life?" - nothing else.
 * Whether money arrived is the payment machine; whether goods moved is the
 * fulfilment machine. Keeping them separate is what lets an order be `paid` but
 * not yet `ready_for_pickup` without inventing composite states.
 */

export const ORDER_STATUSES = [
  "draft",
  "awaiting_customer_contact",
  "awaiting_payment",
  "payment_under_review",
  "paid",
  "processing",
  "ready_for_pickup",
  "shipped",
  "delivered",
  "collected",
  "cancelled",
  "expired",
  "return_requested",
  "returned",
  "partially_refunded",
  "refunded",
] as const;

export type OrderStatus = (typeof ORDER_STATUSES)[number];

/** Statuses that hold stock. Leaving one of these must release the hold. */
export const RESERVING_STATUSES: readonly OrderStatus[] = [
  "awaiting_customer_contact",
  "awaiting_payment",
  "payment_under_review",
];

/**
 * Nothing progresses from here.
 *
 * `delivered` and `collected` are deliberately NOT terminal: the customer has
 * 14 days to withdraw under the Codice del Consumo, so a returns path leads out
 * of both. They are "fulfilled", which is a different thing from "finished".
 */
export const TERMINAL_STATUSES: readonly OrderStatus[] = ["cancelled", "expired", "refunded"];

/** The goods reached the customer. Not the same as terminal - see above. */
export const FULFILLED_STATUSES: readonly OrderStatus[] = ["delivered", "collected"];

const CANCELLABLE: readonly OrderStatus[] = [
  "awaiting_customer_contact",
  "awaiting_payment",
  "payment_under_review",
  "paid",
  "processing",
];

const TRANSITIONS: Record<OrderStatus, readonly OrderStatus[]> = {
  draft: ["awaiting_customer_contact", "cancelled"],
  awaiting_customer_contact: ["awaiting_payment", "cancelled", "expired"],
  awaiting_payment: ["payment_under_review", "paid", "expired", "cancelled"],
  // Back to awaiting_payment when a proof is rejected: the customer gets
  // another go rather than losing the order over a bad screenshot.
  payment_under_review: ["paid", "awaiting_payment", "cancelled", "expired"],
  paid: ["processing", "cancelled", "refunded", "partially_refunded"],
  processing: ["ready_for_pickup", "shipped", "cancelled", "partially_refunded", "refunded"],
  ready_for_pickup: ["collected", "cancelled", "expired"],
  shipped: ["delivered", "return_requested", "refunded", "partially_refunded"],
  delivered: ["return_requested", "refunded", "partially_refunded"],
  collected: ["return_requested", "refunded", "partially_refunded"],
  cancelled: [],
  expired: [],
  return_requested: ["returned", "cancelled"],
  returned: ["refunded", "partially_refunded"],
  partially_refunded: ["refunded"],
  refunded: [],
};

export class InvalidOrderTransition extends Error {
  constructor(
    readonly from: OrderStatus,
    readonly to: OrderStatus,
  ) {
    super(`Order cannot move from "${from}" to "${to}".`);
    this.name = "InvalidOrderTransition";
  }
}

export function canTransition(from: OrderStatus, to: OrderStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

export function assertTransition(from: OrderStatus, to: OrderStatus): void {
  if (!canTransition(from, to)) throw new InvalidOrderTransition(from, to);
}

export function allowedTransitions(from: OrderStatus): readonly OrderStatus[] {
  return TRANSITIONS[from];
}

export const isReserving = (s: OrderStatus): boolean => RESERVING_STATUSES.includes(s);
export const isTerminal = (s: OrderStatus): boolean => TERMINAL_STATUSES.includes(s);
export const isFulfilled = (s: OrderStatus): boolean => FULFILLED_STATUSES.includes(s);
export const isCancellable = (s: OrderStatus): boolean => CANCELLABLE.includes(s);

/**
 * Whether moving between these states must release held stock.
 *
 * Reserving -> cancelled/expired is the only case, and it must happen exactly
 * once. Releasing twice would credit stock the shop does not have.
 */
export function releasesStock(from: OrderStatus, to: OrderStatus): boolean {
  return isReserving(from) && (to === "cancelled" || to === "expired");
}

/** Whether the reservation is consumed rather than released (goods went out). */
export function consumesStock(from: OrderStatus, to: OrderStatus): boolean {
  return isReserving(from) && to === "paid";
}

export function isOrderStatus(value: string): value is OrderStatus {
  return (ORDER_STATUSES as readonly string[]).includes(value);
}
