import { sqliteTable, text, integer, index, uniqueIndex } from "drizzle-orm/sqlite-core";
import { pk, ts, bool, money, currency, stamps, archivable, sortOrder } from "./_shared";
import { products, productVariants } from "./catalogue";

/**
 * Pricing. Every amount is integer minor units with a currency (invariant 1).
 *
 * There is no float column here and there never will be: accumulate a few line
 * items, apply a percentage, and floating point drifts by a cent - which is the
 * difference between a transfer reconciling and a customer being told they
 * underpaid.
 */

export const priceLists = sqliteTable(
  "price_lists",
  {
    id: pk(),
    code: text("code").notNull(),
    name: text("name").notNull(),
    /** online | in_store | customer_group */
    channel: text("channel").notNull(),
    isDefault: bool("is_default").notNull().default(false),
    active: bool("active").notNull().default(true),
    ...stamps(),
  },
  (t) => [uniqueIndex("price_lists_code_unique").on(t.code)],
);

export const variantPrices = sqliteTable(
  "variant_prices",
  {
    id: pk(),
    variantId: text("variant_id")
      .notNull()
      .references(() => productVariants.id, { onDelete: "cascade" }),
    priceListId: text("price_list_id")
      .notNull()
      .references(() => priceLists.id, { onDelete: "restrict" }),
    amount: money("amount").notNull(),
    currency: currency(),
    /**
     * The genuine lowest price of the previous 30 days, in minor units.
     *
     * A percentage saving renders ONLY when this is present (D.Lgs. 84/2022).
     * Derived from price_history rather than typed by hand, so it is evidenced.
     */
    priorPrice30d: money("prior_price_30d"),
    priorPriceReferenceDate: ts("prior_price_reference_date"),
    /** Permission-gated. Never reaches the storefront. */
    costPrice: money("cost_price"),
    ...stamps(),
  },
  (t) => [
    uniqueIndex("variant_prices_unique").on(t.variantId, t.priceListId),
    index("variant_prices_variant_idx").on(t.variantId),
  ],
);

/**
 * Append-oriented. This is what makes the 30-day figure evidenced rather than
 * asserted, and it is the only way to answer "it said 29,90 yesterday".
 */
export const priceHistory = sqliteTable(
  "price_history",
  {
    id: pk(),
    variantId: text("variant_id")
      .notNull()
      .references(() => productVariants.id, { onDelete: "cascade" }),
    priceListId: text("price_list_id")
      .notNull()
      .references(() => priceLists.id, { onDelete: "restrict" }),
    oldAmount: money("old_amount"),
    newAmount: money("new_amount").notNull(),
    currency: currency(),
    channel: text("channel").notNull(),
    effectiveFrom: ts("effective_from").notNull(),
    effectiveTo: ts("effective_to"),
    reason: text("reason"),
    changedBy: text("changed_by"),
    createdAt: ts("created_at").notNull(),
  },
  (t) => [
    // The 30-day lowest-price query walks exactly this.
    index("price_history_variant_idx").on(t.variantId, t.effectiveFrom),
  ],
);

export const promotions = sqliteTable(
  "promotions",
  {
    id: pk(),
    code: text("code").notNull(),
    name: text("name").notNull(),
    /** percentage | fixed_amount */
    discountType: text("discount_type").notNull(),
    /** Basis points for percentage (1000 = 10%), minor units for fixed. */
    discountValue: integer("discount_value").notNull(),
    channel: text("channel").notNull().default("online"),
    startsAt: ts("starts_at").notNull(),
    endsAt: ts("ends_at"),
    /** Higher wins when two non-stackable promotions both apply. */
    priority: integer("priority").notNull().default(0),
    stackable: bool("stackable").notNull().default(false),
    minQuantity: integer("min_quantity"),
    minOrderAmount: money("min_order_amount"),
    active: bool("active").notNull().default(true),
    ...stamps(),
    ...archivable(),
  },
  (t) => [
    uniqueIndex("promotions_code_unique").on(t.code),
    index("promotions_window_idx").on(t.active, t.startsAt, t.endsAt),
  ],
);

export const promotionProducts = sqliteTable(
  "promotion_products",
  {
    id: pk(),
    promotionId: text("promotion_id")
      .notNull()
      .references(() => promotions.id, { onDelete: "cascade" }),
    productId: text("product_id").references(() => products.id, { onDelete: "cascade" }),
    variantId: text("variant_id").references(() => productVariants.id, { onDelete: "cascade" }),
  },
  (t) => [index("promotion_products_promotion_idx").on(t.promotionId)],
);

export const coupons = sqliteTable(
  "coupons",
  {
    id: pk(),
    code: text("code").notNull(),
    discountType: text("discount_type").notNull(),
    discountValue: integer("discount_value").notNull(),
    /** Null means unlimited. Enforced by conditional write, not by a read. */
    usageLimit: integer("usage_limit"),
    usageCount: integer("usage_count").notNull().default(0),
    perCustomerLimit: integer("per_customer_limit"),
    startsAt: ts("starts_at").notNull(),
    endsAt: ts("ends_at"),
    minOrderAmount: money("min_order_amount"),
    active: bool("active").notNull().default(true),
    sortOrder: sortOrder(),
    ...stamps(),
    ...archivable(),
  },
  (t) => [uniqueIndex("coupons_code_unique").on(t.code)],
);

export const couponRedemptions = sqliteTable(
  "coupon_redemptions",
  {
    id: pk(),
    couponId: text("coupon_id")
      .notNull()
      .references(() => coupons.id, { onDelete: "restrict" }),
    orderId: text("order_id").notNull(),
    customerEmail: text("customer_email"),
    amountDiscounted: money("amount_discounted").notNull(),
    currency: currency(),
    createdAt: ts("created_at").notNull(),
  },
  (t) => [
    uniqueIndex("coupon_redemptions_order_unique").on(t.couponId, t.orderId),
    index("coupon_redemptions_customer_idx").on(t.couponId, t.customerEmail),
  ],
);
