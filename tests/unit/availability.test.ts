import { describe, it, expect } from "vitest";
import {
  available,
  availabilityState,
  canFulfilQuantity,
  maximumOrderable,
  combinedAvailability,
  isBelowReorderPoint,
  type StockLevel,
} from "~/domain/inventory/availability";

const level = (over: Partial<StockLevel> = {}): StockLevel => ({
  variantId: "var_1",
  locationId: "loc_shop",
  onHand: 10,
  reserved: 0,
  incoming: 0,
  reorderThreshold: null,
  allowBackorder: false,
  ...over,
});

describe("available", () => {
  it("is on_hand minus reserved", () => {
    expect(available(level({ onHand: 10, reserved: 3 }))).toBe(7);
  });

  it("never goes negative even if counters drift", () => {
    expect(available(level({ onHand: 2, reserved: 5 }))).toBe(0);
  });
});

describe("availabilityState", () => {
  it("reports in_stock when units are available", () => {
    expect(availabilityState(level())).toBe("in_stock");
  });

  it("reports out_of_stock when everything is reserved", () => {
    expect(availabilityState(level({ onHand: 3, reserved: 3 }))).toBe("out_of_stock");
  });

  it("reports backorder when the variant allows it", () => {
    expect(availabilityState(level({ onHand: 0, allowBackorder: true }))).toBe("backorder");
  });

  it("reports not_tracked when there is no level at all", () => {
    expect(availabilityState(null)).toBe("not_tracked");
  });

  it("shows low_stock ONLY with a merchant-set threshold", () => {
    // There is no way to manufacture urgency: with no threshold configured the
    // state is in_stock however few remain.
    expect(availabilityState(level({ onHand: 2, reorderThreshold: null }))).toBe("in_stock");
    expect(availabilityState(level({ onHand: 2, reorderThreshold: 3 }))).toBe("low_stock");
    expect(availabilityState(level({ onHand: 9, reorderThreshold: 3 }))).toBe("in_stock");
  });
});

describe("canFulfilQuantity", () => {
  it("checks against available, not on_hand", () => {
    expect(canFulfilQuantity(level({ onHand: 10, reserved: 8 }), 2)).toBe(true);
    expect(canFulfilQuantity(level({ onHand: 10, reserved: 8 }), 3)).toBe(false);
  });

  it("rejects zero and negative quantities", () => {
    expect(canFulfilQuantity(level(), 0)).toBe(false);
    expect(canFulfilQuantity(level(), -1)).toBe(false);
  });

  it("allows any quantity on backorder", () => {
    expect(canFulfilQuantity(level({ onHand: 0, allowBackorder: true }), 99)).toBe(true);
  });

  it("refuses when nothing is tracked", () => {
    expect(canFulfilQuantity(null, 1)).toBe(false);
  });
});

describe("maximumOrderable", () => {
  it("caps at available", () => {
    expect(maximumOrderable(level({ onHand: 10, reserved: 4 }))).toBe(6);
  });

  it("has no stock ceiling on backorder", () => {
    expect(maximumOrderable(level({ allowBackorder: true }))).toBeNull();
  });
});

describe("combinedAvailability", () => {
  it("sums across sellable locations", () => {
    // Correct only because a physical unit is never counted in two locations.
    expect(
      combinedAvailability([
        level({ onHand: 5, reserved: 1 }),
        level({ locationId: "loc_online", onHand: 3, reserved: 0 }),
      ]),
    ).toBe(7);
  });
});

describe("isBelowReorderPoint", () => {
  it("is false without a threshold", () => {
    expect(isBelowReorderPoint(level({ onHand: 1 }))).toBe(false);
  });

  it("is true at or below the threshold", () => {
    expect(isBelowReorderPoint(level({ onHand: 3, reorderThreshold: 3 }))).toBe(true);
  });
});
