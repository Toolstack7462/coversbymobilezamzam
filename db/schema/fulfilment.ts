import { sqliteTable, text, integer, index, uniqueIndex } from "drizzle-orm/sqlite-core";
import { pk, ts, bool, money, currency, stamps, archivable, sortOrder } from "./_shared";
import { orders, orderItems } from "./orders";
import { inventoryLocations } from "./inventory";

/**
 * Fulfilment and returns.
 *
 * Fulfilment status is separate from payment status: pay-at-pickup is fulfilled
 * before it is paid, and a shipped order was often paid weeks earlier.
 */

export const shippingMethods = sqliteTable(
  "shipping_methods",
  {
    id: pk(),
    code: text("code").notNull(),
    nameIt: text("name_it").notNull(),
    nameEn: text("name_en").notNull(),
    descriptionIt: text("description_it"),
    descriptionEn: text("description_en"),
    /** flat_rate | free_over_threshold | local_delivery | pickup */
    rateType: text("rate_type").notNull(),
    /** Ships disabled - no shipping price is shown before it is configured. */
    active: bool("active").notNull().default(false),
    sortOrder: sortOrder(),
    /**
     * Dispatch policy text, e.g. "spedizione in 1-2 giorni lavorativi".
     * NEVER an arrival guarantee - nothing here can know when a parcel lands.
     */
    dispatchNoteIt: text("dispatch_note_it"),
    dispatchNoteEn: text("dispatch_note_en"),
    ...stamps(),
    ...archivable(),
  },
  (t) => [uniqueIndex("shipping_methods_code_unique").on(t.code)],
);

export const shippingZones = sqliteTable(
  "shipping_zones",
  {
    id: pk(),
    code: text("code").notNull(),
    name: text("name").notNull(),
    /** JSON array of country codes. */
    countries: text("countries").notNull(),
    /** Optional JSON array of postcode prefixes, for local delivery. */
    postcodePrefixes: text("postcode_prefixes"),
    sortOrder: sortOrder(),
    ...stamps(),
  },
  (t) => [uniqueIndex("shipping_zones_code_unique").on(t.code)],
);

export const shippingRates = sqliteTable(
  "shipping_rates",
  {
    id: pk(),
    shippingMethodId: text("shipping_method_id")
      .notNull()
      .references(() => shippingMethods.id, { onDelete: "cascade" }),
    shippingZoneId: text("shipping_zone_id")
      .notNull()
      .references(() => shippingZones.id, { onDelete: "restrict" }),
    amount: money("amount").notNull(),
    currency: currency(),
    /** Order subtotal at or above which shipping becomes free. Null = never. */
    freeOverAmount: money("free_over_amount"),
    minWeightGrams: integer("min_weight_grams"),
    maxWeightGrams: integer("max_weight_grams"),
    ...stamps(),
  },
  (t) => [uniqueIndex("shipping_rates_unique").on(t.shippingMethodId, t.shippingZoneId)],
);

export const fulfilments = sqliteTable(
  "fulfilments",
  {
    id: pk(),
    orderId: text("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "cascade" }),
    /**
     * pending | awaiting_stock | picking | packed | ready_for_pickup |
     * handed_to_carrier | in_transit | delivered | collected | not_collected |
     * cancelled | returned_to_sender
     */
    status: text("status").notNull().default("pending"),
    /** shipping | pickup */
    fulfilmentType: text("fulfilment_type").notNull(),
    locationId: text("location_id").references(() => inventoryLocations.id, {
      onDelete: "restrict",
    }),
    preparedBy: text("prepared_by"),
    ...stamps(),
  },
  (t) => [
    index("fulfilments_order_idx").on(t.orderId),
    index("fulfilments_status_idx").on(t.status),
  ],
);

/** Partial fulfilment: several fulfilments, each over a subset of lines. */
export const fulfilmentItems = sqliteTable(
  "fulfilment_items",
  {
    id: pk(),
    fulfilmentId: text("fulfilment_id")
      .notNull()
      .references(() => fulfilments.id, { onDelete: "cascade" }),
    orderItemId: text("order_item_id")
      .notNull()
      .references(() => orderItems.id, { onDelete: "restrict" }),
    quantity: integer("quantity").notNull(),
  },
  (t) => [uniqueIndex("fulfilment_items_unique").on(t.fulfilmentId, t.orderItemId)],
);

export const shipments = sqliteTable(
  "shipments",
  {
    id: pk(),
    fulfilmentId: text("fulfilment_id")
      .notNull()
      .references(() => fulfilments.id, { onDelete: "cascade" }),
    /** Free text - no courier integration in Phase 1. */
    carrierName: text("carrier_name"),
    trackingNumber: text("tracking_number"),
    trackingUrl: text("tracking_url"),
    shippedAt: ts("shipped_at"),
    deliveredAt: ts("delivered_at"),
    ...stamps(),
  },
  (t) => [index("shipments_fulfilment_idx").on(t.fulfilmentId)],
);

/**
 * `ready_at` is set by a staff member who physically put the item aside. It is
 * never inferred from online stock, and the site never says "ready today"
 * speculatively (invariant 11).
 */
export const pickupOrders = sqliteTable(
  "pickup_orders",
  {
    id: pk(),
    orderId: text("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "cascade" }),
    locationId: text("location_id")
      .notNull()
      .references(() => inventoryLocations.id, { onDelete: "restrict" }),
    readyAt: ts("ready_at"),
    readyBy: text("ready_by"),
    collectedAt: ts("collected_at"),
    collectedBy: text("collected_by"),
    /** Who came to collect, when staff recorded it. */
    collectedByName: text("collected_by_name"),
    pickupDeadline: ts("pickup_deadline"),
    ...stamps(),
  },
  (t) => [uniqueIndex("pickup_orders_order_unique").on(t.orderId)],
);

export const fulfilmentStatusHistory = sqliteTable(
  "fulfilment_status_history",
  {
    id: pk(),
    fulfilmentId: text("fulfilment_id")
      .notNull()
      .references(() => fulfilments.id, { onDelete: "cascade" }),
    fromStatus: text("from_status"),
    toStatus: text("to_status").notNull(),
    reason: text("reason"),
    actor: text("actor").notNull(),
    createdAt: ts("created_at").notNull(),
  },
  (t) => [index("fulfilment_status_history_idx").on(t.fulfilmentId, t.createdAt)],
);

// ── Returns ──────────────────────────────────────────────────────────────────

export const returnRequests = sqliteTable(
  "return_requests",
  {
    id: pk(),
    orderId: text("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "restrict" }),
    reference: text("reference").notNull(),
    /** requested | approved | rejected | received | completed | cancelled */
    status: text("status").notNull().default("requested"),
    /**
     * withdrawal | defective | wrong_item | not_compatible | other
     *
     * `not_compatible` is tracked deliberately: a cluster of these points at a
     * wrong compatibility record, which is fixable at the source.
     */
    reasonCode: text("reason_code").notNull(),
    reasonNote: text("reason_note"),
    /** 14-day right of withdrawal under the Codice del Consumo. */
    isWithdrawal: bool("is_withdrawal").notNull().default(false),
    requestedAt: ts("requested_at").notNull(),
    approvedBy: text("approved_by"),
    approvedAt: ts("approved_at"),
    receivedAt: ts("received_at"),
    ...stamps(),
  },
  (t) => [
    uniqueIndex("return_requests_reference_unique").on(t.reference),
    index("return_requests_order_idx").on(t.orderId),
    index("return_requests_status_idx").on(t.status, t.requestedAt),
  ],
);

export const returnItems = sqliteTable(
  "return_items",
  {
    id: pk(),
    returnRequestId: text("return_request_id")
      .notNull()
      .references(() => returnRequests.id, { onDelete: "cascade" }),
    orderItemId: text("order_item_id")
      .notNull()
      .references(() => orderItems.id, { onDelete: "restrict" }),
    quantity: integer("quantity").notNull(),
    /** resellable | damaged | missing_parts | not_received */
    conditionCode: text("condition_code"),
    inspectionNote: text("inspection_note"),
  },
  (t) => [index("return_items_request_idx").on(t.returnRequestId)],
);

export const refunds = sqliteTable(
  "refunds",
  {
    id: pk(),
    orderId: text("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "restrict" }),
    returnRequestId: text("return_request_id").references(() => returnRequests.id, {
      onDelete: "set null",
    }),
    amount: money("amount").notNull(),
    currency: currency(),
    /** How the money went back. Manual, like everything else in Phase 1. */
    refundMethod: text("refund_method").notNull(),
    reference: text("reference"),
    /** pending | completed | failed */
    status: text("status").notNull().default("pending"),
    processedBy: text("processed_by"),
    processedAt: ts("processed_at"),
    note: text("note"),
    ...stamps(),
  },
  (t) => [index("refunds_order_idx").on(t.orderId)],
);

export const refundItems = sqliteTable(
  "refund_items",
  {
    id: pk(),
    refundId: text("refund_id")
      .notNull()
      .references(() => refunds.id, { onDelete: "cascade" }),
    orderItemId: text("order_item_id")
      .notNull()
      .references(() => orderItems.id, { onDelete: "restrict" }),
    quantity: integer("quantity").notNull(),
    amount: money("amount").notNull(),
  },
  (t) => [index("refund_items_refund_idx").on(t.refundId)],
);
