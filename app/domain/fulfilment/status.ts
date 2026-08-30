/**
 * Fulfilment status machine (invariant 7).
 *
 * Answers "where are the goods?". Separate from payment because the two move
 * independently: pay-at-pickup is fulfilled before it is paid, and a shipped
 * order was often paid weeks earlier.
 */

export const FULFILMENT_STATUSES = [
  "pending",
  "awaiting_stock",
  "picking",
  "packed",
  "ready_for_pickup",
  "handed_to_carrier",
  "in_transit",
  "delivered",
  "collected",
  "not_collected",
  "cancelled",
  "returned_to_sender",
] as const;

export type FulfilmentStatus = (typeof FULFILMENT_STATUSES)[number];
export type FulfilmentType = "shipping" | "pickup";

const SHIPPING_TRANSITIONS: Record<FulfilmentStatus, readonly FulfilmentStatus[]> = {
  pending: ["picking", "awaiting_stock", "cancelled"],
  awaiting_stock: ["picking", "cancelled"],
  picking: ["packed", "awaiting_stock", "cancelled"],
  packed: ["handed_to_carrier", "cancelled"],
  handed_to_carrier: ["in_transit", "returned_to_sender", "cancelled"],
  in_transit: ["delivered", "returned_to_sender"],
  delivered: [],
  ready_for_pickup: [],
  collected: [],
  not_collected: [],
  cancelled: [],
  returned_to_sender: [],
};

const PICKUP_TRANSITIONS: Record<FulfilmentStatus, readonly FulfilmentStatus[]> = {
  pending: ["picking", "awaiting_stock", "cancelled"],
  awaiting_stock: ["picking", "cancelled"],
  picking: ["packed", "awaiting_stock", "cancelled"],
  packed: ["ready_for_pickup", "cancelled"],
  ready_for_pickup: ["collected", "not_collected", "cancelled"],
  // An uncollected order does NOT restock itself. Contacting the customer,
  // extending, or returning to shelf is a human decision, and each writes its
  // own movement.
  not_collected: ["collected", "cancelled"],
  collected: [],
  handed_to_carrier: [],
  in_transit: [],
  delivered: [],
  cancelled: [],
  returned_to_sender: [],
};

export const TERMINAL_STATUSES: readonly FulfilmentStatus[] = [
  "delivered",
  "collected",
  "cancelled",
  "returned_to_sender",
];

export class InvalidFulfilmentTransition extends Error {
  constructor(
    readonly from: FulfilmentStatus,
    readonly to: FulfilmentStatus,
    readonly type: FulfilmentType,
  ) {
    super(`Fulfilment (${type}) cannot move from "${from}" to "${to}".`);
    this.name = "InvalidFulfilmentTransition";
  }
}

function mapFor(type: FulfilmentType): Record<FulfilmentStatus, readonly FulfilmentStatus[]> {
  return type === "pickup" ? PICKUP_TRANSITIONS : SHIPPING_TRANSITIONS;
}

export function canTransition(
  from: FulfilmentStatus,
  to: FulfilmentStatus,
  type: FulfilmentType,
): boolean {
  return mapFor(type)[from].includes(to);
}

export function assertTransition(
  from: FulfilmentStatus,
  to: FulfilmentStatus,
  type: FulfilmentType,
): void {
  if (!canTransition(from, to, type)) throw new InvalidFulfilmentTransition(from, to, type);
}

export function allowedTransitions(
  from: FulfilmentStatus,
  type: FulfilmentType,
): readonly FulfilmentStatus[] {
  return mapFor(type)[from];
}

export const isTerminal = (s: FulfilmentStatus): boolean => TERMINAL_STATUSES.includes(s);

/**
 * `ready_for_pickup` is a fact recorded by a staff member who physically set the
 * item aside. It is never inferred from online stock, and the storefront never
 * says "ready today" speculatively (invariant 11).
 */
export function requiresStaffAction(to: FulfilmentStatus): boolean {
  return to === "ready_for_pickup" || to === "collected" || to === "handed_to_carrier";
}

export function isFulfilmentStatus(value: string): value is FulfilmentStatus {
  return (FULFILMENT_STATUSES as readonly string[]).includes(value);
}
