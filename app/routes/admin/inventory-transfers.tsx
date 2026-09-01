import { Form, Link } from "react-router";
import type { Route } from "./+types/inventory-transfers";
import { cloudflareContext } from "../../../workers/app";
import { requireStaff } from "~/infrastructure/auth/session.server";
import { systemClock, cryptoIds } from "~/infrastructure/primitives";
import { formatDateTime } from "~/lib/i18n";
import { breadcrumbsFor } from "~/lib/admin-nav";
import { PageHeader } from "~/components/admin/admin-shell";

/**
 * Stock transfers between locations.
 *
 * ── Why this screen also manages locations ───────────────────────────────────
 *
 * A transfer moves stock from one place to another. This shop has exactly one
 * place, so on the day this was written a transfer was not a thing that could
 * be expressed — and a screen offering to create one would have been a form
 * that could never be submitted.
 *
 * The honest version of "transfers" for a shop with one location is: here is
 * why there is nothing here, and here is the one thing that would change that.
 * So locations are managed here too. When a second location exists the transfer
 * form appears on its own.
 *
 * ── Why stock leaves on send and arrives on receipt ──────────────────────────
 *
 * Sending decrements the origin immediately: the goods are in a van, and
 * anything that still counts them as sellable in the shop will oversell them.
 * The destination is credited only when somebody confirms they arrived, because
 * until then nobody knows that they did. Between the two the stock is genuinely
 * nowhere, and that is a true statement about a box in transit rather than a
 * gap in the model.
 *
 * Both legs write a movement (invariant 4), so the ledger explains the
 * quantities at both ends.
 */
export function meta() {
  return [{ title: "Trasferimenti" }, { name: "robots", content: "noindex, nofollow" }];
}

const LOCATION_TYPES = [
  ["shop", "Negozio"],
  ["warehouse", "Magazzino"],
  ["storage", "Deposito"],
] as const;

export async function loader({ request, context }: Route.LoaderArgs) {
  const { env } = context.get(cloudflareContext);
  await requireStaff(request, env, "inventory.read");

  const locations = await env.DB.prepare(
    `SELECT id, code, name, location_type, sellable_online, sellable_in_store, active
       FROM inventory_locations
      WHERE archived_at IS NULL
      ORDER BY sort_order, name`,
  ).all<{
    id: string;
    code: string;
    name: string;
    location_type: string;
    sellable_online: number;
    sellable_in_store: number;
    active: number;
  }>();

  const transfers = await env.DB.prepare(
    `SELECT t.id, t.reference, t.status, t.note, t.created_at, t.received_at,
            t.created_by, t.received_by,
            f.name AS from_name, o.name AS to_name,
            (SELECT COUNT(*) FROM stock_transfer_items i WHERE i.transfer_id = t.id) AS lines,
            (SELECT COALESCE(SUM(i.quantity_sent), 0) FROM stock_transfer_items i
              WHERE i.transfer_id = t.id) AS units
       FROM stock_transfers t
       LEFT JOIN inventory_locations f ON f.id = t.from_location_id
       LEFT JOIN inventory_locations o ON o.id = t.to_location_id
      ORDER BY t.created_at DESC
      LIMIT 100`,
  ).all<{
    id: string;
    reference: string;
    status: string;
    note: string | null;
    created_at: number;
    received_at: number | null;
    created_by: string | null;
    received_by: string | null;
    from_name: string | null;
    to_name: string | null;
    lines: number;
    units: number;
  }>();

  return { locations: locations.results, transfers: transfers.results };
}

export async function action({ request, context }: Route.ActionArgs) {
  const { env } = context.get(cloudflareContext);
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");
  const now = systemClock.now();

  if (intent === "add-location") {
    await requireStaff(request, env, "inventory.transfer");
    const name = String(form.get("name") ?? "").trim();
    const code = String(form.get("code") ?? "")
      .trim()
      .toUpperCase();
    const type = String(form.get("location_type") ?? "warehouse");

    if (name === "" || code === "") return { error: "Nome e codice sono obbligatori." };
    if (!LOCATION_TYPES.some(([value]) => value === type)) {
      return { error: "Tipo di sede non riconosciuto." };
    }

    const clash = await env.DB.prepare(`SELECT id FROM inventory_locations WHERE code = ?1`)
      .bind(code)
      .first<{ id: string }>();
    if (clash) return { error: `Esiste già una sede con codice ${code}.` };

    await env.DB.prepare(
      `INSERT INTO inventory_locations
         (id, code, name, location_type, sellable_online, sellable_in_store, active,
          sort_order, created_at, updated_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, 1, 10, ?7, ?7)`,
    )
      .bind(
        cryptoIds.generate(),
        code,
        name,
        type,
        // A back room is not a shop window. A new location does not start
        // sellable, because stock somebody has not decided to sell should not
        // silently become available online the moment it is recorded.
        0,
        type === "shop" ? 1 : 0,
        now,
      )
      .run();

    return { success: `Sede "${name}" creata. Non è ancora vendibile: si abilita quando serve.` };
  }

  if (intent === "create-transfer") {
    const actor = await requireStaff(request, env, "inventory.transfer");
    const from = String(form.get("from_location_id") ?? "");
    const to = String(form.get("to_location_id") ?? "");
    const sku = String(form.get("sku") ?? "").trim();
    const quantity = Number(form.get("quantity") ?? "0");
    const note = String(form.get("note") ?? "").trim();

    if (from === to) return { error: "Origine e destinazione devono essere diverse." };
    if (!Number.isInteger(quantity) || quantity <= 0) {
      return { error: "La quantità deve essere un numero intero maggiore di zero." };
    }

    const variant = await env.DB.prepare(
      `SELECT v.id, v.sku, il.id AS level_id, il.on_hand, il.reserved
         FROM product_variants v
         LEFT JOIN inventory_levels il ON il.variant_id = v.id AND il.location_id = ?2
        WHERE v.sku = ?1`,
    )
      .bind(sku, from)
      .first<{
        id: string;
        sku: string;
        level_id: string | null;
        on_hand: number | null;
        reserved: number | null;
      }>();

    if (!variant) return { error: `Nessuna variante con SKU "${sku}".` };
    if (variant.level_id === null) {
      return { error: `"${sku}" non ha giacenza registrata nella sede di origine.` };
    }

    /*
     * Sellable, not on-hand.
     *
     * Stock already reserved for an order is not available to move; sending it
     * would leave a customer's paid order unfulfillable at the shop that took
     * it. The check is here rather than in the UI because the UI is not what
     * enforces it.
     */
    const available = (variant.on_hand ?? 0) - (variant.reserved ?? 0);
    if (quantity > available) {
      return {
        error: `Nella sede di origine sono disponibili ${available} pezzi di "${sku}" (${variant.on_hand} in giacenza, ${variant.reserved} impegnati da ordini).`,
      };
    }

    const transferId = cryptoIds.generate();
    const reference = `TR-${new Date(now).toISOString().slice(0, 10).replace(/-/g, "")}-${transferId.slice(0, 4).toUpperCase()}`;
    const after = (variant.on_hand ?? 0) - quantity;

    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO stock_transfers
           (id, reference, from_location_id, to_location_id, status, note, created_by,
            created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, 'in_transit', ?5, ?6, ?7, ?7)`,
      ).bind(transferId, reference, from, to, note || null, actor.userId, now),
      env.DB.prepare(
        `INSERT INTO stock_transfer_items (id, transfer_id, variant_id, quantity_sent, quantity_received)
         VALUES (?1, ?2, ?3, ?4, 0)`,
      ).bind(cryptoIds.generate(), transferId, variant.id, quantity),
      env.DB.prepare(
        `UPDATE inventory_levels SET on_hand = ?2, updated_at = ?3 WHERE id = ?1`,
      ).bind(variant.level_id, after, now),
      env.DB.prepare(
        `INSERT INTO stock_movements
           (id, variant_id, location_id, movement_type, quantity_delta, quantity_before,
            quantity_after, reference_type, reference_id, reason, performed_by, created_at)
         VALUES (?1, ?2, ?3, 'transfer_out', ?4, ?5, ?6, 'stock_transfer', ?7, ?8, ?9, ?10)`,
      ).bind(
        cryptoIds.generate(),
        variant.id,
        from,
        -quantity,
        variant.on_hand ?? 0,
        after,
        transferId,
        `Trasferimento ${reference}`,
        actor.userId,
        now,
      ),
    ]);

    return {
      success: `Trasferimento ${reference} creato. ${quantity} pezzi sono usciti dall'origine e arriveranno alla destinazione quando qualcuno confermerà la ricezione.`,
    };
  }

  if (intent === "receive") {
    const actor = await requireStaff(request, env, "inventory.transfer");
    const transferId = String(form.get("transferId") ?? "");

    const transfer = await env.DB.prepare(
      `SELECT id, reference, to_location_id, status FROM stock_transfers WHERE id = ?1`,
    )
      .bind(transferId)
      .first<{ id: string; reference: string; to_location_id: string; status: string }>();

    if (!transfer) return { error: "Trasferimento non trovato." };
    if (transfer.status === "received") {
      // Not an error worth alarming anybody about, but crediting the stock a
      // second time would be, so it stops here.
      return { error: `${transfer.reference} risulta già ricevuto.` };
    }

    const items = await env.DB.prepare(
      `SELECT i.id, i.variant_id, i.quantity_sent,
              il.id AS level_id, il.on_hand
         FROM stock_transfer_items i
         LEFT JOIN inventory_levels il
           ON il.variant_id = i.variant_id AND il.location_id = ?2
        WHERE i.transfer_id = ?1`,
    )
      .bind(transferId, transfer.to_location_id)
      .all<{
        id: string;
        variant_id: string;
        quantity_sent: number;
        level_id: string | null;
        on_hand: number | null;
      }>();

    const statements = [];
    for (const item of items.results) {
      const before = item.on_hand ?? 0;
      const after = before + item.quantity_sent;

      statements.push(
        item.level_id
          ? env.DB.prepare(
              `UPDATE inventory_levels SET on_hand = ?2, updated_at = ?3 WHERE id = ?1`,
            ).bind(item.level_id, after, now)
          : // First time this variant has existed at this location. The row is
            // created here rather than assumed to exist.
            env.DB.prepare(
              `INSERT INTO inventory_levels
                 (id, variant_id, location_id, on_hand, reserved, incoming, reorder_threshold,
                  allow_backorder, created_at, updated_at)
               VALUES (?1, ?2, ?3, ?4, 0, 0, 0, 0, ?5, ?5)`,
            ).bind(cryptoIds.generate(), item.variant_id, transfer.to_location_id, after, now),
        env.DB.prepare(
          `UPDATE stock_transfer_items SET quantity_received = quantity_sent WHERE id = ?1`,
        ).bind(item.id),
        env.DB.prepare(
          `INSERT INTO stock_movements
             (id, variant_id, location_id, movement_type, quantity_delta, quantity_before,
              quantity_after, reference_type, reference_id, reason, performed_by, created_at)
           VALUES (?1, ?2, ?3, 'transfer_in', ?4, ?5, ?6, 'stock_transfer', ?7, ?8, ?9, ?10)`,
        ).bind(
          cryptoIds.generate(),
          item.variant_id,
          transfer.to_location_id,
          item.quantity_sent,
          before,
          after,
          transferId,
          `Ricezione ${transfer.reference}`,
          actor.userId,
          now,
        ),
      );
    }

    statements.push(
      env.DB.prepare(
        `UPDATE stock_transfers
            SET status = 'received', received_by = ?2, received_at = ?3, updated_at = ?3
          WHERE id = ?1`,
      ).bind(transferId, actor.userId, now),
    );

    await env.DB.batch(statements);
    return {
      success: `${transfer.reference} ricevuto. Le giacenze di destinazione sono aggiornate.`,
    };
  }

  return { error: "Azione non riconosciuta." };
}

export default function InventoryTransfers({ loaderData, actionData }: Route.ComponentProps) {
  const { locations, transfers } = loaderData;
  const canTransfer = locations.length >= 2;

  return (
    <>
      <PageHeader
        title="Trasferimenti"
        breadcrumbs={breadcrumbsFor("/admin/inventario/trasferimenti")}
      />

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

      <section className="panel">
        <h2>Sedi</h2>
        <p className="small">
          Un trasferimento sposta merce da una sede a un&apos;altra. Con una sede sola non c&apos;è
          niente da spostare — è per questo che le sedi si gestiscono da qui.
        </p>
        <div
          className="admin-table-wrap"
          /* Focusable and labelled: a region that scrolls sideways and cannot
             take focus is unscrollable without a mouse. */
          tabIndex={0}
          role="region"
          aria-label="Tabella scorrevole"
        >
          <table className="admin-table">
            <caption className="visually-hidden">Sedi di magazzino</caption>
            <thead>
              <tr>
                <th scope="col">Sede</th>
                <th scope="col">Codice</th>
                <th scope="col">Vendibile online</th>
                <th scope="col">Vendibile in negozio</th>
              </tr>
            </thead>
            <tbody>
              {locations.map((l) => (
                <tr key={l.id}>
                  <td>{l.name}</td>
                  <td>
                    <code>{l.code}</code>
                  </td>
                  <td>{l.sellable_online ? "Sì" : "No"}</td>
                  <td>{l.sellable_in_store ? "Sì" : "No"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <Form method="post" className="stack">
          <input type="hidden" name="intent" value="add-location" />
          <h3>Aggiungi una sede</h3>
          <label>
            Nome
            <input name="name" required maxLength={80} placeholder="Magazzino retro" />
          </label>
          <label>
            Codice
            <input name="code" required maxLength={12} placeholder="RETRO" />
            <span className="field-help">Breve, in maiuscolo. Compare nei movimenti.</span>
          </label>
          <label>
            Tipo
            <select name="location_type" defaultValue="warehouse">
              {LOCATION_TYPES.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <button className="btn" type="submit">
            Aggiungi sede
          </button>
        </Form>
      </section>

      {canTransfer ? (
        <section className="panel">
          <h2>Nuovo trasferimento</h2>
          <Form method="post" className="stack">
            <input type="hidden" name="intent" value="create-transfer" />
            <label>
              Da
              <select name="from_location_id" required>
                {locations.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              A
              <select name="to_location_id" required defaultValue={locations[1]?.id}>
                {locations.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              SKU
              <input name="sku" required maxLength={64} placeholder="COV-SIL-16P-BLK" />
            </label>
            <label>
              Quantità
              <input name="quantity" type="number" min={1} step={1} required />
              <span className="field-help">
                Si possono spostare solo i pezzi disponibili: quelli già impegnati da un ordine
                restano dove sono.
              </span>
            </label>
            <label>
              Nota
              <input name="note" maxLength={200} />
            </label>
            <button className="btn btn--primary" type="submit">
              Crea trasferimento
            </button>
          </Form>
        </section>
      ) : (
        <p className="notice notice--info">
          Serve una seconda sede prima di poter creare un trasferimento.
        </p>
      )}

      <section className="panel">
        <h2>Trasferimenti</h2>
        {transfers.length === 0 ? (
          <div className="empty-state">
            <p>Nessun trasferimento.</p>
            <p className="small">
              I movimenti che ne derivano restano visibili in{" "}
              <Link to="/admin/inventario/movimenti">Movimenti</Link>.
            </p>
          </div>
        ) : (
          <div
            className="admin-table-wrap"
            /* Focusable and labelled: a region that scrolls sideways and cannot
             take focus is unscrollable without a mouse. */
            tabIndex={0}
            role="region"
            aria-label="Tabella scorrevole"
          >
            <table className="admin-table">
              <caption className="visually-hidden">Trasferimenti, dal più recente</caption>
              <thead>
                <tr>
                  <th scope="col">Riferimento</th>
                  <th scope="col">Percorso</th>
                  <th scope="col" className="numeric">
                    Righe
                  </th>
                  <th scope="col" className="numeric">
                    Pezzi
                  </th>
                  <th scope="col">Stato</th>
                  <th scope="col">Creato</th>
                  <th scope="col">Azione</th>
                </tr>
              </thead>
              <tbody>
                {transfers.map((tr) => (
                  <tr key={tr.id}>
                    <td>
                      <code>{tr.reference}</code>
                      {tr.note ? (
                        <>
                          <br />
                          <span className="small muted">{tr.note}</span>
                        </>
                      ) : null}
                    </td>
                    <td className="small">
                      {tr.from_name ?? "—"} → {tr.to_name ?? "—"}
                    </td>
                    <td className="numeric">{tr.lines}</td>
                    <td className="numeric">{tr.units}</td>
                    <td>
                      {tr.status === "received" ? (
                        <span className="badge badge--success">ricevuto</span>
                      ) : (
                        <span className="badge badge--warning">in transito</span>
                      )}
                    </td>
                    <td className="small">{formatDateTime(tr.created_at, "it")}</td>
                    <td>
                      {tr.status === "received" ? (
                        <span className="small muted">
                          {tr.received_at ? formatDateTime(tr.received_at, "it") : ""}
                        </span>
                      ) : (
                        <Form method="post">
                          <input type="hidden" name="intent" value="receive" />
                          <input type="hidden" name="transferId" value={tr.id} />
                          <button className="btn" type="submit">
                            Conferma ricezione
                          </button>
                        </Form>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
