import { describe, it, expect } from "vitest";
import {
  money,
  zero,
  add,
  subtract,
  multiply,
  sum,
  percentageOf,
  compare,
  clampToZero,
  format,
  formatPlain,
  parseAmountToMinorUnits,
  MoneyError,
} from "~/domain/pricing/money";

/** Invariant 1. */

describe("money construction", () => {
  it("accepts integer minor units", () => {
    expect(money(3990).amount).toBe(3990);
  });

  it("rejects a float, which is how 39.9 becomes a wrong charge", () => {
    expect(() => money(39.9)).toThrow(MoneyError);
    expect(() => money(0.1)).toThrow(MoneyError);
  });

  it("defaults to EUR and keeps the currency", () => {
    expect(money(100).currency).toBe("EUR");
  });

  it("refuses to combine different currencies", () => {
    const eur = money(100, "EUR");
    const other = { amount: 100, currency: "USD" } as unknown as typeof eur;
    expect(() => add(eur, other)).toThrow(MoneyError);
  });
});

describe("arithmetic has no floating-point drift", () => {
  it("sums ten 10-cent amounts to exactly 100", () => {
    // 0.1 * 10 !== 1 in floating point. In minor units it is exact.
    const total = sum(Array.from({ length: 10 }, () => money(10)));
    expect(total.amount).toBe(100);
  });

  it("accumulates a realistic basket exactly", () => {
    const basket = [money(1990), money(2450), money(899), money(1299)];
    expect(sum(basket).amount).toBe(6638);
  });

  it("multiplies by a quantity", () => {
    expect(multiply(money(1990), 3).amount).toBe(5970);
  });

  it("rejects a fractional quantity", () => {
    expect(() => multiply(money(1990), 1.5)).toThrow(MoneyError);
  });

  it("subtracts", () => {
    expect(subtract(money(5000), money(1990)).amount).toBe(3010);
  });
});

describe("percentageOf", () => {
  it("uses basis points, so 22% is exact", () => {
    expect(percentageOf(money(10000), 2200).amount).toBe(2200);
  });

  it("handles a fractional rate that a decimal could not represent", () => {
    // 22,5% of 39,90
    expect(percentageOf(money(3990), 2250).amount).toBe(898);
  });

  it("rounds half away from zero, matching hand-checked arithmetic", () => {
    // 50% of 5 minor units = 2.5 -> 3
    expect(percentageOf(money(5), 5000).amount).toBe(3);
  });
});

describe("comparison and clamping", () => {
  it("orders amounts", () => {
    expect(compare(money(100), money(200))).toBe(-1);
    expect(compare(money(200), money(100))).toBe(1);
    expect(compare(money(100), money(100))).toBe(0);
  });

  it("clamps a negative to zero so an over-discount never becomes a refund", () => {
    expect(clampToZero(money(-500)).amount).toBe(0);
    expect(clampToZero(money(500)).amount).toBe(500);
  });

  it("has a zero", () => {
    expect(zero().amount).toBe(0);
  });
});

describe("formatting for Italian customers", () => {
  it("uses a comma decimal separator", () => {
    // Non-breaking spaces vary by ICU build, so assert the parts that matter.
    const formatted = format(money(3990));
    expect(formatted).toContain("39,90");
    expect(formatted).toContain("€");
  });

  it("always shows two decimals", () => {
    expect(format(money(4000))).toContain("40,00");
    expect(format(money(5))).toContain("0,05");
  });

  it("formats plain amounts without a symbol", () => {
    expect(formatPlain(money(3990))).toBe("39,90");
  });
});

describe("parsing admin input", () => {
  it("reads Italian comma decimals", () => {
    expect(parseAmountToMinorUnits("39,90")).toBe(3990);
  });

  it("reads a dot decimal", () => {
    expect(parseAmountToMinorUnits("39.90")).toBe(3990);
  });

  it("tolerates a currency symbol and spaces", () => {
    expect(parseAmountToMinorUnits(" € 39,90 ")).toBe(3990);
  });

  it("handles a thousands separator", () => {
    expect(parseAmountToMinorUnits("1.299,00")).toBe(129900);
  });

  it("pads a single decimal digit", () => {
    expect(parseAmountToMinorUnits("39,9")).toBe(3990);
  });

  it("reads a whole number", () => {
    expect(parseAmountToMinorUnits("40")).toBe(4000);
  });

  it("refuses input it cannot read exactly, rather than guessing", () => {
    // A silently misread price becomes a real charge.
    expect(() => parseAmountToMinorUnits("39,999")).toThrow(MoneyError);
    expect(() => parseAmountToMinorUnits("abc")).toThrow(MoneyError);
    expect(() => parseAmountToMinorUnits("")).toThrow(MoneyError);
    expect(() => parseAmountToMinorUnits("39,90,00")).toThrow(MoneyError);
  });
});
