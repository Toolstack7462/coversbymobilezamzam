import { sqliteTable, text, integer, index, uniqueIndex, check } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";
import { pk, ts, bool, stamps, archivable, sortOrder } from "./_shared";
import { productVariants } from "./catalogue";

/**
 * Inventory as a ledger.
 *
 * inventory_levels holds the counters that serve reads. stock_movements and
 * stock_reservations hold the events that explain them. On drift the ledger
 * wins, because a counter cannot say when or why it changed.
 *
 * available = on_hand - reserved, and only `available` is checked against a
 * purchase.
 */

export const inventoryLocations = sqliteTable(
  "inventory_locations",
  {
    id: pk(),
    code: text("code").notNull(),
    name: text("name").notNull(),
    /** shop | online | returns | quarantine | incoming */
    locationType: text("location_type").notNull(),
    /** Whether stock here can be sold online. */
    sellableOnline: bool("sellable_online").notNull().default(false),
    /** Whether stock here can be collected in person. */
    sellableInStore: bool("sellable_in_store").notNull().default(false),
    active: bool("active").notNull().default(true),
    sortOrder: sortOrder(),
    ...stamps(),
    ...archivable(),
  },
  (t) => [uniqueIndex("inventory_locations_code_unique").on(t.code)],
);

/**
 * The CHECK constraint is a backstop, not the mechanism. The conditional write
 * in the reservation path should make it unreachable - so if it ever fires, the
 * guard has been bypassed and that is worth failing loudly for.
 */
export const inventoryLevels = sqliteTable(
  "inventory_levels",
  {
    id: pk(),
    variantId: text("variant_id")
      .notNull()
      .references(() => productVariants.id, { onDelete: "restrict" }),
    locationId: text("location_id")
      .notNull()
      .references(() => inventoryLocations.id, { onDelete: "restrict" }),
    onHand: integer("on_hand").notNull().default(0),
    reserved: integer("reserved").notNull().default(0),
    incoming: integer("incoming").notNull().default(0),
    reorderThreshold: integer("reorder_threshold"),
    allowBackorder: bool("allow_backorder").notNull().default(false),
    ...stamps(),
  },
  (t) => [
    uniqueIndex("inventory_levels_unique").on(t.variantId, t.locationId),
    index("inventory_levels_variant_idx").on(t.variantId),
    check(
      "inventory_levels_reserved_bounds",
      sql`${t.reserved} >= 0 AND ${t.reserved} <= ${t.onHand}`,
    ),
    check("inventory_levels_on_hand_non_negative", sql`${t.onHand} >= 0`),
  ],
);

/**
 * Every change to on-hand quantity writes one of these. There is no bare stock
 * setter anywhere in the repositories.
 */
export const stockMovements = sqliteTable(
  "stock_movements",
  {
    id: pk(),
    variantId: text("variant_id")
      .notNull()
      .references(() => productVariants.id, { onDelete: "restrict" }),
    locationId: text("location_id")
      .notNull()
      .references(() => inventoryLocations.id, { onDelete: "restrict" }),
    /**
     * supplier_receipt | online_sale | counter_sale | pickup_reservation |
     * pickup_collection | customer_return | transfer_out | transfer_in |
     * manual_adjustment | damaged | lost | reservation_release | cancellation |
     * correction
     */
    movementType: text("movement_type").notNull(),
    /** Signed. Negative removes stock. */
    quantityDelta: integer("quantity_delta").notNull(),
    quantityBefore: integer("quantity_before").notNull(),
    quantityAfter: integer("quantity_after").notNull(),
    /** Order, transfer or adjustment that caused this. */
    referenceType: text("reference_type"),
    referenceId: text("reference_id"),
    reason: text("reason"),
    performedBy: text("performed_by"),
    createdAt: ts("created_at").notNull(),
  },
  (t) => [
    index("stock_movements_variant_idx").on(t.variantId, t.createdAt),
    index("stock_movements_reference_idx").on(t.referenceType, t.referenceId),
    index("stock_movements_location_idx").on(t.locationId, t.createdAt),
  ],
);

/**
 * A hold on stock for an unpaid order.
 *
 * `status` is claimed conditionally by the expiry sweeper, which is what stops
 * two overlapping cron runs from releasing the same reservation twice.
 */
export const stockReservations = sqliteTable(
  "stock_reservations",
  {
    id: pk(),
    orderId: text("order_id").notNull(),
    variantId: text("variant_id")
      .notNull()
      .references(() => productVariants.id, { onDelete: "restrict" }),
    locationId: text("location_id")
      .notNull()
      .references(() => inventoryLocations.id, { onDelete: "restrict" }),
    quantity: integer("quantity").notNull(),
    /** active | released | consumed | expired */
    status: text("status").notNull().default("active"),
    expiresAt: ts("expires_at").notNull(),
    releasedAt: ts("released_at"),
    releasedReason: text("released_reason"),
    ...stamps(),
  },
  (t) => [
    // The sweeper's only query. Without this index it scans the whole table
    // every five minutes, forever.
    index("stock_reservations_sweep_idx").on(t.status, t.expiresAt),
    index("stock_reservations_order_idx").on(t.orderId),
    index("stock_reservations_variant_idx").on(t.variantId, t.status),
  ],
);

/**
 * A manual correction. Separate from stock_movements because it carries the
 * human justification: "counted 3, system said 5, two missing after stocktake"
 * rather than "the count was wrong".
 */
export const stockAdjustments = sqliteTable(
  "stock_adjustments",
  {
    id: pk(),
    variantId: text("variant_id")
      .notNull()
      .references(() => productVariants.id, { onDelete: "restrict" }),
    locationId: text("location_id")
      .notNull()
      .references(() => inventoryLocations.id, { onDelete: "restrict" }),
    quantityBefore: integer("quantity_before").notNull(),
    quantityAfter: integer("quantity_after").notNull(),
    /** stocktake | damage | loss | theft | supplier_error | correction | other */
    reasonCode: text("reason_code").notNull(),
    reasonNote: text("reason_note").notNull(),
    performedBy: text("performed_by").notNull(),
    movementId: text("movement_id").references(() => stockMovements.id, { onDelete: "set null" }),
    createdAt: ts("created_at").notNull(),
  },
  (t) => [index("stock_adjustments_variant_idx").on(t.variantId, t.createdAt)],
);

export const stockTransfers = sqliteTable(
  "stock_transfers",
  {
    id: pk(),
    reference: text("reference").notNull(),
    fromLocationId: text("from_location_id")
      .notNull()
      .references(() => inventoryLocations.id, { onDelete: "restrict" }),
    toLocationId: text("to_location_id")
      .notNull()
      .references(() => inventoryLocations.id, { onDelete: "restrict" }),
    /** draft | in_transit | received | cancelled */
    status: text("status").notNull().default("draft"),
    note: text("note"),
    createdBy: text("created_by").notNull(),
    receivedBy: text("received_by"),
    receivedAt: ts("received_at"),
    ...stamps(),
  },
  (t) => [uniqueIndex("stock_transfers_reference_unique").on(t.reference)],
);

export const stockTransferItems = sqliteTable(
  "stock_transfer_items",
  {
    id: pk(),
    transferId: text("transfer_id")
      .notNull()
      .references(() => stockTransfers.id, { onDelete: "cascade" }),
    variantId: text("variant_id")
      .notNull()
      .references(() => productVariants.id, { onDelete: "restrict" }),
    quantitySent: integer("quantity_sent").notNull(),
    quantityReceived: integer("quantity_received"),
  },
  (t) => [index("stock_transfer_items_transfer_idx").on(t.transferId)],
);
