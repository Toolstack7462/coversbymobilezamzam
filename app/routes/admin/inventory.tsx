import { Form } from "react-router";
import type { Route } from "./+types/inventory";
import { cloudflareContext } from "../../../workers/app";
import { requireStaff } from "~/infrastructure/auth/session.server";
import { systemClock, cryptoIds } from "~/infrastructure/primitives";
import { availabilityState } from "~/domain/inventory/availability";

/**
 * Inventory.
 *
 * There is no bare "set quantity to N" field, deliberately. Every adjustment
 * writes a movement AND an adjustment row carrying a reason, a user and the
 * before/after quantities (invariant 4). Without that, a discrepancy is
 * unexplainable: you know the count is wrong and cannot find out when or why.
 */

const REASONS = [
  ["stocktake", "Inventario fisico"],
  ["damage", "Danneggiato"],
  ["loss", "Smarrito"],
  ["theft", "Furto"],
  ["supplier_error", "Errore fornitore"],
  ["correction", "Correzione"],
  ["other", "Altro"],
] as const;

export async function loader({ request, context }: Route.LoaderArgs) {
  const { env } = context.get(cloudflareContext);
  const actor = await requireStaff(request, env, "inventory.read");

  const { results } = await env.DB.prepare(
    `SELECT il.id, il.variant_id, il.location_id, il.on_hand, il.reserved,
            il.reorder_threshold, il.allow_backorder,
            v.sku, v.variant_label, pt.name AS product_name, loc.name AS location_name
       FROM inventory_levels il
       JOIN product_variants v ON v.id = il.variant_id
       JOIN products p ON p.id = v.product_id
       LEFT JOIN product_translations pt ON pt.product_id = p.id AND pt.locale = 'it'
       JOIN inventory_locations loc ON loc.id = il.location_id
      WHERE v.archived_at IS NULL
      ORDER BY (il.on_hand - il.reserved) ASC, pt.name ASC
      LIMIT 200`,
  ).all<{
    id: string;
    variant_id: string;
    location_id: string;
    on_hand: number;
    reserved: number;
    reorder_threshold: number | null;
    allow_backorder: number;
    sku: string;
    variant_label: string | null;
    product_name: string | null;
    location_name: string;
  }>();

  return {
    levels: results.map((level) => ({
      ...level,
      available: Math.max(0, level.on_hand - level.reserved),
      state: availabilityState({
        variantId: level.variant_id,
        locationId: level.location_id,
        onHand: level.on_hand,
        reserved: level.reserved,
        incoming: 0,
        reorderThreshold: level.reorder_threshold,
        allowBackorder: level.allow_backorder === 1,
      }),
    })),
    canAdjust: actor.permissions.includes("inventory.adjust"),
  };
}

export async function action({ request, context }: Route.ActionArgs) {
  const { env } = context.get(cloudflareContext);
  const actor = await requireStaff(request, env, "inventory.adjust");
  const form = await request.formData();
  const now = systemClock.now();

  const variantId = String(form.get("variantId") ?? "");
  const locationId = String(form.get("locationId") ?? "");
  const newOnHand = Number(form.get("onHand"));
  const reasonCode = String(form.get("reasonCode") ?? "");
  const reasonNote = String(form.get("reasonNote") ?? "").trim();

  if (!Number.isInteger(newOnHand) || newOnHand < 0) {
    return { error: "La quantità deve essere un numero intero non negativo." };
  }
  // "The count was wrong" is not a reason. "Counted 3, system said 5, two
  // missing after stocktake" is.
  if (!reasonNote) {
    return { error: "Serve una nota che spieghi la rettifica." };
  }

  const level = await env.DB.prepare(
    `SELECT on_hand, reserved FROM inventory_levels WHERE variant_id = ?1 AND location_id = ?2`,
  )
    .bind(variantId, locationId)
    .first<{ on_hand: number; reserved: number }>();
  if (!level) return { error: "Giacenza non trovata." };

  // The CHECK constraint would reject this anyway; catching it here produces a
  // message a human can act on instead of a database error.
  if (newOnHand < level.reserved) {
    return {
      error: `Non puoi scendere sotto le ${level.reserved} unità già prenotate per ordini in corso.`,
    };
  }

  const movementId = cryptoIds.generate();
  const delta = newOnHand - level.on_hand;

  await env.DB.batch([
    env.DB.prepare(
      `UPDATE inventory_levels SET on_hand = ?1, updated_at = ?2
        WHERE variant_id = ?3 AND location_id = ?4`,
    ).bind(newOnHand, now, variantId, locationId),

    env.DB.prepare(
      `INSERT INTO stock_movements
         (id, variant_id, location_id, movement_type, quantity_delta, quantity_before,
          quantity_after, reference_type, reason, performed_by, created_at)
       VALUES (?1,?2,?3,'manual_adjustment',?4,?5,?6,'adjustment',?7,?8,?9)`,
    ).bind(
      movementId,
      variantId,
      locationId,
      delta,
      level.on_hand,
      newOnHand,
      `${reasonCode}: ${reasonNote}`,
      actor.userId,
      now,
    ),

    env.DB.prepare(
      `INSERT INTO stock_adjustments
         (id, variant_id, location_id, quantity_before, quantity_after, reason_code,
          reason_note, performed_by, movement_id, created_at)
       VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10)`,
    ).bind(
      cryptoIds.generate(),
      variantId,
      locationId,
      level.on_hand,
      newOnHand,
      reasonCode,
      reasonNote,
      actor.userId,
      movementId,
      now,
    ),

    env.DB.prepare(
      `INSERT INTO audit_logs
         (id, actor_id, actor_label, action, entity_type, entity_id, before_value, after_value, created_at)
       VALUES (?1,?2,?3,'inventory.adjust','inventory_level',?4,?5,?6,?7)`,
    ).bind(
      cryptoIds.generate(),
      actor.userId,
      actor.displayName,
      `${variantId}:${locationId}`,
      JSON.stringify({ onHand: level.on_hand }),
      JSON.stringify({ onHand: newOnHand, reasonCode, reasonNote }),
      now,
    ),
  ]);

  return { success: `Giacenza aggiornata: ${level.on_hand} → ${newOnHand}.` };
}

export default function AdminInventory({ loaderData, actionData }: Route.ComponentProps) {
  const { levels, canAdjust } = loaderData;

  return (
    <div className="stack">
      <h1>Inventario</h1>

      {actionData && "error" in actionData && actionData.error ? (
        <p className="notice notice--danger" role="alert">
          {actionData.error}
        </p>
      ) : null}
      {actionData && "success" in actionData && actionData.success ? (
        <p className="notice notice--info" role="status">
          {actionData.success}
        </p>
      ) : null}

      <p className="small muted">
        Disponibile = giacenza − prenotato. Ogni rettifica richiede un motivo e resta registrata.
      </p>

      {levels.length === 0 ? (
        <div className="empty-state">
          <p>Nessuna giacenza registrata.</p>
        </div>
      ) : (
        <div className="admin-table-wrap">
          <table className="admin-table">
            <caption className="visually-hidden">Giacenze</caption>
            <thead>
              <tr>
                <th scope="col">Prodotto</th>
                <th scope="col">SKU</th>
                <th scope="col">Sede</th>
                <th scope="col">Giacenza</th>
                <th scope="col">Prenotato</th>
                <th scope="col">Disponibile</th>
                <th scope="col">Stato</th>
                <th scope="col">Rettifica</th>
              </tr>
            </thead>
            <tbody>
              {levels.map((level) => (
                <tr key={level.id}>
                  <td>
                    {level.product_name ?? level.sku}
                    {level.variant_label ? (
                      <span className="muted small"> — {level.variant_label}</span>
                    ) : null}
                  </td>
                  <td className="numeric small">{level.sku}</td>
                  <td className="small">{level.location_name}</td>
                  <td className="numeric">{level.on_hand}</td>
                  <td className="numeric">{level.reserved}</td>
                  <td className="numeric">
                    <strong>{level.available}</strong>
                  </td>
                  <td className={`small stock--${level.state}`}>{level.state}</td>
                  <td>
                    {canAdjust ? (
                      <details>
                        <summary className="btn btn--secondary">Rettifica</summary>
                        <Form method="post" className="stack admin-verify-form">
                          <input type="hidden" name="variantId" value={level.variant_id} />
                          <input type="hidden" name="locationId" value={level.location_id} />

                          <div className="field">
                            <label className="field__label" htmlFor={`oh-${level.id}`}>
                              Nuova giacenza
                            </label>
                            <input
                              id={`oh-${level.id}`}
                              name="onHand"
                              type="number"
                              min={level.reserved}
                              className="input numeric"
                              defaultValue={level.on_hand}
                            />
                            <span className="field__hint">
                              Non può scendere sotto {level.reserved} (già prenotate).
                            </span>
                          </div>

                          <div className="field">
                            <label className="field__label" htmlFor={`rc-${level.id}`}>
                              Motivo
                            </label>
                            <select id={`rc-${level.id}`} name="reasonCode" className="input">
                              {REASONS.map(([value, label]) => (
                                <option key={value} value={value}>
                                  {label}
                                </option>
                              ))}
                            </select>
                          </div>

                          <div className="field">
                            <label className="field__label" htmlFor={`rn-${level.id}`}>
                              Nota
                            </label>
                            <input
                              id={`rn-${level.id}`}
                              name="reasonNote"
                              className="input"
                              required
                              placeholder="Contate 3, sistema 5: 2 mancanti"
                            />
                          </div>

                          <button type="submit" className="btn btn--primary">
                            Registra rettifica
                          </button>
                        </Form>
                      </details>
                    ) : (
                      <span className="muted small">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
