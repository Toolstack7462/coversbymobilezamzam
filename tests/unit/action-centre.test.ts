import { describe, it, expect } from "vitest";
import { buildActionCentre, isClear, type ActionSnapshot } from "~/domain/content/action-centre";

/**
 * The Action Centre's value is entirely in what it LEAVES OUT. These tests
 * guard the three rules that keep it from becoming a notification feed.
 */

const QUIET: ActionSnapshot = {
  paymentsToVerify: 0,
  paymentsUnderVerification: 0,
  ordersAwaitingContact: 0,
  pickupsToPrepare: 0,
  ordersToShip: 0,
  outOfStock: 0,
  lowStock: 0,
  overdueReservations: 0,
  productsWithoutPrice: 0,
  productsWithoutImage: 0,
  unverifiedExactFit: 0,
  privilegedWithoutTotp: 0,
  blockingSetupSteps: 0,
  sweeperStale: false,
};

const ALL_PERMISSIONS = [
  "order.read",
  "payment.read",
  "inventory.read",
  "product.read",
  "staff.read",
  "settings.read",
];

describe("nothing appears at zero", () => {
  it("returns an empty list when there is nothing to do", () => {
    const items = buildActionCentre(QUIET, ALL_PERMISSIONS);
    expect(items).toEqual([]);
    expect(isClear(items)).toBe(true);
  });

  it("never emits an item with a count of zero", () => {
    // A row reading "0 payments to verify" teaches people to skim past the row
    // that one day says 3.
    const mixed = { ...QUIET, paymentsToVerify: 2, lowStock: 0, outOfStock: 0 };
    const items = buildActionCentre(mixed, ALL_PERMISSIONS);
    expect(items).toHaveLength(1);
    expect(items.every((i) => i.count > 0)).toBe(true);
  });

  it("shows the stalled sweeper as a single item, not a count", () => {
    const items = buildActionCentre({ ...QUIET, sweeperStale: true }, ALL_PERMISSIONS);
    expect(items.map((i) => i.id)).toEqual(["sweeper_stale"]);
    expect(items[0]!.count).toBe(1);
    expect(items[0]!.severity).toBe("blocking");
  });
});

describe("ordering", () => {
  it("puts blocking work above attention above informational", () => {
    const items = buildActionCentre(
      {
        ...QUIET,
        lowStock: 99, // informational, and the largest number
        outOfStock: 4, // attention
        paymentsToVerify: 1, // blocking, and the smallest number
      },
      ALL_PERMISSIONS,
    );

    // Severity beats size. The single unverified payment is a customer waiting
    // on their money; ninety-nine low-stock rows are a shopping list.
    expect(items.map((i) => i.id)).toEqual(["payments_to_verify", "out_of_stock", "low_stock"]);
  });

  it("puts the bigger pile first within one severity", () => {
    const items = buildActionCentre(
      { ...QUIET, outOfStock: 2, overdueReservations: 11 },
      ALL_PERMISSIONS,
    );
    expect(items.map((i) => i.id)).toEqual(["overdue_reservations", "out_of_stock"]);
  });
});

describe("permission filtering", () => {
  it("hides work the actor cannot act on", () => {
    // A warehouse assistant told that six payments need verifying, who cannot
    // open the payment screen, has an unclearable badge and no recourse.
    const snapshot = { ...QUIET, paymentsToVerify: 6, outOfStock: 3 };
    const items = buildActionCentre(snapshot, ["inventory.read"]);
    expect(items.map((i) => i.id)).toEqual(["out_of_stock"]);
  });

  it("still shows items open to any staff member", () => {
    const items = buildActionCentre({ ...QUIET, blockingSetupSteps: 4 }, []);
    expect(items.map((i) => i.id)).toEqual(["setup_incomplete"]);
  });

  it("reports clear when everything visible is filtered away", () => {
    const items = buildActionCentre({ ...QUIET, paymentsToVerify: 6 }, ["inventory.read"]);
    expect(isClear(items)).toBe(true);
  });
});

describe("every item is actionable", () => {
  const busy: ActionSnapshot = {
    paymentsToVerify: 3,
    paymentsUnderVerification: 1,
    ordersAwaitingContact: 2,
    pickupsToPrepare: 4,
    ordersToShip: 5,
    outOfStock: 6,
    lowStock: 7,
    overdueReservations: 8,
    productsWithoutPrice: 9,
    productsWithoutImage: 10,
    unverifiedExactFit: 11,
    privilegedWithoutTotp: 1,
    blockingSetupSteps: 2,
    sweeperStale: true,
  };

  it("deep-links every item to an exact filtered page, never a section root", () => {
    const SECTION_ROOTS = [
      "/admin/ordini",
      "/admin/pagamenti",
      "/admin/inventario",
      "/admin/prodotti",
    ];
    for (const item of buildActionCentre(busy, ALL_PERMISSIONS)) {
      expect(item.href.startsWith("/admin"), item.id).toBe(true);
      // Landing on an unfiltered list and asking the merchant to filter by hand
      // is the failure this rule exists to prevent.
      expect(SECTION_ROOTS.includes(item.href), `${item.id} links to a bare section root`).toBe(
        false,
      );
    }
  });

  it("gives every item a detail that is not a restatement of its label", () => {
    for (const item of buildActionCentre(busy, ALL_PERMISSIONS)) {
      expect(item.detail.length, item.id).toBeGreaterThan(20);
      expect(item.detail, item.id).not.toBe(item.label);
    }
  });

  it("uses unique ids", () => {
    const ids = buildActionCentre(busy, ALL_PERMISSIONS).map((i) => i.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("keeps blocking a minority even when everything is on fire", () => {
    // "Blocking" has to stay expensive or it stops being read.
    const items = buildActionCentre(busy, ALL_PERMISSIONS);
    const blocking = items.filter((i) => i.severity === "blocking");
    expect(blocking.length).toBeLessThan(items.length / 2);
  });
});
