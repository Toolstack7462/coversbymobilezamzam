import { describe, it, expect } from "vitest";
import { buildActionCentre, type ActionSnapshot } from "~/domain/content/action-centre";
import { computeSetupSteps, type SetupSnapshot } from "~/domain/content/setup-steps";
import { SETTING_KEYS } from "~/domain/content/gates";
import { PRODUCT_VIEW_SLUGS } from "~/lib/product-views";

/**
 * Deep links are a contract between three files that do not import each other.
 *
 * The action centre and the setup centre both send the merchant to
 * `/admin/prodotti?vista=senza-prezzo`. The products route decides which
 * `vista` values exist (via `app/lib/product-views.ts`). Nothing in TypeScript
 * connects those two facts: rename
 * a slug and the links keep compiling, keep looking right, and silently land
 * on the default view — which is the worst kind of bug, because the page
 * loads.
 *
 * This test is the connection.
 */

const BUSY: ActionSnapshot = {
  paymentsToVerify: 1,
  paymentsUnderVerification: 1,
  ordersAwaitingContact: 1,
  pickupsToPrepare: 1,
  ordersToShip: 1,
  outOfStock: 1,
  lowStock: 1,
  overdueReservations: 1,
  productsWithoutPrice: 1,
  productsWithoutImage: 1,
  unverifiedExactFit: 1,
  privilegedWithoutTotp: 1,
  blockingSetupSteps: 1,
  sweeperStale: true,
};

const EMPTY_SETUP: SetupSnapshot = {
  settings: Object.fromEntries(Object.values(SETTING_KEYS).map((k) => [k, ""])),
  privilegedWithoutTotp: 1,
  productCount: 3,
  publishedProductCount: 1,
  productsWithoutImage: 2,
  productsWithoutPrice: 1,
  variantCount: 4,
  variantsWithInventory: 1,
  compatibilityRecordCount: 5,
  exactFitUnverified: 2,
  activePaymentMethods: 0,
  shippingConfigured: false,
  pickupConfigured: false,
  publishedLegalDocuments: 0,
  requiredLegalDocuments: 11,
  orderCount: 0,
  lastRestoreTestAt: null,
  previewDeployedAt: null,
  now: 1_756_000_000_000,
};

const ALL_PERMISSIONS = [
  "order.read",
  "payment.read",
  "inventory.read",
  "product.read",
  "staff.read",
  "settings.read",
];

/** Every `?vista=` value any screen links to, with where it came from. */
function productViewsLinkedFrom(hrefs: { source: string; href: string }[]) {
  return hrefs
    .filter(({ href }) => href.startsWith("/admin/prodotti?"))
    .map(({ source, href }) => ({
      source,
      view: new URL(href, "https://example.invalid").searchParams.get("vista"),
    }))
    .filter((entry): entry is { source: string; view: string } => entry.view !== null);
}

describe("product deep links resolve to real saved views", () => {
  it("from the action centre", () => {
    const linked = productViewsLinkedFrom(
      buildActionCentre(BUSY, ALL_PERMISSIONS).map((i) => ({ source: i.id, href: i.href })),
    );

    // If this is zero the test has stopped testing anything.
    expect(linked.length).toBeGreaterThan(0);

    for (const { source, view } of linked) {
      expect(
        PRODUCT_VIEW_SLUGS,
        `action centre item "${source}" links to ?vista=${view}`,
      ).toContain(view);
    }
  });

  it("from the setup centre", () => {
    const linked = productViewsLinkedFrom(
      computeSetupSteps(EMPTY_SETUP).map((s) => ({ source: s.id, href: s.href })),
    );

    expect(linked.length).toBeGreaterThan(0);

    for (const { source, view } of linked) {
      expect(PRODUCT_VIEW_SLUGS, `setup step "${source}" links to ?vista=${view}`).toContain(view);
    }
  });
});

describe("every deep link is well formed", () => {
  it("parses as a URL and stays inside /admin", () => {
    const hrefs = [
      ...buildActionCentre(BUSY, ALL_PERMISSIONS).map((i) => i.href),
      ...computeSetupSteps(EMPTY_SETUP).map((s) => s.href),
    ];

    for (const href of hrefs) {
      expect(() => new URL(href, "https://example.invalid"), href).not.toThrow();
      expect(new URL(href, "https://example.invalid").pathname.startsWith("/admin"), href).toBe(
        true,
      );
    }
  });
});
