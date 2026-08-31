import { describe, it, expect } from "vitest";
import { buildActionCentre, type ActionSnapshot } from "~/domain/content/action-centre";
import { computeSetupSteps, type SetupSnapshot } from "~/domain/content/setup-steps";
import { SETTING_KEYS } from "~/domain/content/gates";
import { PRODUCT_VIEW_SLUGS } from "~/lib/product-views";
import { ORDER_VIEW_SLUGS, PAYMENT_VIEW_SLUGS, ORDER_DELIVERY_FACET } from "~/lib/order-views";
import { INVENTORY_VIEW_SLUGS } from "~/lib/inventory-views";

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

/**
 * The lists that accept a `?vista=`, and the slugs each one actually declares.
 *
 * `/admin/personale` and `/admin/compatibilita` are absent on purpose: their
 * saved views are not built yet, so there is nothing to check them against.
 * They are listed in KNOWN_UNBUILT below so that this omission is a recorded
 * decision rather than something that quietly fell out of the test.
 */
const LIST_VIEWS: Record<string, readonly string[]> = {
  "/admin/prodotti": PRODUCT_VIEW_SLUGS,
  "/admin/ordini": ORDER_VIEW_SLUGS,
  "/admin/pagamenti": PAYMENT_VIEW_SLUGS,
  "/admin/inventario": INVENTORY_VIEW_SLUGS,
};

const KNOWN_UNBUILT = ["/admin/personale", "/admin/compatibilita"];

/** Every `?vista=` a screen links to, paired with where it came from. */
function viewsLinkedFrom(hrefs: { source: string; href: string }[]) {
  return hrefs
    .map(({ source, href }) => {
      const url = new URL(href, "https://example.invalid");
      return { source, href, path: url.pathname, params: url.searchParams };
    })
    .filter((entry) => entry.params.has("vista"));
}

function expectViewsResolve(linked: ReturnType<typeof viewsLinkedFrom>) {
  // If this is zero the test has quietly stopped testing anything.
  expect(linked.length).toBeGreaterThan(0);

  for (const { source, href, path, params } of linked) {
    const declared = LIST_VIEWS[path];
    if (declared === undefined) {
      // A link into a list with no saved views yet is fine, but only for the
      // screens we have consciously not built.
      expect(KNOWN_UNBUILT, `"${source}" links to ${path}, which declares no views`).toContain(
        path,
      );
      continue;
    }
    expect(declared, `"${source}" links to ${href}`).toContain(params.get("vista"));
  }
}

describe("product deep links resolve to real saved views", () => {
  it("from the action centre", () => {
    expectViewsResolve(
      viewsLinkedFrom(
        buildActionCentre(BUSY, ALL_PERMISSIONS).map((i) => ({ source: i.id, href: i.href })),
      ),
    );
  });

  it("uses the parameter name the lists actually parse", () => {
    // This test exists because the first version of the action centre linked to
    // `?stato=da-verificare` while the payments screen read `?vista=`. Nothing
    // failed: the page loaded, showed the default view, and looked correct.
    for (const item of buildActionCentre(BUSY, ALL_PERMISSIONS)) {
      const params = new URL(item.href, "https://example.invalid").searchParams;
      expect([...params.keys()], item.id).not.toContain("stato");
    }
  });

  it("only uses declared facet values", () => {
    for (const item of buildActionCentre(BUSY, ALL_PERMISSIONS)) {
      const consegna = new URL(item.href, "https://example.invalid").searchParams.get("consegna");
      if (consegna === null) continue;
      expect(Object.keys(ORDER_DELIVERY_FACET), item.id).toContain(consegna);
    }
  });

  it("from the setup centre", () => {
    expectViewsResolve(
      viewsLinkedFrom(computeSetupSteps(EMPTY_SETUP).map((s) => ({ source: s.id, href: s.href }))),
    );
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
