import type { Clock, IdGenerator } from "~/application/ports";

/**
 * The reservation sweeper. Runs on cron, every five minutes, in UTC.
 *
 * Two steps carry the whole design:
 *
 *   - Step 2 CLAIMS each reservation with a conditional update, so two
 *     overlapping cron runs cannot both release the same one.
 *   - Step 3 re-checks payment AFTER claiming, which closes the race where a
 *     customer pays at minute 119 and staff verify at minute 121. Without it
 *     the sweeper would release stock out from under an order that is now paid.
 *
 * Idempotent throughout: running it twice, or while a previous run is still
 * going, is harmless.
 */

export interface ExpireReservationsDeps {
  d1: D1Database;
  clock: Clock;
  ids: IdGenerator;
  /** Safety valve so one run cannot exceed the Worker CPU budget. */
  batchSize?: number;
}

export interface ExpireReservationsResult {
  examined: number;
  released: number;
  skippedPaid: number;
  skippedClaimed: number;
  errors: number;
}

interface ExpiredRow {
  id: string;
  order_id: string;
  variant_id: string;
  location_id: string;
  quantity: number;
  payment_status: string | null;
  order_status: string;
}

export async function expireReservations(
  deps: ExpireReservationsDeps,
): Promise<ExpireReservationsResult> {
  const { d1, clock, ids, batchSize = 100 } = deps;
  const now = clock.now();

  const result: ExpireReservationsResult = {
    examined: 0,
    released: 0,
    skippedPaid: 0,
    skippedClaimed: 0,
    errors: 0,
  };

  const runId = ids.generate();
  await d1
    .prepare(
      `INSERT INTO scheduled_job_runs (id, job_name, status, started_at, items_processed)
       VALUES (?1,'expire_reservations','running',?2,0)`,
    )
    .bind(runId, now)
    .run();

  try {
    // ── 1. Find candidates ────────────────────────────────────────────────
    const { results: candidates } = await d1
      .prepare(
        `SELECT r.id, r.order_id, r.variant_id, r.location_id, r.quantity,
                p.status AS payment_status, o.status AS order_status
           FROM stock_reservations r
           JOIN orders o ON o.id = r.order_id
           LEFT JOIN order_payments p ON p.order_id = r.order_id
          WHERE r.status = 'active' AND r.expires_at <= ?1
          ORDER BY r.expires_at ASC
          LIMIT ?2`,
      )
      .bind(now, batchSize)
      .all<ExpiredRow>();

    result.examined = candidates.length;

    for (const row of candidates) {
      try {
        // ── 2. CLAIM it. Conditional, so a concurrent run loses. ──────────
        const claim = await d1
          .prepare(
            `UPDATE stock_reservations
                SET status = 'expired', released_at = ?1, released_reason = 'reservation_window_elapsed', updated_at = ?1
              WHERE id = ?2 AND status = 'active'`,
          )
          .bind(now, row.id)
          .run();

        if (claim.meta.changes === 0) {
          // Another run got there first. Nothing to do, and nothing wrong.
          result.skippedClaimed++;
          continue;
        }

        // ── 3. Re-check payment, AFTER claiming ──────────────────────────
        // This is the race-closing step. Between the query in step 1 and the
        // claim in step 2, staff may have verified the payment.
        const current = await d1
          .prepare(
            `SELECT p.status AS payment_status, o.status AS order_status
               FROM orders o LEFT JOIN order_payments p ON p.order_id = o.id
              WHERE o.id = ?1`,
          )
          .bind(row.order_id)
          .first<{ payment_status: string | null; order_status: string }>();

        const settled =
          current?.payment_status === "verified" ||
          current?.payment_status === "partially_paid" ||
          current?.order_status === "paid";

        if (settled) {
          // Give the claim back. The order is paid; its stock stays held.
          await d1
            .prepare(
              `UPDATE stock_reservations
                  SET status = 'active', released_at = NULL, released_reason = NULL, updated_at = ?1
                WHERE id = ?2`,
            )
            .bind(now, row.id)
            .run();
          result.skippedPaid++;
          continue;
        }

        // ── 4-7. Release, record, and update statuses, atomically ────────
        await d1.batch([
          d1
            .prepare(
              `UPDATE inventory_levels
                  SET reserved = MAX(0, reserved - ?1), updated_at = ?2
                WHERE variant_id = ?3 AND location_id = ?4`,
            )
            .bind(row.quantity, now, row.variant_id, row.location_id),

          d1
            .prepare(
              `INSERT INTO stock_movements (
                 id, variant_id, location_id, movement_type, quantity_delta,
                 quantity_before, quantity_after, reference_type, reference_id, reason, performed_by, created_at
               ) SELECT ?1, ?2, ?3, 'reservation_release', 0, il.on_hand, il.on_hand,
                        'order', ?4, 'reservation expired', 'system', ?5
                   FROM inventory_levels il
                  WHERE il.variant_id = ?2 AND il.location_id = ?3`,
            )
            .bind(ids.generate(), row.variant_id, row.location_id, row.order_id, now),

          d1
            .prepare(
              `UPDATE orders SET status = 'expired', updated_at = ?1
                WHERE id = ?2 AND status IN ('awaiting_customer_contact','awaiting_payment','payment_under_review')`,
            )
            .bind(now, row.order_id),

          d1
            .prepare(
              `UPDATE order_payments SET status = 'expired', updated_at = ?1
                WHERE order_id = ?2 AND status IN ('awaiting_customer_contact','awaiting_payment','proof_received')`,
            )
            .bind(now, row.order_id),

          d1
            .prepare(
              `INSERT INTO order_status_history (id, order_id, from_status, to_status, reason, actor, created_at)
               VALUES (?1,?2,?3,'expired','reservation window elapsed','system',?4)`,
            )
            .bind(ids.generate(), row.order_id, row.order_status, now),

          d1
            .prepare(
              `INSERT INTO order_events (id, order_id, event_type, payload, customer_visible, created_at)
               VALUES (?1,?2,'reservation_expired','{}',1,?3)`,
            )
            .bind(ids.generate(), row.order_id, now),

          d1
            .prepare(
              `INSERT INTO audit_logs (id, actor_id, actor_label, action, entity_type, entity_id, after_value, created_at)
               VALUES (?1,'system','Scheduled job','reservation.expire','order',?2,?3,?4)`,
            )
            .bind(
              ids.generate(),
              row.order_id,
              JSON.stringify({ reservationId: row.id, quantity: row.quantity }),
              now,
            ),
        ]);

        result.released++;
      } catch {
        // One bad reservation must not stop the sweep. The run record carries
        // the count, and a persistent error shows up as a rising number rather
        // than as silence.
        result.errors++;
      }
    }

    await d1
      .prepare(
        `UPDATE scheduled_job_runs
            SET status = ?1, finished_at = ?2, items_processed = ?3, summary = ?4
          WHERE id = ?5`,
      )
      .bind(
        result.errors > 0 ? "failed" : "completed",
        clock.now(),
        result.released,
        JSON.stringify(result),
        runId,
      )
      .run();

    return result;
  } catch (error) {
    await d1
      .prepare(
        `UPDATE scheduled_job_runs SET status = 'failed', finished_at = ?1, error = ?2 WHERE id = ?3`,
      )
      .bind(clock.now(), error instanceof Error ? error.message : String(error), runId)
      .run();
    throw error;
  }
}
