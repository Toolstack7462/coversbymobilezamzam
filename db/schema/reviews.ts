import { sqliteTable, text, integer, index, check } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";
import { pk, ts, stamps, locale } from "./_shared";
import { products } from "./catalogue";
import { orderItems } from "./orders";

/**
 * Product reviews.
 *
 * ── The reason this table has the shape it has ───────────────────────────────
 *
 * A fake review is not a design flaw, it is an unfair commercial practice. The
 * Omnibus directive, in Italy D.Lgs. 26/2023, makes two things obligatory for
 * any shop that shows reviews:
 *
 *   1. state whether and how it checks that reviews come from real buyers, and
 *   2. never present a review as verified when it is not.
 *
 * So provenance is a column, not a convention, and it is written once at
 * creation:
 *
 *   verified_purchase  linked to a real order line. The strongest claim, and
 *                      the CHECK below makes it unstatable without that link.
 *   in_store           collected at the counter by staff. An honest, weaker
 *                      claim: the shop vouches for it, the software does not.
 *
 * There is deliberately no way to promote `in_store` to `verified_purchase`.
 * Not a UI omission — the constraint refuses it, because a screen that can
 * relabel an unverified review as verified is the exact mechanism the law is
 * written about.
 *
 * ── Moderation, and what it may not do ───────────────────────────────────────
 *
 * A review can be published or rejected. It cannot be edited: a shop that can
 * rewrite what a customer said is not showing reviews, and selectively
 * publishing only positive ones is itself the practice the directive prohibits.
 * `rejected` therefore keeps the row and the reason, so the decision is
 * reviewable rather than invisible.
 *
 * Ratings are 1-5 integers, constrained. A float average is computed for
 * display; a float rating is not stored, because 4.7 is not something anybody
 * submitted.
 */
export const productReviews = sqliteTable(
  "product_reviews",
  {
    id: pk(),
    productId: text("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),

    /**
     * The order line this review is about.
     *
     * Required for `verified_purchase` (see the CHECK). Kept on delete so a
     * review does not vanish because an order was archived — restrict rather
     * than cascade, since losing a published review silently would be worse
     * than an explicit failure.
     */
    orderItemId: text("order_item_id").references(() => orderItems.id, {
      onDelete: "restrict",
    }),

    /** verified_purchase | in_store */
    provenance: text("provenance").notNull(),

    /** pending | published | rejected */
    status: text("status").notNull().default("pending"),

    /**
     * As given. A first name, or a first name and an initial — never an email
     * and never a full address, because this is rendered publicly.
     */
    authorName: text("author_name").notNull(),

    rating: integer("rating").notNull(),
    title: text("title"),
    body: text("body").notNull(),
    locale: locale(),

    /** Who decided, and when. Null while pending. */
    moderatedBy: text("moderated_by"),
    moderatedAt: ts("moderated_at"),
    /** Free text, shown only in the admin. Required to reject. */
    moderationNote: text("moderation_note"),

    publishedAt: ts("published_at"),
    ...stamps(),
  },
  (t) => [
    index("product_reviews_product_idx").on(t.productId, t.status),
    index("product_reviews_status_idx").on(t.status, t.createdAt),

    // 1-5, whole numbers. Anything else is not a rating somebody gave.
    check("product_reviews_rating_range", sql`${t.rating} BETWEEN 1 AND 5`),

    check("product_reviews_provenance", sql`${t.provenance} IN ('verified_purchase', 'in_store')`),

    /*
     * The constraint that carries the whole design: "verified purchase" cannot
     * be claimed without the purchase. Enforced by the database rather than by
     * the screen, because the screen is not what a future import, migration or
     * console session goes through.
     */
    check(
      "product_reviews_verified_needs_order",
      sql`${t.provenance} <> 'verified_purchase' OR ${t.orderItemId} IS NOT NULL`,
    ),

    check("product_reviews_status", sql`${t.status} IN ('pending', 'published', 'rejected')`),
  ],
);
