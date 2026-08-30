/**
 * Money as integer minor units (invariant 1).
 *
 * Floating point cannot represent 0,10 exactly. Accumulate a few line items,
 * apply a percentage discount, and the total drifts by a cent - which is the
 * difference between a bank transfer reconciling and a customer being told
 * their payment was short. So there is no float anywhere in this file, and
 * `parseFloat` is an ESLint error across the project.
 */

export type CurrencyCode = "EUR";

export interface Money {
  /** Minor units. 3990 = 39,90. Always an integer. */
  readonly amount: number;
  readonly currency: CurrencyCode;
}

export class MoneyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MoneyError";
  }
}

export function money(amount: number, currency: CurrencyCode = "EUR"): Money {
  if (!Number.isInteger(amount)) {
    throw new MoneyError(
      `Money must be integer minor units, received ${amount}. 39,90 is 3990, not 39.9.`,
    );
  }
  if (!Number.isSafeInteger(amount)) {
    throw new MoneyError(`Money amount ${amount} is outside the safe integer range.`);
  }
  return { amount, currency };
}

export const zero = (currency: CurrencyCode = "EUR"): Money => money(0, currency);

function assertSameCurrency(a: Money, b: Money): void {
  if (a.currency !== b.currency) {
    throw new MoneyError(`Cannot combine ${a.currency} and ${b.currency}.`);
  }
}

export function add(a: Money, b: Money): Money {
  assertSameCurrency(a, b);
  return money(a.amount + b.amount, a.currency);
}

export function subtract(a: Money, b: Money): Money {
  assertSameCurrency(a, b);
  return money(a.amount - b.amount, a.currency);
}

export function sum(values: readonly Money[], currency: CurrencyCode = "EUR"): Money {
  return values.reduce<Money>((acc, v) => add(acc, v), zero(currency));
}

/** Multiply by a whole quantity. Quantities are never fractional here. */
export function multiply(value: Money, quantity: number): Money {
  if (!Number.isInteger(quantity) || quantity < 0) {
    throw new MoneyError(`Quantity must be a non-negative integer, received ${quantity}.`);
  }
  return money(value.amount * quantity, value.currency);
}

/**
 * Percentage in basis points: 1000 = 10%, 2250 = 22,5%.
 *
 * Basis points rather than a decimal rate because 0.225 is not representable in
 * binary floating point, and a VAT rate that is almost right produces totals
 * that are almost right.
 *
 * Rounds half away from zero, which is what Italian invoicing expects and what
 * a customer checking the arithmetic by hand will get.
 */
export function percentageOf(value: Money, basisPoints: number): Money {
  if (!Number.isInteger(basisPoints)) {
    throw new MoneyError(`Basis points must be an integer, received ${basisPoints}.`);
  }
  const raw = (value.amount * basisPoints) / 10_000;
  return money(roundHalfAwayFromZero(raw), value.currency);
}

function roundHalfAwayFromZero(n: number): number {
  return n < 0 ? -Math.round(-n) : Math.round(n);
}

export function isZero(value: Money): boolean {
  return value.amount === 0;
}

export function isPositive(value: Money): boolean {
  return value.amount > 0;
}

export function compare(a: Money, b: Money): -1 | 0 | 1 {
  assertSameCurrency(a, b);
  if (a.amount < b.amount) return -1;
  if (a.amount > b.amount) return 1;
  return 0;
}

export const equals = (a: Money, b: Money): boolean => compare(a, b) === 0;
export const greaterThan = (a: Money, b: Money): boolean => compare(a, b) === 1;
export const lessThan = (a: Money, b: Money): boolean => compare(a, b) === -1;

/** Never below zero - used for discounts that would otherwise overshoot. */
export function clampToZero(value: Money): Money {
  return value.amount < 0 ? zero(value.currency) : value;
}

/**
 * Formats for display. `it-IT` gives "39,90 €" with a comma decimal separator,
 * which is what an Italian customer expects to read.
 *
 * Display only. Never parse a formatted string back into a Money.
 */
export function format(value: Money, locale = "it-IT"): string {
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency: value.currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value.amount / 100);
}

/**
 * Plain decimal, no currency symbol. For inputs and for the WhatsApp message,
 * where a symbol placed by the OS locale would be inconsistent.
 */
export function formatPlain(value: Money, locale = "it-IT"): string {
  return new Intl.NumberFormat(locale, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value.amount / 100);
}

/**
 * Parses admin input such as "39,90", "39.90" or "€ 39,90" into minor units.
 *
 * Deliberately strict: it rejects anything it cannot read exactly rather than
 * guessing, because a silently misread price becomes a real charge. Ambiguity
 * around thousands separators is the reason more than two decimals is refused
 * outright.
 */
export function parseAmountToMinorUnits(input: string): number {
  const cleaned = input
    .trim()
    // Strip the currency symbol and any whitespace. `\s` already covers the
    // NO-BREAK (U+00A0) and NARROW NO-BREAK (U+202F) spaces that
    // Intl.NumberFormat emits, which is exactly what arrives when someone
    // pastes a formatted price back into the admin. No literal invisible
    // character belongs in this class - one was here, and it was unreviewable.
    .replace(/[€\s]/g, "")
    // A dot used as a thousands separator, e.g. 1.299,00
    .replace(/\.(?=\d{3}\b)/g, "")
    .replace(",", ".");

  if (!/^-?\d+(\.\d{1,2})?$/.test(cleaned)) {
    throw new MoneyError(`Cannot read "${input}" as an amount. Use a form like 39,90.`);
  }

  // The regex above guarantees at least one segment, but noUncheckedIndexedAccess
  // does not know that, and defaulting is cheaper than asserting.
  const [whole = "0", fraction = ""] = cleaned.split(".");
  const negative = whole.startsWith("-");
  const wholeDigits = negative ? whole.slice(1) : whole;
  const minor = Number(wholeDigits) * 100 + Number(fraction.padEnd(2, "0"));
  return negative ? -minor : minor;
}
