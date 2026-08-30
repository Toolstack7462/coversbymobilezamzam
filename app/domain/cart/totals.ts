import {
  type Money,
  type CurrencyCode,
  money,
  zero,
  add,
  subtract,
  multiply,
  sum,
  clampToZero,
  compare,
  percentageOf,
} from "../pricing/money";

/**
 * Order and cart totals.
 *
 * Pure arithmetic over values the CALLER has already read from the database.
 * This function never fetches a price - the use case re-reads authoritative
 * prices inside the order transaction and passes them in (invariant 2).
 */

export interface TotalsLine {
  readonly variantId: string;
  readonly quantity: number;
  /** Authoritative unit price, re-read server-side. */
  readonly unitPrice: Money;
  /** Line-level discount already resolved by the promotion rules. */
  readonly discount?: Money | null;
}

export interface TotalsInput {
  readonly lines: readonly TotalsLine[];
  readonly shipping?: Money | null;
  /** Order-level discount, e.g. a coupon. */
  readonly orderDiscount?: Money | null;
  /**
   * Italian VAT in basis points (2200 = 22%). Configuration, never a constant:
   * rates change, and a hardcoded value is silently wrong afterwards.
   */
  readonly vatBasisPoints: number;
  /**
   * Consumer prices in Italy are displayed VAT-inclusive, so the default is to
   * EXTRACT the tax component from the total rather than add it on top.
   */
  readonly pricesIncludeVat?: boolean;
  readonly currency?: CurrencyCode;
}

export interface Totals {
  readonly itemSubtotal: Money;
  readonly discountTotal: Money;
  readonly shippingTotal: Money;
  readonly taxTotal: Money;
  readonly grandTotal: Money;
  readonly currency: CurrencyCode;
  readonly lineTotals: readonly Money[];
}

export function calculateTotals(input: TotalsInput): Totals {
  const currency = input.currency ?? "EUR";
  const pricesIncludeVat = input.pricesIncludeVat ?? true;

  const lineTotals = input.lines.map((line) => {
    const gross = multiply(line.unitPrice, line.quantity);
    return clampToZero(subtract(gross, line.discount ?? zero(currency)));
  });

  const itemSubtotal = sum(lineTotals, currency);
  const lineDiscounts = sum(
    input.lines.map((l) => l.discount ?? zero(currency)),
    currency,
  );

  // An order discount larger than the subtotal must not make the total
  // negative, and must not silently become a refund.
  const requestedOrderDiscount = input.orderDiscount ?? zero(currency);
  const orderDiscount =
    compare(requestedOrderDiscount, itemSubtotal) === 1 ? itemSubtotal : requestedOrderDiscount;

  const discountedSubtotal = clampToZero(subtract(itemSubtotal, orderDiscount));
  const shippingTotal = input.shipping ?? zero(currency);
  const taxableBase = add(discountedSubtotal, shippingTotal);

  const taxTotal = pricesIncludeVat
    ? extractVat(taxableBase, input.vatBasisPoints)
    : percentageOf(taxableBase, input.vatBasisPoints);

  const grandTotal = pricesIncludeVat ? taxableBase : add(taxableBase, taxTotal);

  return {
    itemSubtotal,
    discountTotal: add(lineDiscounts, orderDiscount),
    shippingTotal,
    taxTotal,
    grandTotal,
    currency,
    lineTotals,
  };
}

/**
 * The VAT already contained in a gross amount.
 *
 * gross = net × (1 + rate), so vat = gross × rate / (1 + rate).
 *
 * Computed in basis points and rounded once at the end. Doing it as
 * `gross - gross/1.22` in floating point is where the classic one-cent invoice
 * discrepancy comes from.
 */
export function extractVat(grossAmount: Money, vatBasisPoints: number): Money {
  if (vatBasisPoints <= 0) return zero(grossAmount.currency);
  const numerator = grossAmount.amount * vatBasisPoints;
  const denominator = 10_000 + vatBasisPoints;
  return money(Math.round(numerator / denominator), grossAmount.currency);
}

/**
 * How much more a customer must spend for free shipping.
 *
 * Returns null when no threshold is configured, so the progress bar renders
 * nothing rather than an invented target (invariant 12).
 */
export function amountToFreeShipping(subtotal: Money, threshold: Money | null): Money | null {
  if (!threshold) return null;
  if (compare(subtotal, threshold) >= 0) return zero(subtotal.currency);
  return subtract(threshold, subtotal);
}

/** Total number of units, for the cart badge. */
export function itemCount(lines: readonly TotalsLine[]): number {
  return lines.reduce((total, line) => total + line.quantity, 0);
}
