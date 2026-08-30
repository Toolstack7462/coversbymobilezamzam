import { z } from "zod";
import { type Money, money } from "~/domain/pricing/money";
import { calculateTotals, type TotalsLine } from "~/domain/cart/totals";
import { generateOrderNumber, generateTrackingToken } from "~/domain/orders/order-number";
import { resolveCompatibility } from "~/domain/compatibility/resolve";
import type { Clock, IdGenerator } from "~/application/ports";

/**
 * Order creation.
 *
 * The whole point of this file is that steps 2-9 happen in ONE D1 batch, so a
 * partially created order can never exist. A partial order that has reserved
 * stock is worse than no order: it is invisible to staff, invisible to the
 * customer, and it silently removes a unit from sale.
 */

export const CreateOrderInput = z.object({
  cartToken: z.string().min(1),
  idempotencyKey: z.string().min(8).max(128),

  customerFirstName: z.string().trim().min(1).max(100),
  customerLastName: z.string().trim().min(1).max(100),
  customerEmail: z.string().trim().email().max(255),
  customerPhone: z.string().trim().max(40).optional(),

  deliveryMethod: z.enum(["shipping", "pickup"]),
  shippingMethodId: z.string().optional(),
  pickupLocationId: z.string().optional(),
  paymentMethodId: z.string().min(1),

  deviceModelId: z.string().nullable().optional(),
  customerNote: z.string().trim().max(1000).optional(),
  termsVersionId: z.string().optional(),

  address: z
    .object({
      street: z.string().trim().min(1).max(200),
      streetNumber: z.string().trim().max(20).optional(),
      // Italian CAP: exactly five digits. Deliberately not stricter - the valid
      // ranges are not contiguous and hardcoding them rejects real addresses.
      postcode: z
        .string()
        .trim()
        .regex(/^\d{5}$/, "CAP non valido"),
      city: z.string().trim().min(1).max(100),
      province: z.string().trim().length(2).optional(),
      country: z.string().trim().length(2).default("IT"),
    })
    .optional(),

  // NOTE what is absent: no price, no total, no discount, no shipping cost, no
  // stock figure, no status. Those are recomputed server-side (invariant 2).
  // They are not accepted-and-validated, because a field that is accepted is
  // one refactor away from being trusted.
  lines: z
    .array(
      z.object({
        variantId: z.string().min(1),
        quantity: z.number().int().min(1).max(99),
      }),
    )
    .min(1)
    .max(50),
});

export type CreateOrderInput = z.infer<typeof CreateOrderInput>;

export type CreateOrderResult =
  | {
      ok: true;
      orderId: string;
      orderNumber: string;
      trackingToken: string;
      total: Money;
      replayed: boolean;
    }
  | { ok: false; reason: "out_of_stock"; variantIds: string[] }
  | { ok: false; reason: "price_changed"; variantIds: string[] }
  | { ok: false; reason: "unavailable"; variantIds: string[] }
  | { ok: false; reason: "payment_method_unavailable" }
  | { ok: false; reason: "conflict" };

export interface CreateOrderDeps {
  d1: D1Database;
  clock: Clock;
  ids: IdGenerator;
  vatBasisPoints: number;
  defaultLocationId: string;
}

interface VariantRow {
  variant_id: string;
  product_id: string;
  sku: string;
  variant_label: string | null;
  product_name: string;
  image_key: string | null;
  price_amount: number;
  currency: string;
  active: number;
  available_online: number;
  available_for_pickup: number;
  on_hand: number | null;
  reserved: number | null;
  allow_backorder: number | null;
}

export async function createOrder(
  input: CreateOrderInput,
  deps: CreateOrderDeps,
): Promise<CreateOrderResult> {
  const { d1, clock, ids, vatBasisPoints, defaultLocationId } = deps;
  const now = clock.now();

  // ── 1. Idempotency replay ─────────────────────────────────────────────────
  // Customers double-click and networks retry. A replay returns the original
  // result rather than reserving the last unit twice.
  const existing = await d1
    .prepare(
      `SELECT result_payload, status FROM idempotency_keys
        WHERE key = ?1 AND scope = 'order_create' AND expires_at > ?2`,
    )
    .bind(input.idempotencyKey, now)
    .first<{ result_payload: string | null; status: string }>();

  if (existing?.status === "completed" && existing.result_payload) {
    const payload = JSON.parse(existing.result_payload) as {
      orderId: string;
      orderNumber: string;
      trackingToken: string;
      totalAmount: number;
      currency: string;
    };
    return {
      ok: true,
      replayed: true,
      orderId: payload.orderId,
      orderNumber: payload.orderNumber,
      trackingToken: payload.trackingToken,
      total: money(payload.totalAmount),
    };
  }
  if (existing) return { ok: false, reason: "conflict" };

  // ── 2. Payment method must be configured AND active ───────────────────────
  // A method that is not fully configured is never advertised, and must not be
  // accepted even if its id was submitted directly.
  const method = await d1
    .prepare(
      `SELECT id, reservation_minutes, eligible_for_shipping, eligible_for_pickup, active
         FROM payment_methods WHERE id = ?1 AND archived_at IS NULL`,
    )
    .bind(input.paymentMethodId)
    .first<{
      id: string;
      reservation_minutes: number;
      eligible_for_shipping: number;
      eligible_for_pickup: number;
      active: number;
    }>();

  if (!method || method.active !== 1) return { ok: false, reason: "payment_method_unavailable" };
  if (input.deliveryMethod === "shipping" && method.eligible_for_shipping !== 1) {
    return { ok: false, reason: "payment_method_unavailable" };
  }
  if (input.deliveryMethod === "pickup" && method.eligible_for_pickup !== 1) {
    return { ok: false, reason: "payment_method_unavailable" };
  }

  // ── 3. Re-read AUTHORITATIVE prices and stock ─────────────────────────────
  // Not what the cart showed. Not what the client sent. What the database says,
  // right now (invariant 2).
  const variantIds = input.lines.map((l) => l.variantId);
  const placeholders = variantIds.map((_, i) => `?${i + 2}`).join(",");

  const { results: rows } = await d1
    .prepare(
      `SELECT v.id AS variant_id, v.product_id, v.sku, v.variant_label,
              pt.name AS product_name,
              (SELECT object_key FROM product_images pi
                WHERE pi.product_id = v.product_id
                ORDER BY pi.is_primary DESC, pi.sort_order ASC LIMIT 1) AS image_key,
              vp.amount AS price_amount, vp.currency,
              v.active, v.available_online, v.available_for_pickup,
              il.on_hand, il.reserved, il.allow_backorder
         FROM product_variants v
         JOIN products p ON p.id = v.product_id
         LEFT JOIN product_translations pt
                ON pt.product_id = v.product_id AND pt.locale = 'it'
         JOIN variant_prices vp ON vp.variant_id = v.id
         JOIN price_lists pl ON pl.id = vp.price_list_id
                            AND pl.channel = 'online' AND pl.is_default = 1
         LEFT JOIN inventory_levels il
                ON il.variant_id = v.id AND il.location_id = ?1
        WHERE v.id IN (${placeholders})
          AND v.archived_at IS NULL
          AND p.archived_at IS NULL
          AND p.status = 'active'`,
    )
    .bind(defaultLocationId, ...variantIds)
    .all<VariantRow>();

  const byVariant = new Map(rows.map((r) => [r.variant_id, r]));

  // Anything missing here is unpurchasable: archived, unpublished, or priceless.
  const missing = variantIds.filter((id) => !byVariant.has(id));
  if (missing.length > 0) return { ok: false, reason: "unavailable", variantIds: missing };

  const channelUnavailable = input.lines
    .filter((line) => {
      const row = byVariant.get(line.variantId)!;
      if (row.active !== 1) return true;
      return input.deliveryMethod === "pickup"
        ? row.available_for_pickup !== 1
        : row.available_online !== 1;
    })
    .map((l) => l.variantId);
  if (channelUnavailable.length > 0) {
    return { ok: false, reason: "unavailable", variantIds: channelUnavailable };
  }

  // ── 4. Availability pre-check ─────────────────────────────────────────────
  // This catches "no inventory row at all" and gives a useful message. It does
  // NOT prevent the race - the CHECK constraint in step 7 does that.
  const short = input.lines
    .filter((line) => {
      const row = byVariant.get(line.variantId)!;
      if (row.allow_backorder === 1) return false;
      if (row.on_hand === null || row.reserved === null) return true;
      return row.on_hand - row.reserved < line.quantity;
    })
    .map((l) => l.variantId);
  if (short.length > 0) return { ok: false, reason: "out_of_stock", variantIds: short };

  // ── 5. Totals, computed from the authoritative prices ─────────────────────
  const totalsLines: TotalsLine[] = input.lines.map((line) => ({
    variantId: line.variantId,
    quantity: line.quantity,
    unitPrice: money(byVariant.get(line.variantId)!.price_amount),
  }));
  const totals = calculateTotals({ lines: totalsLines, vatBasisPoints });

  // ── 6. Identifiers ────────────────────────────────────────────────────────
  const orderId = ids.generate();
  const orderNumber = generateOrderNumber(clock.nowDate(), ids.randomBytes(6));
  const trackingToken = generateTrackingToken(ids.randomBytes(32));
  const reservationExpiresAt = now + method.reservation_minutes * 60 * 1000;

  const compatibilityByVariant = await resolveCompatibilityStates(
    d1,
    rows,
    input.deviceModelId ?? null,
  );

  // ── 7. ONE batch. All of it, or none of it. ───────────────────────────────
  const statements: D1PreparedStatement[] = [];

  // Claiming the key is an INSERT against a UNIQUE index. Two concurrent
  // requests with the same key: one inserts, the other fails, and its whole
  // batch rolls back. The constraint IS the mechanism.
  statements.push(
    d1
      .prepare(
        `INSERT INTO idempotency_keys (id, key, scope, owner_token, status, result_payload, expires_at, created_at)
         VALUES (?1, ?2, 'order_create', ?3, 'completed', ?4, ?5, ?6)`,
      )
      .bind(
        ids.generate(),
        input.idempotencyKey,
        input.cartToken,
        JSON.stringify({
          orderId,
          orderNumber,
          trackingToken,
          totalAmount: totals.grandTotal.amount,
          currency: totals.currency,
        }),
        now + 24 * 60 * 60 * 1000,
        now,
      ),
  );

  statements.push(
    d1
      .prepare(
        `INSERT INTO orders (
           id, order_number, tracking_token, status,
           customer_first_name, customer_last_name, customer_email, customer_phone,
           delivery_method, shipping_method_id, pickup_location_id, payment_method_id,
           device_model_id, item_subtotal, discount_total, shipping_total, tax_total,
           grand_total, currency, customer_note, terms_version_id,
           reservation_expires_at, placed_at, created_at, updated_at
         ) VALUES (?1,?2,?3,'awaiting_customer_contact',?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?18,?19,?20,?21,?22,?23,?24)`,
      )
      .bind(
        orderId,
        orderNumber,
        trackingToken,
        input.customerFirstName,
        input.customerLastName,
        input.customerEmail.toLowerCase(),
        input.customerPhone ?? null,
        input.deliveryMethod,
        input.shippingMethodId ?? null,
        input.pickupLocationId ?? null,
        input.paymentMethodId,
        input.deviceModelId ?? null,
        totals.itemSubtotal.amount,
        totals.discountTotal.amount,
        totals.shippingTotal.amount,
        totals.taxTotal.amount,
        totals.grandTotal.amount,
        totals.currency,
        input.customerNote ?? null,
        input.termsVersionId ?? null,
        reservationExpiresAt,
        now,
        now,
        now,
      ),
  );

  // Snapshotted line items (invariant 5). Nothing here joins back to live
  // product data at render time.
  input.lines.forEach((line, index) => {
    const row = byVariant.get(line.variantId)!;
    const lineTotal = totals.lineTotals[index]!;
    statements.push(
      d1
        .prepare(
          `INSERT INTO order_items (
             id, order_id, product_id, variant_id, product_name, variant_label, sku,
             image_key, compatibility_state, device_model_name, quantity, unit_price,
             discount_amount, tax_amount, line_total, currency, created_at
           ) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,0,0,?13,?14,?15)`,
        )
        .bind(
          ids.generate(),
          orderId,
          row.product_id,
          row.variant_id,
          row.product_name ?? row.sku,
          row.variant_label,
          row.sku,
          row.image_key,
          compatibilityByVariant.get(row.variant_id) ?? null,
          null,
          line.quantity,
          row.price_amount,
          lineTotal.amount,
          totals.currency,
          now,
        ),
    );
  });

  if (input.address && input.deliveryMethod === "shipping") {
    statements.push(
      d1
        .prepare(
          `INSERT INTO order_addresses (
             id, order_id, address_type, first_name, last_name, street, street_number,
             postcode, city, province, country, phone, created_at
           ) VALUES (?1,?2,'shipping',?3,?4,?5,?6,?7,?8,?9,?10,?11,?12)`,
        )
        .bind(
          ids.generate(),
          orderId,
          input.customerFirstName,
          input.customerLastName,
          input.address.street,
          input.address.streetNumber ?? null,
          input.address.postcode,
          input.address.city,
          input.address.province ?? null,
          input.address.country,
          input.customerPhone ?? null,
          now,
        ),
    );
  }

  for (const line of input.lines) {
    statements.push(
      d1
        .prepare(
          `INSERT INTO stock_reservations (
             id, order_id, variant_id, location_id, quantity, status, expires_at, created_at, updated_at
           ) VALUES (?1,?2,?3,?4,?5,'active',?6,?7,?8)`,
        )
        .bind(
          ids.generate(),
          orderId,
          line.variantId,
          defaultLocationId,
          line.quantity,
          reservationExpiresAt,
          now,
          now,
        ),
    );

    /**
     * THE OVERSELL GUARD.
     *
     * Deliberately NOT `WHERE reserved + ? <= on_hand`. Inside a D1 batch a
     * conditional UPDATE that matches nothing is a silent no-op: it succeeds
     * with changes = 0, the batch commits, and an order exists holding stock
     * that was never reserved.
     *
     * An UNCONDITIONAL update against the CHECK constraint
     * (reserved >= 0 AND reserved <= on_hand) raises an ERROR when it would
     * oversell, which aborts the statement and rolls back the entire batch.
     * The failure mode is loud, and atomic.
     *
     * The pre-check in step 4 handles the missing-row case and produces a
     * useful message; this handles the race, where someone took the last unit
     * between the read and the write.
     */
    statements.push(
      d1
        .prepare(
          `UPDATE inventory_levels
              SET reserved = reserved + ?1, updated_at = ?2
            WHERE variant_id = ?3 AND location_id = ?4`,
        )
        .bind(line.quantity, now, line.variantId, defaultLocationId),
    );

    statements.push(
      d1
        .prepare(
          `INSERT INTO stock_movements (
             id, variant_id, location_id, movement_type, quantity_delta,
             quantity_before, quantity_after, reference_type, reference_id, reason, created_at
           ) SELECT ?1, ?2, ?3, 'pickup_reservation', 0, il.on_hand, il.on_hand,
                    'order', ?4, 'reservation', ?5
               FROM inventory_levels il
              WHERE il.variant_id = ?2 AND il.location_id = ?3`,
        )
        .bind(ids.generate(), line.variantId, defaultLocationId, orderId, now),
    );
  }

  statements.push(
    d1
      .prepare(
        `INSERT INTO order_payments (
           id, order_id, payment_method_id, status, amount_expected, currency, created_at, updated_at
         ) VALUES (?1,?2,?3,'awaiting_customer_contact',?4,?5,?6,?7)`,
      )
      .bind(
        ids.generate(),
        orderId,
        input.paymentMethodId,
        totals.grandTotal.amount,
        totals.currency,
        now,
        now,
      ),
  );

  statements.push(
    d1
      .prepare(
        `INSERT INTO order_status_history (id, order_id, from_status, to_status, actor, created_at)
         VALUES (?1,?2,NULL,'awaiting_customer_contact','customer',?3)`,
      )
      .bind(ids.generate(), orderId, now),
  );

  statements.push(
    d1
      .prepare(
        `INSERT INTO order_events (id, order_id, event_type, payload, customer_visible, created_at)
         VALUES (?1,?2,'order_placed',?3,1,?4)`,
      )
      .bind(ids.generate(), orderId, JSON.stringify({ orderNumber }), now),
  );

  try {
    await d1.batch(statements);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    // A CHECK violation on inventory_levels means someone took the stock
    // between our read and our write. That is the guard doing its job.
    if (/CHECK constraint failed|inventory_levels_reserved_bounds/i.test(message)) {
      return { ok: false, reason: "out_of_stock", variantIds };
    }
    // A UNIQUE violation on idempotency_keys means a concurrent duplicate.
    if (/UNIQUE constraint failed: idempotency_keys/i.test(message)) {
      return { ok: false, reason: "conflict" };
    }
    throw error;
  }

  return {
    ok: true,
    replayed: false,
    orderId,
    orderNumber,
    trackingToken,
    total: totals.grandTotal,
  };
}

/**
 * The compatibility state shown to the customer at the moment of ordering,
 * snapshotted onto the line so a later data correction does not rewrite what
 * they were told.
 */
async function resolveCompatibilityStates(
  d1: D1Database,
  rows: readonly VariantRow[],
  deviceModelId: string | null,
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (!deviceModelId || rows.length === 0) return out;

  const productIds = [...new Set(rows.map((r) => r.product_id))];
  const placeholders = productIds.map((_, i) => `?${i + 1}`).join(",");

  const { results } = await d1
    .prepare(
      `SELECT product_id, variant_id, device_model_id, compatibility_level, verified
         FROM product_compatibility WHERE product_id IN (${placeholders})`,
    )
    .bind(...productIds)
    .all<{
      product_id: string;
      variant_id: string | null;
      device_model_id: string;
      compatibility_level: string;
      verified: number;
    }>();

  for (const row of rows) {
    const records = results
      .filter((r) => r.product_id === row.product_id)
      .map((r) => ({
        deviceModelId: r.device_model_id,
        variantId: r.variant_id,
        level: r.compatibility_level as never,
        verified: r.verified === 1,
      }));

    out.set(
      row.variant_id,
      resolveCompatibility({
        records,
        selectedDeviceModelId: deviceModelId,
        variantId: row.variant_id,
      }).state,
    );
  }

  return out;
}
