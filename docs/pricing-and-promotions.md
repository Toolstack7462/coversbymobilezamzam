# Pricing and promotions

## Money

Integer minor units plus a currency code. `3990` `EUR` is €39,90. Never a float
(invariant 1).

Display is `it-IT`: `€ 39,90` — comma decimal separator, dot thousands. Prices
use tabular numerals so a column of them aligns.

---

## Price layers

| Layer                 | Purpose                                |
| --------------------- | -------------------------------------- |
| Base price            | The catalogue price                    |
| Online price          | Overrides base for web sales           |
| In-store price        | Overrides base at the counter          |
| Promotion price       | Time-bounded, scheduled                |
| Customer-group price  | Structure exists; unused in Phase 1    |
| Prior reference price | The genuine 30-day low, for compliance |
| Cost price            | Restricted to authorised staff         |

Online and in-store prices can legitimately differ — different overheads. The
system records which channel a price applies to rather than pretending there is
one number.

**Cost price is permission-gated.** Margin is not something every staff member
needs, and it must never reach the storefront.

---

## Resolution

`app/domain/pricing/resolve.ts`, pure:

1. An active promotion for this variant and channel, if one is in window.
2. The channel price (online or in-store).
3. The base price.

Evaluated **server-side, at order creation, inside the transaction**. A price
shown ten minutes ago is a display; the price charged is re-read (invariant 2).

If the price changed between rendering the cart and confirming, the cart says so
explicitly rather than silently charging the new amount.

---

## Price history

`price_history` is append-oriented: old price, new price, channel, effective
from, effective to, reason, changed by, timestamp.

This exists for three reasons, and only one is operational:

- **Compliance.** D.Lgs. 84/2022 requires an announced reduction to reference the
  lowest price of the previous 30 days. Without history that figure cannot be
  evidenced.
- **Disputes.** "It said €29,90 yesterday" is answerable.
- **Audit.** Price changes are sensitive mutations (invariant 8).

---

## Discount display — the rule that will feel restrictive

| Data present                             | Customer sees                                                        |
| ---------------------------------------- | -------------------------------------------------------------------- |
| Current price only                       | The price                                                            |
| Current + previous reference price       | Strikethrough. **No percentage.**                                    |
| Current + previous + recorded 30-day low | Strikethrough, percentage, **and the 30-day reference price stated** |

**A percentage never renders without a recorded prior price.** Not "computed from
compare-at", not "probably fine". The domain function returns no percentage when
the data is not there, so no template can invent one.

This is Italian law implementing the EU Price Indication Directive, and it is
also the difference between a discount that is true and one that is decoration.

`app/domain/pricing/prior-price.ts` computes the 30-day low from
`price_history`, so the compliant figure is derived from records rather than
typed in by hand.

---

## Promotions

Fields: name, type (percentage or fixed), value, start, end, channel, priority,
stackable, minimum quantity, minimum order value, status.

Rules:

- Server-evaluated only.
- A promotion outside its window does not apply, whatever any cached page says.
- Non-stackable promotions resolve by priority, deterministically.
- Timestamps stored UTC, authored in `Europe/Rome` (invariant 10). A promotion
  ending "at midnight" must end at Italian midnight.
- Scheduling never rewrites the base price — it layers over it, so the promotion
  ending restores the original automatically.

## Coupons

Code, type, value, usage limit, per-customer limit, window, minimum order,
applicable products, status. Redemptions recorded in `coupon_redemptions`.

Validation is server-side and atomic: the usage limit is enforced by conditional
write, so two simultaneous redemptions of a last-use coupon cannot both succeed —
the same problem as inventory, and the same solution.

---

## VAT

Italian VAT is included in displayed prices, as required for consumer sales. The
order stores the tax component of the total explicitly so an invoice can be
produced without recomputing from a rate that may have changed.

**The rate is configuration, not a constant.** Rates change; a hardcoded `0.22`
would silently be wrong afterwards.

Invoicing and fiscal obligations are a _commercialista_ matter — see
`docs/legal-review-checklist.md`.

---

## What is structurally impossible

- A percentage saving with no prior price.
- A strikethrough with no genuine previous price.
- "Was €X" where €X was never charged.
- A promotion appearing to run outside its window.
- A countdown on a discount.

Each is prevented in the domain layer, not by convention in a template
(invariant 11).
