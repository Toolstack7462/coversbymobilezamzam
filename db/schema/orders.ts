import { sqliteTable, text, integer, index, uniqueIndex } from "drizzle-orm/sqlite-core";
import { pk, ts, bool, money, currency, stamps } from "./_shared";
import { productVariants, products } from "./catalogue";
import { deviceModels } from "./compatibility";

/**
 * Carts hold variant ids and quantities. They do NOT hold prices.
 *
 * A stored price is a price someone will eventually trust. Every render and
 * every checkout re-reads the authoritative price (invariant 2).
 */
export const carts = sqliteTable(
  "carts",
  {
    id: pk(),
    /** Signed opaque token in the cookie; this is its server-side row. */
    token: text("token").notNull(),
    userId: text("user_id"),
    /** The device the customer selected, for compatibility context. */
    deviceModelId: text("device_model_id").references(() => deviceModels.id, {
      onDelete: "set null",
    }),
    currency: currency(),
    expiresAt: ts("expires_at").notNull(),
    ...stamps(),
  },
  (t) => [
    uniqueIndex("carts_token_unique").on(t.token),
    index("carts_user_idx").on(t.userId),
    index("carts_expiry_idx").on(t.expiresAt),
  ],
);

export const cartItems = sqliteTable(
  "cart_items",
  {
    id: pk(),
    cartId: text("cart_id")
      .notNull()
      .references(() => carts.id, { onDelete: "cascade" }),
    variantId: text("variant_id")
      .notNull()
      .references(() => productVariants.id, { onDelete: "cascade" }),
    quantity: integer("quantity").notNull(),
    /** Compatibility state at the time of adding, so a change can be surfaced. */
    compatibilityAtAdd: text("compatibility_at_add"),
    ...stamps(),
  },
  (t) => [
    uniqueIndex("cart_items_unique").on(t.cartId, t.variantId),
    index("cart_items_cart_idx").on(t.cartId),
  ],
);

/**
 * Orders.
 *
 * `order_number` is public and appears in the payment causale, so it is partly
 * guessable by date. It therefore never authorises access. `tracking_token` is
 * 32 random characters and is what a customer needs to view their order.
 */
export const orders = sqliteTable(
  "orders",
  {
    id: pk(),
    /** ITA-YYYYMMDD-XXXXXX */
    orderNumber: text("order_number").notNull(),
    /** Random, non-enumerable. The only thing that grants public read access. */
    trackingToken: text("tracking_token").notNull(),
    userId: text("user_id"),

    /**
     * draft | awaiting_customer_contact | awaiting_payment |
     * payment_under_review | paid | processing | ready_for_pickup | shipped |
     * delivered | collected | cancelled | expired | return_requested |
     * returned | partially_refunded | refunded
     */
    status: text("status").notNull().default("draft"),

    customerFirstName: text("customer_first_name").notNull(),
    customerLastName: text("customer_last_name").notNull(),
    customerEmail: text("customer_email").notNull(),
    customerPhone: text("customer_phone"),
    customerWhatsapp: text("customer_whatsapp"),

    /** shipping | pickup */
    deliveryMethod: text("delivery_method").notNull(),
    shippingMethodId: text("shipping_method_id"),
    pickupLocationId: text("pickup_location_id"),

    paymentMethodId: text("payment_method_id"),

    /** The device selected when ordering. Snapshotted for support. */
    deviceModelId: text("device_model_id").references(() => deviceModels.id, {
      onDelete: "set null",
    }),

    /** Immutable totals, minor units. Recomputed server-side at creation. */
    itemSubtotal: money("item_subtotal").notNull(),
    discountTotal: money("discount_total").notNull().default(0),
    shippingTotal: money("shipping_total").notNull().default(0),
    taxTotal: money("tax_total").notNull().default(0),
    grandTotal: money("grand_total").notNull(),
    currency: currency(),

    customerNote: text("customer_note"),
    /** Which version of the terms the customer accepted. */
    termsVersionId: text("terms_version_id"),

    reservationExpiresAt: ts("reservation_expires_at"),
    placedAt: ts("placed_at"),
    cancelledAt: ts("cancelled_at"),
    ...stamps(),
  },
  (t) => [
    uniqueIndex("orders_number_unique").on(t.orderNumber),
    uniqueIndex("orders_tracking_token_unique").on(t.trackingToken),
    index("orders_status_idx").on(t.status, t.createdAt),
    index("orders_email_idx").on(t.customerEmail),
    index("orders_user_idx").on(t.userId),
    index("orders_reservation_idx").on(t.reservationExpiresAt),
  ],
);

/**
 * A snapshot of what was agreed, not a projection of the product (invariant 5).
 *
 * Nothing renders a historical order by joining to live product data. The
 * product references exist for reporting and reordering, not for display.
 */
export const orderItems = sqliteTable(
  "order_items",
  {
    id: pk(),
    orderId: text("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "cascade" }),

    /** Kept for analytics and reorder. NOT the source of the display values. */
    productId: text("product_id").references(() => products.id, { onDelete: "restrict" }),
    variantId: text("variant_id").references(() => productVariants.id, { onDelete: "restrict" }),

    // ── Snapshot columns ──────────────────────────────────────────────────
    productName: text("product_name").notNull(),
    variantLabel: text("variant_label"),
    sku: text("sku").notNull(),
    imageKey: text("image_key"),
    /** Compatibility state shown to the customer when they ordered. */
    compatibilityState: text("compatibility_state"),
    deviceModelName: text("device_model_name"),

    quantity: integer("quantity").notNull(),
    unitPrice: money("unit_price").notNull(),
    discountAmount: money("discount_amount").notNull().default(0),
    taxAmount: money("tax_amount").notNull().default(0),
    lineTotal: money("line_total").notNull(),
    currency: currency(),

    createdAt: ts("created_at").notNull(),
  },
  (t) => [index("order_items_order_idx").on(t.orderId)],
);

/**
 * Address snapshots. Customers move house; a delivered order must still show
 * where it actually went.
 */
export const orderAddresses = sqliteTable(
  "order_addresses",
  {
    id: pk(),
    orderId: text("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "cascade" }),
    /** shipping | billing */
    addressType: text("address_type").notNull(),
    firstName: text("first_name").notNull(),
    lastName: text("last_name").notNull(),
    street: text("street").notNull(),
    streetNumber: text("street_number"),
    postcode: text("postcode").notNull(),
    city: text("city").notNull(),
    province: text("province"),
    country: text("country").notNull().default("IT"),
    phone: text("phone"),
    note: text("note"),
    createdAt: ts("created_at").notNull(),
  },
  (t) => [uniqueIndex("order_addresses_unique").on(t.orderId, t.addressType)],
);

export const orderStatusHistory = sqliteTable(
  "order_status_history",
  {
    id: pk(),
    orderId: text("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "cascade" }),
    fromStatus: text("from_status"),
    toStatus: text("to_status").notNull(),
    reason: text("reason"),
    /** Staff user id, or "system" for the cron sweeper. */
    actor: text("actor").notNull(),
    createdAt: ts("created_at").notNull(),
  },
  (t) => [index("order_status_history_order_idx").on(t.orderId, t.createdAt)],
);

export const orderNotes = sqliteTable(
  "order_notes",
  {
    id: pk(),
    orderId: text("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "cascade" }),
    body: text("body").notNull(),
    /**
     * Checked in the QUERY, never only in the template. A note written for staff
     * must not be one CSS mistake away from the customer reading it.
     */
    customerVisible: bool("customer_visible").notNull().default(false),
    authorId: text("author_id"),
    createdAt: ts("created_at").notNull(),
  },
  (t) => [index("order_notes_order_idx").on(t.orderId, t.customerVisible)],
);

/** The customer-facing timeline. */
export const orderEvents = sqliteTable(
  "order_events",
  {
    id: pk(),
    orderId: text("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "cascade" }),
    eventType: text("event_type").notNull(),
    /** JSON payload, rendered through locale strings rather than stored prose. */
    payload: text("payload"),
    customerVisible: bool("customer_visible").notNull().default(true),
    createdAt: ts("created_at").notNull(),
  },
  (t) => [index("order_events_order_idx").on(t.orderId, t.createdAt)],
);
