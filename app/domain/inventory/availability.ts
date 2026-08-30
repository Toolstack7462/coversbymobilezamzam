/**
 * Inventory availability rules (invariant 4).
 *
 * Pure arithmetic and policy. The actual oversell guard is a conditional write
 * in the repository - see app/infrastructure/repositories/inventory.ts. These
 * functions decide what to SHOW and what to allow into a cart; the database
 * decides who wins a race for the last unit.
 */

export interface StockLevel {
  readonly variantId: string;
  readonly locationId: string;
  readonly onHand: number;
  readonly reserved: number;
  readonly incoming: number;
  readonly reorderThreshold: number | null;
  readonly allowBackorder: boolean;
}

export const AVAILABILITY_STATES = [
  "in_stock",
  "low_stock",
  "out_of_stock",
  "backorder",
  "not_tracked",
] as const;

export type AvailabilityState = (typeof AVAILABILITY_STATES)[number];

/** available = on_hand - reserved. The only figure a purchase is checked against. */
export function available(level: StockLevel): number {
  return Math.max(0, level.onHand - level.reserved);
}

/**
 * Low stock is shown ONLY when the merchant set a threshold AND the real
 * quantity is at or below it (invariant 11).
 *
 * There is no way to manufacture urgency here: with no threshold configured the
 * state is `in_stock`, however few remain.
 */
export function availabilityState(level: StockLevel | null): AvailabilityState {
  if (!level) return "not_tracked";

  const qty = available(level);

  if (qty <= 0) return level.allowBackorder ? "backorder" : "out_of_stock";
  if (level.reorderThreshold !== null && qty <= level.reorderThreshold) return "low_stock";
  return "in_stock";
}

export function canFulfilQuantity(level: StockLevel | null, quantity: number): boolean {
  if (quantity <= 0) return false;
  if (!level) return false;
  if (level.allowBackorder) return true;
  return available(level) >= quantity;
}

/**
 * How many units may still be added, for a quantity stepper.
 * Backorder means no ceiling from stock, so the caller applies its own cap.
 */
export function maximumOrderable(level: StockLevel | null): number | null {
  if (!level) return 0;
  if (level.allowBackorder) return null;
  return available(level);
}

/**
 * Aggregated availability where the merchant runs several sellable locations.
 *
 * Summing is only correct because a physical unit is never counted in two
 * locations - that rule is enforced in the location model, and this function
 * depends on it.
 */
export function combinedAvailability(levels: readonly StockLevel[]): number {
  return levels.reduce((total, level) => total + available(level), 0);
}

export const isBelowReorderPoint = (level: StockLevel): boolean =>
  level.reorderThreshold !== null && available(level) <= level.reorderThreshold;

/** Locale key for a state. Never build these by string concatenation. */
export function availabilityLabelKey(state: AvailabilityState): string {
  switch (state) {
    case "in_stock":
      return "availability.in_stock";
    case "low_stock":
      return "availability.low_stock";
    case "out_of_stock":
      return "availability.out_of_stock";
    case "backorder":
      return "availability.backorder";
    case "not_tracked":
      return "availability.not_tracked";
  }
}
