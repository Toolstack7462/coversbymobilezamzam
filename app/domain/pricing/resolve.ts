import { type Money, money, percentageOf, subtract, clampToZero, compare } from "./money";

/**
 * Price resolution and discount display (invariant 11, D.Lgs. 84/2022).
 *
 * The rule that will feel restrictive: a percentage saving renders ONLY from a
 * recorded prior price. Not computed from a compare-at figure, not "probably
 * fine". This function returns no percentage when the data is absent, so no
 * template downstream is able to invent one.
 */

export type PriceChannel = "online" | "in_store";

export interface PriceCandidate {
  readonly amount: Money;
  readonly channel: PriceChannel;
  readonly isPromotion: boolean;
  readonly promotionId?: string;
  readonly promotionPriority?: number;
  readonly startsAt?: number;
  readonly endsAt?: number | null;
}

export interface PriceResolution {
  readonly price: Money;
  readonly basePrice: Money;
  readonly appliedPromotionId: string | null;
  readonly isDiscounted: boolean;
}

/**
 * @param now - epoch ms from the Clock port. A promotion outside its window
 *   does not apply, whatever a cached page says.
 */
export function resolvePrice(
  candidates: readonly PriceCandidate[],
  channel: PriceChannel,
  now: number,
): PriceResolution | null {
  const forChannel = candidates.filter((c) => c.channel === channel);
  const base = forChannel.find((c) => !c.isPromotion);
  if (!base) return null;

  const activePromotions = forChannel
    .filter((c) => c.isPromotion)
    .filter((c) => (c.startsAt ?? 0) <= now)
    .filter((c) => c.endsAt == null || c.endsAt > now)
    // Highest priority wins; a price tie breaks toward the cheaper one so the
    // resolution is deterministic rather than dependent on row order.
    .sort(
      (a, b) =>
        (b.promotionPriority ?? 0) - (a.promotionPriority ?? 0) || compare(a.amount, b.amount),
    );

  const winner = activePromotions[0];
  if (!winner) {
    return {
      price: base.amount,
      basePrice: base.amount,
      appliedPromotionId: null,
      isDiscounted: false,
    };
  }

  return {
    price: winner.amount,
    basePrice: base.amount,
    appliedPromotionId: winner.promotionId ?? null,
    isDiscounted: compare(winner.amount, base.amount) === -1,
  };
}

// ── Discount display ─────────────────────────────────────────────────────────

export interface DiscountDisplayInput {
  readonly currentPrice: Money;
  /** The previous price to strike through, if there genuinely was one. */
  readonly previousPrice?: Money | null;
  /**
   * The lowest price actually applied in the previous 30 days, derived from
   * price_history. Required before any percentage may be shown.
   */
  readonly priorPrice30d?: Money | null;
  readonly priorPriceReferenceDate?: number | null;
}

export interface DiscountDisplay {
  readonly showStrikethrough: boolean;
  readonly previousPrice: Money | null;
  /** Whole percent, e.g. 25 for "Risparmi il 25%". Null means show nothing. */
  readonly percentage: number | null;
  readonly priorPrice30d: Money | null;
  readonly priorPriceReferenceDate: number | null;
}

const NOTHING: DiscountDisplay = {
  showStrikethrough: false,
  previousPrice: null,
  percentage: null,
  priorPrice30d: null,
  priorPriceReferenceDate: null,
};

/**
 * Three cases, deliberately:
 *
 * - current only                     -> the price
 * - current + previous               -> strikethrough, NO percentage
 * - current + previous + 30-day low  -> strikethrough, percentage, and the
 *                                       reference price stated
 *
 * The middle case is the one that matters. A previous price is a merchandising
 * figure; it is not evidence of the lowest price in the last 30 days, and
 * Italian law requires an announced reduction to reference that figure.
 */
export function discountDisplay(input: DiscountDisplayInput): DiscountDisplay {
  const { currentPrice, previousPrice, priorPrice30d, priorPriceReferenceDate } = input;

  if (!previousPrice) return NOTHING;
  if (compare(previousPrice, currentPrice) !== 1) return NOTHING;

  const base: DiscountDisplay = {
    showStrikethrough: true,
    previousPrice,
    percentage: null,
    priorPrice30d: null,
    priorPriceReferenceDate: null,
  };

  if (!priorPrice30d) return base;
  // A "reduction" against a reference price that is not higher is not a
  // reduction, so no percentage is claimed.
  if (compare(priorPrice30d, currentPrice) !== 1) return base;

  const saving = subtract(priorPrice30d, currentPrice);
  // Floor, not round: 24,6% is announced as 24%. Rounding up would overstate
  // the saving, which is precisely the claim the law constrains.
  const percentage = Math.floor((saving.amount / priorPrice30d.amount) * 100);
  if (percentage < 1) return base;

  return {
    showStrikethrough: true,
    previousPrice,
    percentage,
    priorPrice30d,
    priorPriceReferenceDate: priorPriceReferenceDate ?? null,
  };
}

// ── Promotion arithmetic ─────────────────────────────────────────────────────

export type DiscountType = "percentage" | "fixed_amount";

/**
 * @param value - basis points for percentage (1000 = 10%), minor units for fixed
 */
export function applyDiscount(price: Money, type: DiscountType, value: number): Money {
  if (type === "percentage") {
    return clampToZero(subtract(price, percentageOf(price, value)));
  }
  return clampToZero(subtract(price, money(value, price.currency)));
}

// ── 30-day prior price ───────────────────────────────────────────────────────

export interface PricePoint {
  readonly amount: Money;
  readonly effectiveFrom: number;
  readonly effectiveTo: number | null;
}

/**
 * The lowest price actually applied in the 30 days before `now`.
 *
 * Derived from price_history rather than typed by hand, so the compliance figure
 * is evidenced by records rather than asserted by whoever set up the promotion.
 * Returns null when there is no history covering the window - and null means no
 * percentage is displayed at all.
 */
export function lowestPriceInWindow(
  history: readonly PricePoint[],
  now: number,
  windowDays = 30,
): Money | null {
  const windowStart = now - windowDays * 24 * 60 * 60 * 1000;

  const overlapping = history.filter(
    (p) => p.effectiveFrom < now && (p.effectiveTo == null || p.effectiveTo > windowStart),
  );
  if (overlapping.length === 0) return null;

  return overlapping.reduce<Money>(
    (lowest, point) => (compare(point.amount, lowest) === -1 ? point.amount : lowest),
    overlapping[0]!.amount,
  );
}
