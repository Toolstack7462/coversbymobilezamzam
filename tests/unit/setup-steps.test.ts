import { describe, it, expect } from "vitest";
import {
  computeSetupSteps,
  summariseSetup,
  SETUP_STEP_IDS,
  type SetupSnapshot,
} from "~/domain/content/setup-steps";
import { SETTING_KEYS } from "~/domain/content/gates";

/**
 * The setup checklist is DERIVED, never stored.
 *
 * These tests exist to prove one thing above all: the checklist follows the
 * data. A step that was complete last month goes back to incomplete the moment
 * the underlying record disappears — which a stored boolean would not do.
 */

/** A brand-new install: address known from the brief, nothing else. */
const EMPTY: SetupSnapshot = {
  settings: {
    [SETTING_KEYS.storeStreet]: "Viale della Repubblica 8a",
    [SETTING_KEYS.storePostcode]: "67039",
    [SETTING_KEYS.storeCity]: "Sulmona",
    [SETTING_KEYS.brandName]: "",
    [SETTING_KEYS.shopName]: "",
    [SETTING_KEYS.legalName]: "",
    [SETTING_KEYS.vatNumber]: "",
    [SETTING_KEYS.reaNumber]: "",
    [SETTING_KEYS.phone]: "",
    [SETTING_KEYS.email]: "",
    [SETTING_KEYS.whatsappNumber]: "",
    [SETTING_KEYS.storeHoursDisplay]: "",
  },
  privilegedWithoutTotp: 0,
  productCount: 0,
  publishedProductCount: 0,
  productsWithoutImage: 0,
  productsWithoutPrice: 0,
  variantCount: 0,
  variantsWithInventory: 0,
  compatibilityRecordCount: 0,
  exactFitUnverified: 0,
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

const stepById = (snapshot: SetupSnapshot, id: string) =>
  computeSetupSteps(snapshot).find((s) => s.id === id)!;

describe("a brand-new install", () => {
  it("produces every step", () => {
    expect(computeSetupSteps(EMPTY).map((s) => s.id)).toEqual([...SETUP_STEP_IDS]);
  });

  it("is not ready to trade", () => {
    const progress = summariseSetup(computeSetupSteps(EMPTY));
    expect(progress.readyToTrade).toBe(false);
    expect(progress.blockingIncomplete.length).toBeGreaterThan(0);
  });

  it("gives every incomplete step a reason and a place to go", () => {
    // "Incomplete" with no explanation is a dead end for a non-technical
    // merchant. Every row must say why, and link somewhere.
    for (const step of computeSetupSteps(EMPTY)) {
      if (step.status === "complete") continue;
      expect(step.reason.length, `${step.id} needs a reason`).toBeGreaterThan(0);
      expect(step.href.startsWith("/admin"), `${step.id} needs a link`).toBe(true);
    }
  });

  it("does not mark everything blocking", () => {
    // If every step is blocking, "blocking" stops meaning anything.
    const steps = computeSetupSteps(EMPTY);
    const blocking = steps.filter((s) => s.severity === "blocking");
    const recommended = steps.filter((s) => s.severity === "recommended");
    expect(blocking.length).toBeGreaterThan(0);
    expect(recommended.length).toBeGreaterThan(0);
  });
});

describe("steps follow the data", () => {
  it("completes the brand step when either name is set", () => {
    expect(stepById(EMPTY, "brand_identity").status).toBe("incomplete");
    expect(
      stepById(
        { ...EMPTY, settings: { ...EMPTY.settings, [SETTING_KEYS.shopName]: "Covers by Mobile" } },
        "brand_identity",
      ).status,
    ).toBe("complete");
  });

  it("requires ALL of ragione sociale, P.IVA and REA for the legal step", () => {
    const partial = {
      ...EMPTY,
      settings: {
        ...EMPTY.settings,
        [SETTING_KEYS.legalName]: "Esempio Srl",
        [SETTING_KEYS.vatNumber]: "IT01234567890",
      },
    };
    // Two of three is not compliance.
    expect(stepById(partial, "legal_identity").status).toBe("incomplete");

    const full = {
      ...partial,
      settings: { ...partial.settings, [SETTING_KEYS.reaNumber]: "AQ-123456" },
    };
    expect(stepById(full, "legal_identity").status).toBe("complete");
  });

  it("accepts any single contact channel", () => {
    const withWhatsApp = {
      ...EMPTY,
      settings: { ...EMPTY.settings, [SETTING_KEYS.whatsappNumber]: "393501234567" },
    };
    expect(stepById(withWhatsApp, "contact_channels").status).toBe("complete");
  });

  it("reverts to incomplete when the payment method is removed", () => {
    // The point of computing rather than storing. A stored `true` would keep
    // claiming the shop can take money.
    const configured = { ...EMPTY, activePaymentMethods: 1 };
    expect(stepById(configured, "payment_method").status).toBe("complete");

    const removed = { ...configured, activePaymentMethods: 0 };
    expect(stepById(removed, "payment_method").status).toBe("incomplete");
  });

  it("counts privileged accounts missing TOTP and says how many", () => {
    const step = stepById({ ...EMPTY, privilegedWithoutTotp: 2 }, "admin_totp");
    expect(step.status).toBe("incomplete");
    expect(step.reason).toContain("2");
  });

  it("accepts shipping OR pickup, not necessarily both", () => {
    expect(stepById({ ...EMPTY, pickupConfigured: true }, "delivery_method").status).toBe(
      "complete",
    );
    expect(stepById({ ...EMPTY, shippingConfigured: true }, "delivery_method").status).toBe(
      "complete",
    );
  });

  it("tells the merchant to add a product first, rather than blaming them for no images", () => {
    // With zero products, "3 products without images" would be nonsense.
    const step = stepById(EMPTY, "product_image");
    expect(step.reason).toContain("Aggiungi prima un prodotto");
  });

  it("flags unverified exact-fit compatibility as attention, not plain incomplete", () => {
    // Records exist but are unverified: that is a different problem from having
    // no compatibility data at all, and it is the one that causes returns.
    const step = stepById(
      { ...EMPTY, compatibilityRecordCount: 12, exactFitUnverified: 3 },
      "compatibility_verified",
    );
    expect(step.status).toBe("attention");
    expect(step.reason).toContain("3");
    expect(step.reason).toContain("resi");
  });

  it("requires every variant to have a stock row", () => {
    expect(
      stepById({ ...EMPTY, variantCount: 4, variantsWithInventory: 4 }, "inventory").status,
    ).toBe("complete");

    const partial = stepById({ ...EMPTY, variantCount: 4, variantsWithInventory: 3 }, "inventory");
    expect(partial.status).toBe("incomplete");
    expect(partial.reason).toContain("1");
  });

  it("expires the backup step after thirty days", () => {
    const day = 24 * 60 * 60 * 1000;
    const fresh = { ...EMPTY, lastRestoreTestAt: EMPTY.now - 5 * day };
    const stale = { ...EMPTY, lastRestoreTestAt: EMPTY.now - 45 * day };

    expect(stepById(fresh, "backup_restore").status).toBe("complete");
    // A restore verified 45 days ago is not evidence about today's backup.
    expect(stepById(stale, "backup_restore").status).toBe("incomplete");
  });
});

describe("a fully configured shop", () => {
  const READY: SetupSnapshot = {
    ...EMPTY,
    settings: {
      ...EMPTY.settings,
      [SETTING_KEYS.brandName]: "Covers by Mobile",
      [SETTING_KEYS.shopName]: "Covers by Mobile",
      [SETTING_KEYS.legalName]: "Esempio Srl",
      [SETTING_KEYS.vatNumber]: "IT01234567890",
      [SETTING_KEYS.reaNumber]: "AQ-123456",
      [SETTING_KEYS.whatsappNumber]: "393501234567",
      [SETTING_KEYS.storeHoursDisplay]: "Lun-Sab 09:00-20:00",
    },
    productCount: 12,
    publishedProductCount: 12,
    productsWithoutImage: 0,
    productsWithoutPrice: 0,
    variantCount: 20,
    variantsWithInventory: 20,
    compatibilityRecordCount: 60,
    exactFitUnverified: 0,
    activePaymentMethods: 1,
    pickupConfigured: true,
    publishedLegalDocuments: 11,
    orderCount: 3,
    lastRestoreTestAt: EMPTY.now - 1000,
    previewDeployedAt: EMPTY.now - 1000,
  };

  it("is ready to trade with everything complete", () => {
    const progress = summariseSetup(computeSetupSteps(READY));
    expect(progress.readyToTrade).toBe(true);
    expect(progress.blockingIncomplete).toHaveLength(0);
    expect(progress.percentage).toBe(100);
  });

  it("is ready to trade even with a recommended step outstanding", () => {
    // A shop can open without a verified backup. It cannot open without a way
    // to be paid.
    const progress = summariseSetup(
      computeSetupSteps({ ...READY, lastRestoreTestAt: null, previewDeployedAt: null }),
    );
    expect(progress.readyToTrade).toBe(true);
    expect(progress.percentage).toBeLessThan(100);
  });

  it("stops being ready the moment a blocking record disappears", () => {
    const progress = summariseSetup(computeSetupSteps({ ...READY, activePaymentMethods: 0 }));
    expect(progress.readyToTrade).toBe(false);
  });
});
