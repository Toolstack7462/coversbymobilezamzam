import { Form, Link } from "react-router";
import type { Route } from "./+types/orders";
import { cloudflareContext } from "../../../workers/app";
import { requireStaff } from "~/infrastructure/auth/session.server";
import { systemClock, cryptoIds } from "~/infrastructure/primitives";
import { money, format as formatMoney } from "~/domain/pricing/money";
import { formatDateTime } from "~/lib/i18n";
import {
  allowedTransitions,
  assertTransition,
  isOrderStatus,
  type OrderStatus,
} from "~/domain/orders/status";

/**
 * Orders.
 *
 * The status dropdown offers exactly the transitions the state machine allows
 * from the current status — not every status. A UI that offers a move the
 * domain will reject is a bug in front of staff.
 */
export async function loader({ request, context }: Route.LoaderArgs) {
  const { env } = context.get(cloudflareContext);
  const actor = await requireStaff(request, env, "order.read");

  const url = new URL(request.url);
  const status = url.searchParams.get("stato") ?? "";

  const where = status ? "WHERE o.status = ?1" : "";
  const binds = status ? [status] : [];

  const { results } = await env.DB.prepare(
    `SELECT o.id, o.order_number, o.status, o.grand_total, o.delivery_method,
            o.customer_first_name, o.customer_last_name, o.created_at,
            o.reservation_expires_at, op.status AS payment_status
       FROM orders o
       LEFT JOIN order_payments op ON op.order_id = o.id
       ${where}
      ORDER BY o.created_at DESC
      LIMIT 100`,
  )
    .bind(...binds)
    .all<{
      id: string;
      order_number: string;
      status: string;
      grand_total: number;
      delivery_method: string;
      customer_first_name: string;
      customer_last_name: string;
      created_at: number;
      reservation_expires_at: number | null;
      payment_status: string | null;
    }>();

  return {
    orders: results.map((order) => ({
      ...order,
      // Computed server-side from the domain, so the UI cannot drift from it.
      allowed: isOrderStatus(order.status) ? allowedTransitions(order.status) : [],
    })),
    filter: status,
    canWrite: actor.permissions.includes("order.write"),
  };
}

export async function action({ request, context }: Route.ActionArgs) {
  const { env } = context.get(cloudflareContext);
  const actor = await requireStaff(request, env, "order.write");
  const form = await request.formData();
  const now = systemClock.now();

  const orderId = String(form.get("orderId") ?? "");
  const to = String(form.get("status") ?? "");

  if (!isOrderStatus(to)) return { error: "Stato non valido." };

  const order = await env.DB.prepare(`SELECT status FROM orders WHERE id = ?1`)
    .bind(orderId)
    .first<{ status: string }>();
  if (!order || !isOrderStatus(order.status)) return { error: "Ordine non trovato." };

  const from = order.status;

  try {
    assertTransition(from, to);
  } catch {
    return { error: `Transizione non consentita da "${from}" a "${to}".` };
  }

  /**
   * `paid` is deliberately NOT reachable here.
   *
   * It is reachable only through the payment verification use case, which
   * requires payment.verify plus step-up plus a recorded amount. Allowing an
   * order manager to set it from a dropdown would be a hole straight through
   * invariant 6.
   */
  if (to === "paid") {
    return {
      error:
        "Un ordine si segna come pagato solo dalla coda di verifica pagamenti, dopo aver controllato il conto.",
    };
  }

  const statements: D1PreparedStatement[] = [
    env.DB.prepare(
      `UPDATE orders SET status = ?1, updated_at = ?2 WHERE id = ?3 AND status = ?4`,
    ).bind(to, now, orderId, from),
    env.DB.prepare(
      `INSERT INTO order_status_history (id, order_id, from_status, to_status, actor, created_at)
       VALUES (?1,?2,?3,?4,?5,?6)`,
    ).bind(cryptoIds.generate(), orderId, from, to, actor.userId, now),
    env.DB.prepare(
      `INSERT INTO order_events (id, order_id, event_type, payload, customer_visible, created_at)
       VALUES (?1,?2,?3,'{}',1,?4)`,
    ).bind(cryptoIds.generate(), orderId, `status_${to}`, now),
  ];

  // Cancelling from a reserving status must return the stock, exactly once.
  if (to === "cancelled" || to === "expired") {
    statements.push(
      env.DB.prepare(
        `UPDATE inventory_levels
            SET reserved = MAX(0, reserved - (
                  SELECT COALESCE(SUM(r.quantity), 0) FROM stock_reservations r
                   WHERE r.order_id = ?1 AND r.status = 'active'
                     AND r.variant_id = inventory_levels.variant_id
                     AND r.location_id = inventory_levels.location_id)),
                updated_at = ?2
          WHERE EXISTS (
            SELECT 1 FROM stock_reservations r
             WHERE r.order_id = ?1 AND r.status = 'active'
               AND r.variant_id = inventory_levels.variant_id
               AND r.location_id = inventory_levels.location_id)`,
      ).bind(orderId, now),
      env.DB.prepare(
        `UPDATE stock_reservations
            SET status = 'released', released_at = ?1, released_reason = 'order cancelled', updated_at = ?1
          WHERE order_id = ?2 AND status = 'active'`,
      ).bind(now, orderId),
      env.DB.prepare(
        `INSERT INTO audit_logs (id, actor_id, actor_label, action, entity_type, entity_id, after_value, created_at)
         VALUES (?1,?2,?3,'order.cancel','order',?4,?5,?6)`,
      ).bind(
        cryptoIds.generate(),
        actor.userId,
        actor.displayName,
        orderId,
        JSON.stringify({ from, to }),
        now,
      ),
    );
  }

  await env.DB.batch(statements);
  return { success: `Ordine aggiornato: ${to}.` };
}

const FILTERS = [
  "",
  "awaiting_payment",
  "payment_under_review",
  "paid",
  "processing",
  "ready_for_pickup",
  "shipped",
  "cancelled",
  "expired",
];

export default function AdminOrders({ loaderData, actionData }: Route.ComponentProps) {
  const { orders, filter, canWrite } = loaderData;

  return (
    <div className="stack">
      <h1>Ordini</h1>

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

      <nav className="cluster" aria-label="Filtra per stato">
        {FILTERS.map((value) => (
          <Link
            key={value || "all"}
            to={value ? `/admin/ordini?stato=${value}` : "/admin/ordini"}
            className="chip"
            aria-pressed={filter === value}
          >
            {value || "Tutti"}
          </Link>
        ))}
      </nav>

      {orders.length === 0 ? (
        <div className="empty-state">
          <p>Nessun ordine{filter ? ` con stato "${filter}"` : ""}.</p>
        </div>
      ) : (
        <div className="admin-table-wrap">
          <table className="admin-table">
            <caption className="visually-hidden">Elenco ordini</caption>
            <thead>
              <tr>
                <th scope="col">Ordine</th>
                <th scope="col">Cliente</th>
                <th scope="col">Totale</th>
                <th scope="col">Consegna</th>
                <th scope="col">Stato</th>
                <th scope="col">Pagamento</th>
                <th scope="col">Creato</th>
                <th scope="col">Azione</th>
              </tr>
            </thead>
            <tbody>
              {orders.map((order) => (
                <tr key={order.id}>
                  <td className="numeric">{order.order_number}</td>
                  <td>
                    {order.customer_first_name} {order.customer_last_name}
                  </td>
                  <td className="numeric">{formatMoney(money(order.grand_total))}</td>
                  <td className="small">{order.delivery_method}</td>
                  <td className="small">{order.status}</td>
                  <td className="small">{order.payment_status ?? "—"}</td>
                  <td className="small">{formatDateTime(order.created_at, "it")}</td>
                  <td>
                    {canWrite && order.allowed.length > 0 ? (
                      <Form method="post" className="cluster">
                        <input type="hidden" name="orderId" value={order.id} />
                        <label className="visually-hidden" htmlFor={`st-${order.id}`}>
                          Nuovo stato
                        </label>
                        <select id={`st-${order.id}`} name="status" className="input">
                          {/* Exactly the legal transitions, minus `paid`,
                              which only the verification queue can set. */}
                          {order.allowed
                            .filter((s: OrderStatus) => s !== "paid")
                            .map((s: OrderStatus) => (
                              <option key={s} value={s}>
                                {s}
                              </option>
                            ))}
                        </select>
                        <button type="submit" className="btn btn--secondary">
                          Applica
                        </button>
                      </Form>
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
