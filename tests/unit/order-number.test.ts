import { describe, it, expect } from "vitest";
import {
  generateOrderNumber,
  generateTrackingToken,
  isValidOrderNumber,
  parseOrderNumber,
  normaliseOrderNumberInput,
  TRACKING_TOKEN_LENGTH,
} from "~/domain/orders/order-number";

const bytes = (fill: number, length = 32): Uint8Array => new Uint8Array(length).fill(fill);

describe("order numbers", () => {
  it("has the documented shape", () => {
    const n = generateOrderNumber(new Date("2026-08-30T10:00:00Z"), bytes(0));
    expect(n).toMatch(/^ITA-\d{8}-[0-9A-HJKMNP-TV-Z]{6}$/);
    expect(n.startsWith("ITA-20260830-")).toBe(true);
  });

  it("uses the Italian calendar day, not the UTC one", () => {
    // 23:30 UTC on the 30th is 01:30 on the 31st in Rome. Staff match orders to
    // a working day, so the number must carry the Italian date.
    const n = generateOrderNumber(new Date("2026-08-30T23:30:00Z"), bytes(0));
    expect(n.startsWith("ITA-20260831-")).toBe(true);
  });

  it("omits characters that are confused when read aloud", () => {
    // O/0 and I/1 are misheard and mis-transcribed into a bank transfer causale,
    // and a wrong causale is a payment nobody can match to an order.
    for (let b = 0; b < 256; b++) {
      const suffix = generateOrderNumber(new Date("2026-08-30T10:00:00Z"), bytes(b)).split("-")[2]!;
      expect(suffix).not.toMatch(/[ILOU]/);
    }
  });

  it("produces different suffixes for different randomness", () => {
    const a = generateOrderNumber(new Date("2026-08-30T10:00:00Z"), bytes(3));
    const b = generateOrderNumber(new Date("2026-08-30T10:00:00Z"), bytes(17));
    expect(a).not.toBe(b);
  });

  it("refuses to generate from insufficient randomness", () => {
    expect(() => generateOrderNumber(new Date(), new Uint8Array(2))).toThrow();
  });

  it("validates and parses", () => {
    expect(isValidOrderNumber("ITA-20260830-AB12CD")).toBe(true);
    expect(isValidOrderNumber("ITA-20260830-ABI2CD")).toBe(false); // I is not in the alphabet
    expect(isValidOrderNumber("XXX-20260830-AB12CD")).toBe(false);
    expect(isValidOrderNumber("ITA-2026830-AB12CD")).toBe(false);

    const parts = parseOrderNumber("ITA-20260830-AB12CD");
    expect(parts).toEqual({ prefix: "ITA", datePart: "20260830", suffix: "AB12CD" });
  });

  it("forgives the substitutions customers actually make", () => {
    // Someone reading a number aloud will produce O for 0 and I for 1 often
    // enough that refusing it would only generate support calls.
    expect(normaliseOrderNumberInput(" ita-20260830-abi2cd ")).toBe("ITA-20260830-AB12CD");
    expect(normaliseOrderNumberInput("ITA-2026O83O-ABL2CD")).toBe("ITA-20260830-AB12CD");
  });

  it("does not mangle the ITA prefix while substituting", () => {
    // Regression: mapping I to 1 across the whole string turned every pasted
    // order number into "1TA-..." and broke the lookup it was meant to rescue.
    expect(normaliseOrderNumberInput("ITA-20260830-AB12CD")).toBe("ITA-20260830-AB12CD");
    expect(normaliseOrderNumberInput("ITA-20260830-AB12CD")).not.toContain("1TA");
  });

  it("normalises a suffix pasted without the prefix", () => {
    expect(normaliseOrderNumberInput("abi2cd")).toBe("AB12CD");
  });
});

describe("tracking tokens", () => {
  it("is long enough not to be guessable", () => {
    const token = generateTrackingToken(bytes(5));
    expect(token).toHaveLength(TRACKING_TOKEN_LENGTH);
  });

  it("is not derivable from an order number", () => {
    // The order number contains the date and is therefore partly predictable,
    // which is exactly why it never authorises access on its own.
    const date = new Date("2026-08-30T10:00:00Z");
    const orderNumber = generateOrderNumber(date, bytes(7));
    const token = generateTrackingToken(bytes(11));
    expect(token).not.toContain(orderNumber);
    expect(orderNumber).not.toContain(token);
  });

  it("refuses insufficient randomness", () => {
    expect(() => generateTrackingToken(new Uint8Array(8))).toThrow();
  });
});
