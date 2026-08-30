import { describe, it, expect } from "vitest";
import { money } from "~/domain/pricing/money";
import {
  discountDisplay,
  resolvePrice,
  applyDiscount,
  lowestPriceInWindow,
  type PriceCandidate,
} from "~/domain/pricing/resolve";

/**
 * Invariant 11 and D.Lgs. 84/2022.
 *
 * The rule under test: a percentage saving renders ONLY from a recorded prior
 * price. These tests exist so a future "helpful" change that computes a
 * percentage from a compare-at figure fails loudly.
 */

describe("discount display", () => {
  it("shows nothing when there is no previous price", () => {
    const result = discountDisplay({ currentPrice: money(3990) });
    expect(result.showStrikethrough).toBe(false);
    expect(result.percentage).toBeNull();
  });

  it("shows a strikethrough but NO percentage without a 30-day reference", () => {
    // The case that matters. A previous price is a merchandising figure; it is
    // not evidence of the lowest price in the last 30 days.
    const result = discountDisplay({
      currentPrice: money(2990),
      previousPrice: money(3990),
    });
    expect(result.showStrikethrough).toBe(true);
    expect(result.previousPrice?.amount).toBe(3990);
    expect(result.percentage).toBeNull();
  });

  it("shows a percentage only once a 30-day reference price exists", () => {
    const result = discountDisplay({
      currentPrice: money(2990),
      previousPrice: money(3990),
      priorPrice30d: money(3990),
      priorPriceReferenceDate: 1_756_000_000_000,
    });
    expect(result.showStrikethrough).toBe(true);
    expect(result.percentage).toBe(25);
    expect(result.priorPrice30d?.amount).toBe(3990);
    expect(result.priorPriceReferenceDate).toBe(1_756_000_000_000);
  });

  it("floors the percentage so a saving is never overstated", () => {
    // 24,6% is announced as 24%. Rounding up would overstate the reduction,
    // which is precisely the claim the law constrains.
    const result = discountDisplay({
      currentPrice: money(3010),
      previousPrice: money(3990),
      priorPrice30d: money(3990),
    });
    expect(result.percentage).toBe(24);
  });

  it("shows nothing when the previous price is not actually higher", () => {
    expect(
      discountDisplay({ currentPrice: money(3990), previousPrice: money(3990) }).showStrikethrough,
    ).toBe(false);
    expect(
      discountDisplay({ currentPrice: money(3990), previousPrice: money(2990) }).showStrikethrough,
    ).toBe(false);
  });

  it("withholds the percentage when the 30-day reference is not higher", () => {
    // The price was already this low within the window, so there is no
    // announceable reduction against it.
    const result = discountDisplay({
      currentPrice: money(2990),
      previousPrice: money(3990),
      priorPrice30d: money(2990),
    });
    expect(result.showStrikethrough).toBe(true);
    expect(result.percentage).toBeNull();
  });

  it("suppresses a sub-1% saving rather than displaying 0%", () => {
    const result = discountDisplay({
      currentPrice: money(3980),
      previousPrice: money(3990),
      priorPrice30d: money(3990),
    });
    expect(result.percentage).toBeNull();
  });
});

describe("price resolution", () => {
  const NOW = 1_756_000_000_000;
  const base: PriceCandidate = {
    amount: money(3990),
    channel: "online",
    isPromotion: false,
  };

  it("returns the base price when no promotion is active", () => {
    const result = resolvePrice([base], "online", NOW);
    expect(result?.price.amount).toBe(3990);
    expect(result?.isDiscounted).toBe(false);
  });

  it("applies a promotion inside its window", () => {
    const promo: PriceCandidate = {
      amount: money(2990),
      channel: "online",
      isPromotion: true,
      promotionId: "promo_1",
      startsAt: NOW - 1000,
      endsAt: NOW + 1000,
    };
    const result = resolvePrice([base, promo], "online", NOW);
    expect(result?.price.amount).toBe(2990);
    expect(result?.appliedPromotionId).toBe("promo_1");
    expect(result?.isDiscounted).toBe(true);
  });

  it("ignores a promotion that has not started", () => {
    const result = resolvePrice(
      [base, { ...base, amount: money(1), isPromotion: true, startsAt: NOW + 5000 }],
      "online",
      NOW,
    );
    expect(result?.price.amount).toBe(3990);
  });

  it("ignores a promotion that has ended, whatever a cached page says", () => {
    const result = resolvePrice(
      [
        base,
        { ...base, amount: money(1), isPromotion: true, startsAt: NOW - 5000, endsAt: NOW - 1 },
      ],
      "online",
      NOW,
    );
    expect(result?.price.amount).toBe(3990);
  });

  it("resolves competing promotions by priority, deterministically", () => {
    const result = resolvePrice(
      [
        base,
        {
          ...base,
          amount: money(3490),
          isPromotion: true,
          promotionId: "low",
          promotionPriority: 1,
          startsAt: NOW - 1,
        },
        {
          ...base,
          amount: money(3690),
          isPromotion: true,
          promotionId: "high",
          promotionPriority: 9,
          startsAt: NOW - 1,
        },
      ],
      "online",
      NOW,
    );
    expect(result?.appliedPromotionId).toBe("high");
  });

  it("keeps channels separate", () => {
    const inStore: PriceCandidate = { ...base, amount: money(4490), channel: "in_store" };
    expect(resolvePrice([base, inStore], "in_store", NOW)?.price.amount).toBe(4490);
    expect(resolvePrice([base, inStore], "online", NOW)?.price.amount).toBe(3990);
  });

  it("returns null when the channel has no base price", () => {
    expect(resolvePrice([base], "in_store", NOW)).toBeNull();
  });
});

describe("applyDiscount", () => {
  it("applies a percentage in basis points", () => {
    expect(applyDiscount(money(4000), "percentage", 2500).amount).toBe(3000);
  });

  it("applies a fixed amount", () => {
    expect(applyDiscount(money(4000), "fixed_amount", 500).amount).toBe(3500);
  });

  it("never produces a negative price", () => {
    expect(applyDiscount(money(1000), "fixed_amount", 5000).amount).toBe(0);
  });
});

describe("lowestPriceInWindow", () => {
  const NOW = 1_756_000_000_000;
  const DAY = 24 * 60 * 60 * 1000;

  it("returns null with no history, so no percentage is shown", () => {
    expect(lowestPriceInWindow([], NOW)).toBeNull();
  });

  it("finds the lowest price inside the window", () => {
    const result = lowestPriceInWindow(
      [
        { amount: money(3990), effectiveFrom: NOW - 40 * DAY, effectiveTo: NOW - 20 * DAY },
        { amount: money(3490), effectiveFrom: NOW - 20 * DAY, effectiveTo: NOW - 5 * DAY },
        { amount: money(3990), effectiveFrom: NOW - 5 * DAY, effectiveTo: null },
      ],
      NOW,
    );
    expect(result?.amount).toBe(3490);
  });

  it("ignores prices that ended before the window opened", () => {
    const result = lowestPriceInWindow(
      [
        { amount: money(999), effectiveFrom: NOW - 90 * DAY, effectiveTo: NOW - 60 * DAY },
        { amount: money(3990), effectiveFrom: NOW - 10 * DAY, effectiveTo: null },
      ],
      NOW,
    );
    expect(result?.amount).toBe(3990);
  });

  it("includes a price that started before the window but ran into it", () => {
    const result = lowestPriceInWindow(
      [{ amount: money(2990), effectiveFrom: NOW - 60 * DAY, effectiveTo: NOW - 10 * DAY }],
      NOW,
    );
    expect(result?.amount).toBe(2990);
  });
});
