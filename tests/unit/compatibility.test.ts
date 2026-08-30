import { describe, it, expect } from "vitest";
import {
  resolveCompatibility,
  shouldWarn,
  isPositiveFit,
  type CompatibilityRecord,
} from "~/domain/compatibility/resolve";

/** Invariant 3. These are the rules a wrong answer costs the shop money. */

const IPHONE_16_PRO = "dev_iphone16pro";
const IPHONE_16_PRO_MAX = "dev_iphone16promax";
const VARIANT_BLACK = "var_black";

const record = (over: Partial<CompatibilityRecord> = {}): CompatibilityRecord => ({
  deviceModelId: IPHONE_16_PRO,
  variantId: null,
  level: "exact_fit",
  verified: true,
  ...over,
});

describe("resolveCompatibility", () => {
  describe("no device selected", () => {
    it("prompts rather than guessing", () => {
      const result = resolveCompatibility({
        records: [record()],
        selectedDeviceModelId: null,
      });
      expect(result.state).toBe("prompt");
    });

    it("still reports a universal product as universal", () => {
      const result = resolveCompatibility({
        records: [record({ level: "universal" })],
        selectedDeviceModelId: null,
      });
      expect(result.state).toBe("universal");
    });
  });

  describe("the selected device has a record", () => {
    it("resolves a verified exact_fit to exact", () => {
      const result = resolveCompatibility({
        records: [record({ level: "exact_fit", verified: true })],
        selectedDeviceModelId: IPHONE_16_PRO,
      });
      expect(result.state).toBe("exact");
    });

    it("resolves a verified compatible to compatible", () => {
      const result = resolveCompatibility({
        records: [record({ level: "compatible", verified: true })],
        selectedDeviceModelId: IPHONE_16_PRO,
      });
      expect(result.state).toBe("compatible");
    });

    it("resolves adapter_required to adapter", () => {
      const result = resolveCompatibility({
        records: [record({ level: "adapter_required" })],
        selectedDeviceModelId: IPHONE_16_PRO,
      });
      expect(result.state).toBe("adapter");
    });
  });

  describe("universal never becomes exact fit", () => {
    // The rule most likely to be "helpfully" broken by a future change.
    // A 20W charger works with an iPhone 16 Pro but is not made for it, and
    // claiming exact fit would erode trust in every other badge on the site.
    it("stays universal even with a record naming the selected device", () => {
      const result = resolveCompatibility({
        records: [record({ level: "universal", deviceModelId: IPHONE_16_PRO })],
        selectedDeviceModelId: IPHONE_16_PRO,
      });
      expect(result.state).toBe("universal");
      expect(result.state).not.toBe("exact");
    });

    it("stays universal for a device it has no record for", () => {
      const result = resolveCompatibility({
        records: [record({ level: "universal" })],
        selectedDeviceModelId: IPHONE_16_PRO_MAX,
      });
      expect(result.state).toBe("universal");
    });
  });

  describe("precedence", () => {
    it("prefers a variant record over a product record", () => {
      const result = resolveCompatibility({
        records: [
          record({ level: "compatible", variantId: null }),
          record({ level: "exact_fit", variantId: VARIANT_BLACK }),
        ],
        selectedDeviceModelId: IPHONE_16_PRO,
        variantId: VARIANT_BLACK,
      });
      expect(result.state).toBe("exact");
    });

    it("falls back to the product record for a different variant", () => {
      const result = resolveCompatibility({
        records: [
          record({ level: "compatible", variantId: null }),
          record({ level: "exact_fit", variantId: VARIANT_BLACK }),
        ],
        selectedDeviceModelId: IPHONE_16_PRO,
        variantId: "var_blue",
      });
      expect(result.state).toBe("compatible");
    });

    it("lets an explicit incompatible beat a universal record", () => {
      // "This specifically does not fit" is knowledge, and it outranks a
      // general statement about fitting everything.
      const result = resolveCompatibility({
        records: [
          record({ level: "universal", deviceModelId: IPHONE_16_PRO_MAX }),
          record({ level: "incompatible", deviceModelId: IPHONE_16_PRO }),
        ],
        selectedDeviceModelId: IPHONE_16_PRO,
      });
      expect(result.state).toBe("mismatch");
    });

    it("lets a variant-level incompatible beat a product-level exact fit", () => {
      const result = resolveCompatibility({
        records: [
          record({ level: "exact_fit", variantId: null }),
          record({ level: "incompatible", variantId: VARIANT_BLACK }),
        ],
        selectedDeviceModelId: IPHONE_16_PRO,
        variantId: VARIANT_BLACK,
      });
      expect(result.state).toBe("mismatch");
    });
  });

  describe("unverified is never silently upgraded", () => {
    it("surfaces an unverified exact_fit as unverified", () => {
      const result = resolveCompatibility({
        records: [record({ level: "exact_fit", verified: false })],
        selectedDeviceModelId: IPHONE_16_PRO,
      });
      expect(result.state).toBe("unverified");
    });

    it("surfaces an unverified compatible as unverified", () => {
      const result = resolveCompatibility({
        records: [record({ level: "compatible", verified: false })],
        selectedDeviceModelId: IPHONE_16_PRO,
      });
      expect(result.state).toBe("unverified");
    });
  });

  describe("absence of evidence", () => {
    it("returns unverified when the product has no records at all", () => {
      // NOT "compatible". Nobody has checked, and saying so is the honest answer.
      const result = resolveCompatibility({
        records: [],
        selectedDeviceModelId: IPHONE_16_PRO,
      });
      expect(result.state).toBe("unverified");
    });

    it("returns mismatch when the product names devices and this is not one", () => {
      const result = resolveCompatibility({
        records: [record({ deviceModelId: IPHONE_16_PRO })],
        selectedDeviceModelId: IPHONE_16_PRO_MAX,
      });
      expect(result.state).toBe("mismatch");
    });
  });

  describe("nothing is inferred from anything but records", () => {
    it("ignores every field except the compatibility records themselves", () => {
      // The resolver's input contains no title, tag, category or brand, so
      // inference is impossible by construction rather than by discipline.
      const result = resolveCompatibility({
        records: [],
        selectedDeviceModelId: IPHONE_16_PRO,
      });
      expect(result.state).not.toBe("exact");
      expect(result.state).not.toBe("compatible");
    });
  });
});

describe("presentation helpers", () => {
  it("warns only on mismatch", () => {
    expect(shouldWarn("mismatch")).toBe(true);
    expect(shouldWarn("exact")).toBe(false);
    expect(shouldWarn("universal")).toBe(false);
    expect(shouldWarn("unverified")).toBe(false);
  });

  it("treats only exact and compatible as a positive fit claim", () => {
    expect(isPositiveFit("exact")).toBe(true);
    expect(isPositiveFit("compatible")).toBe(true);
    expect(isPositiveFit("universal")).toBe(false);
    expect(isPositiveFit("adapter")).toBe(false);
    expect(isPositiveFit("unverified")).toBe(false);
  });
});
