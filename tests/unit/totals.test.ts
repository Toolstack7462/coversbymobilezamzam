import { describe, it, expect } from "vitest";
import { money } from "~/domain/pricing/money";
import {
  calculateTotals,
  extractVat,
  amountToFreeShipping,
  itemCount,
  type TotalsLine,
} from "~/domain/cart/totals";

const line = (over: Partial<TotalsLine> = {}): TotalsLine => ({
  variantId: "var_1",
  quantity: 1,
  unitPrice: money(1990),
  ...over,
});

describe("calculateTotals", () => {
  it("sums line totals exactly", () => {
    const totals = calculateTotals({
      lines: [line({ unitPrice: money(1990), quantity: 2 }), line({ unitPrice: money(899) })],
      vatBasisPoints: 2200,
    });
    expect(totals.itemSubtotal.amount).toBe(4879);
    expect(totals.grandTotal.amount).toBe(4879);
  });

  it("extracts VAT from a gross total rather than adding it on top", () => {
    // Italian consumer prices are displayed VAT-inclusive.
    const totals = calculateTotals({
      lines: [line({ unitPrice: money(12200) })],
      vatBasisPoints: 2200,
    });
    expect(totals.grandTotal.amount).toBe(12200);
    expect(totals.taxTotal.amount).toBe(2200);
  });

  it("adds VAT on top when prices are net", () => {
    const totals = calculateTotals({
      lines: [line({ unitPrice: money(10000) })],
      vatBasisPoints: 2200,
      pricesIncludeVat: false,
    });
    expect(totals.taxTotal.amount).toBe(2200);
    expect(totals.grandTotal.amount).toBe(12200);
  });

  it("applies line discounts", () => {
    const totals = calculateTotals({
      lines: [line({ unitPrice: money(2000), quantity: 2, discount: money(500) })],
      vatBasisPoints: 2200,
    });
    expect(totals.itemSubtotal.amount).toBe(3500);
    expect(totals.discountTotal.amount).toBe(500);
  });

  it("applies an order discount", () => {
    const totals = calculateTotals({
      lines: [line({ unitPrice: money(5000) })],
      orderDiscount: money(1000),
      vatBasisPoints: 2200,
    });
    expect(totals.grandTotal.amount).toBe(4000);
    expect(totals.discountTotal.amount).toBe(1000);
  });

  it("caps an over-large order discount instead of producing a refund", () => {
    const totals = calculateTotals({
      lines: [line({ unitPrice: money(1000) })],
      orderDiscount: money(5000),
      vatBasisPoints: 2200,
    });
    expect(totals.grandTotal.amount).toBe(0);
    expect(totals.discountTotal.amount).toBe(1000);
  });

  it("includes shipping in the taxable base", () => {
    const totals = calculateTotals({
      lines: [line({ unitPrice: money(3990) })],
      shipping: money(500),
      vatBasisPoints: 2200,
    });
    expect(totals.shippingTotal.amount).toBe(500);
    expect(totals.grandTotal.amount).toBe(4490);
  });

  it("handles an empty cart", () => {
    const totals = calculateTotals({ lines: [], vatBasisPoints: 2200 });
    expect(totals.grandTotal.amount).toBe(0);
    expect(totals.taxTotal.amount).toBe(0);
  });

  it("does not drift across many small lines", () => {
    // Ten lines at 0,10 each. In floating point this is 0.9999999999999999.
    const totals = calculateTotals({
      lines: Array.from({ length: 10 }, () => line({ unitPrice: money(10) })),
      vatBasisPoints: 2200,
    });
    expect(totals.itemSubtotal.amount).toBe(100);
  });
});

describe("extractVat", () => {
  it("computes the tax already contained in a gross amount", () => {
    // 39,90 gross at 22%: net 32,7049, VAT 7,1951 -> 7,20 at cent precision.
    expect(extractVat(money(3990), 2200).amount).toBe(720);
  });

  it("rounds once, at the end", () => {
    // Done as gross - gross/1.22 in floating point this is where the classic
    // one-cent invoice discrepancy appears.
    expect(extractVat(money(1), 2200).amount).toBe(0);
    expect(extractVat(money(6), 2200).amount).toBe(1);
  });

  it("returns zero for a zero rate", () => {
    expect(extractVat(money(3990), 0).amount).toBe(0);
  });
});

describe("amountToFreeShipping", () => {
  it("returns null with no threshold, so nothing is rendered", () => {
    expect(amountToFreeShipping(money(1000), null)).toBeNull();
  });

  it("reports the remaining amount", () => {
    expect(amountToFreeShipping(money(3000), money(4900))?.amount).toBe(1900);
  });

  it("reports zero once the threshold is reached", () => {
    expect(amountToFreeShipping(money(4900), money(4900))?.amount).toBe(0);
    expect(amountToFreeShipping(money(6000), money(4900))?.amount).toBe(0);
  });
});

describe("itemCount", () => {
  it("counts units, not lines", () => {
    expect(itemCount([line({ quantity: 2 }), line({ quantity: 3 })])).toBe(5);
    expect(itemCount([])).toBe(0);
  });
});
