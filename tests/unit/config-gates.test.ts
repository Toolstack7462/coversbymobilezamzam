import { describe, it, expect } from "vitest";
import {
  isConfigured,
  settingValue,
  canShowLegalIdentity,
  canShowStoreAddress,
  canShowStoreSection,
  canShowOpeningHours,
  canEmitStructuredHours,
  canShowWhatsApp,
  hasAnyContactChannel,
  canOfferPickup,
  canEmitLocalBusinessSchema,
  canShowFreeShippingProgress,
  gateStatuses,
  SETTING_KEYS,
} from "~/domain/content/gates";

/**
 * Invariant 12.
 *
 * The known address from the brief, and nothing else. Every other merchant value
 * is unknown and must stay empty.
 */
const KNOWN_ADDRESS = {
  [SETTING_KEYS.storeStreet]: "Viale della Repubblica 8a, Centro Il Nuovo Borgo, negozio 6",
  [SETTING_KEYS.storePostcode]: "67039",
  [SETTING_KEYS.storeCity]: "Sulmona",
  [SETTING_KEYS.storeProvince]: "AQ",
  [SETTING_KEYS.storeLatitude]: "42.0614846",
  [SETTING_KEYS.storeLongitude]: "13.9200965",
};

const EMPTY = {
  [SETTING_KEYS.shopName]: "",
  [SETTING_KEYS.legalName]: "",
  [SETTING_KEYS.vatNumber]: "",
  [SETTING_KEYS.phone]: "",
  [SETTING_KEYS.email]: "",
  [SETTING_KEYS.whatsappNumber]: "",
  [SETTING_KEYS.storeHoursDisplay]: "",
};

describe("isConfigured", () => {
  it("treats blank and whitespace as unconfigured", () => {
    expect(isConfigured({ k: "" }, "k")).toBe(false);
    expect(isConfigured({ k: "   " }, "k")).toBe(false);
    expect(isConfigured({}, "k")).toBe(false);
  });

  it("treats placeholder text as unconfigured", () => {
    // "[PHONE]" reaching a live storefront is worse than no phone number.
    for (const placeholder of [
      "[PHONE]",
      "TODO",
      "TBD",
      "xxx",
      "n/a",
      "N/A",
      "placeholder",
      "--",
    ]) {
      expect(isConfigured({ k: placeholder }, "k")).toBe(false);
    }
  });

  it("accepts a real value", () => {
    expect(isConfigured({ k: "Sulmona" }, "k")).toBe(true);
  });

  it("returns null rather than an empty string for an unset value", () => {
    expect(settingValue(EMPTY, SETTING_KEYS.phone)).toBeNull();
    expect(settingValue(KNOWN_ADDRESS, SETTING_KEYS.storeCity)).toBe("Sulmona");
  });
});

describe("gates with the merchant data actually known today", () => {
  const settings = { ...EMPTY, ...KNOWN_ADDRESS };

  it("shows the address, which the brief supplies", () => {
    expect(canShowStoreAddress(settings)).toBe(true);
  });

  it("hides the store section, because the shop name is unknown", () => {
    expect(canShowStoreSection(settings)).toBe(false);
  });

  it("hides the legal identity block until the P.IVA exists", () => {
    // Required by D.Lgs. 70/2003. A partial legal footer looks like compliance
    // without being it.
    expect(canShowLegalIdentity(settings)).toBe(false);
  });

  it("hides opening hours", () => {
    // An invented opening time sends a real person to a closed door.
    expect(canShowOpeningHours(settings)).toBe(false);
  });

  it("hides WhatsApp, so the CTA does not render at all", () => {
    expect(canShowWhatsApp(settings)).toBe(false);
  });

  it("reports that there is no contact channel yet", () => {
    expect(hasAnyContactChannel(settings)).toBe(false);
  });

  it("does not offer pickup without preparation time", () => {
    expect(canOfferPickup(settings)).toBe(false);
  });

  it("does not emit LocalBusiness without a verified shop name", () => {
    expect(canEmitLocalBusinessSchema(settings)).toBe(false);
  });
});

describe("gates once the merchant supplies values", () => {
  const configured = {
    ...KNOWN_ADDRESS,
    [SETTING_KEYS.shopName]: "Nome Negozio",
    [SETTING_KEYS.legalName]: "Ragione Sociale Srl",
    [SETTING_KEYS.vatNumber]: "IT01234567890",
    [SETTING_KEYS.whatsappNumber]: "393501234567",
    [SETTING_KEYS.storeHoursDisplay]: "Lun-Sab 09:00-20:00",
    [SETTING_KEYS.pickupEnabled]: "true",
    [SETTING_KEYS.pickupPreparationTime]: "2 ore",
  };

  it("opens up each gate as its data arrives", () => {
    expect(canShowStoreSection(configured)).toBe(true);
    expect(canShowLegalIdentity(configured)).toBe(true);
    expect(canShowOpeningHours(configured)).toBe(true);
    expect(canShowWhatsApp(configured)).toBe(true);
    expect(hasAnyContactChannel(configured)).toBe(true);
    expect(canOfferPickup(configured)).toBe(true);
    expect(canEmitLocalBusinessSchema(configured)).toBe(true);
  });

  it("gates structured hours separately from displayed hours", () => {
    // A wrong schema.org opening time appears in Google's results, so if the
    // merchant is unsure of the format it stays blank while the readable text
    // still shows.
    expect(canShowOpeningHours(configured)).toBe(true);
    expect(canEmitStructuredHours(configured)).toBe(false);

    const withStructured = {
      ...configured,
      [SETTING_KEYS.storeHoursStructured]: "Mo-Sa 09:00-20:00",
    };
    expect(canEmitStructuredHours(withStructured)).toBe(true);
  });

  it("requires pickup to be explicitly enabled, not merely configurable", () => {
    expect(canOfferPickup({ ...configured, [SETTING_KEYS.pickupEnabled]: "false" })).toBe(false);
  });
});

describe("free shipping progress", () => {
  it("needs a real integer threshold", () => {
    expect(canShowFreeShippingProgress({ [SETTING_KEYS.freeShippingThreshold]: "" })).toBe(false);
    expect(canShowFreeShippingProgress({ [SETTING_KEYS.freeShippingThreshold]: "abc" })).toBe(
      false,
    );
    expect(canShowFreeShippingProgress({ [SETTING_KEYS.freeShippingThreshold]: "0" })).toBe(false);
    expect(canShowFreeShippingProgress({ [SETTING_KEYS.freeShippingThreshold]: "4900" })).toBe(
      true,
    );
  });
});

describe("gateStatuses", () => {
  it("names the missing keys so the admin can explain the absence", () => {
    const statuses = gateStatuses({ ...EMPTY, ...KNOWN_ADDRESS });
    const legal = statuses.find((s) => s.feature === "legal_identity")!;
    expect(legal.enabled).toBe(false);
    expect(legal.missingKeys).toContain(SETTING_KEYS.legalName);
    expect(legal.missingKeys).toContain(SETTING_KEYS.vatNumber);
    expect(legal.missingKeys).not.toContain(SETTING_KEYS.storeCity);
  });
});
