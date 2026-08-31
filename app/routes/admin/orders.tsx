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
import { parseTableParams, paginate, orderByClause, type TableSpec } from "~/lib/table-params";
import {
  ORDER_VIEWS,
  ORDER_VIEW_SLUGS,
  ORDER_DELIVERY_FACET,
  ORDER_STATUS_LABELS,
  PAYMENT_STATUS_LABELS,
  DELIVERY_LABELS,
  orderStatusTone,
  paymentStatusTone,
} from "~/lib/order-views";
import { breadcrumbsFor } from "~/lib/admin-nav";
import { PageHeader } from "~/components/admin/admin-shell";
import { DataTable, type Column } from "~/components/admin/data-table";

/**
 * Orders.
 *
 * The status dropdown offers exactly the transitions the state machine allows
 * from the current status — not every status. A UI that offers a move the
 * domain will reject is a bug in front of staff.
 *
 * Statuses are shown in Italian throughout. The database stores English
 * snake_case, which is correct; showing `awaiting_customer_contact` to a
 * shopkeeper is not. The translation lives in one map so three screens cannot
 * end up disagreeing about what a status is called.
 */

export function meta() {
  return [{ title: "Ordini" }, { name: "robots", content: "noindex, nofollow" }];
}

const SPEC: TableSpec = {
  views: ORDER_VIEW_SLUGS,
  sortable: ["number", "customer", "total", "status", "created"],
  defaultSort: { key: "created", direction: "desc" },
  facets: { consegna: Object.keys(ORDER_DELIVERY_FACET) },
};

const SORT_COLUMNS: Record<string, string> = {
  number: "o.order_number",
  customer: "o.customer_last_name",
  total: "o.grand_total",
  status: "o.status",
  created: "o.created_at",
};

interface OrderRow {
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
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const { env } = context.get(cloudflareContext);
  const actor = await requireStaff(request, env, "order.read");

  const url = new URL(request.url);
  const state = parseTableParams(url.searchParams, SPEC);
  const view = ORDER_VIEWS.find((v) => v.slug === state.view) ?? ORDER_VIEWS[0]!;

  const conditions: string[] = [view.where];
  const binds: unknown[] = [];

  const delivery = state.filters["consegna"];
  if (delivery && ORDER_DELIVERY_FACET[delivery]) {
    conditions.push(ORDER_DELIVERY_FACET[delivery]!);
  }

  if (state.q) {
    // Order number, surname or email: the three things a customer says on the
    // phone. Matched case-insensitively because none of them will be typed the
    // way they were stored.
    binds.push(`%${state.q.toLowerCase()}%`);
    conditions.push(`(LOWER(o.order_number) LIKE ?${binds.length}
                      OR LOWER(o.customer_last_name) LIKE ?${binds.length}
                      OR LOWER(o.customer_first_name) LIKE ?${binds.length}
                      OR LOWER(o.customer_email) LIKE ?${binds.length})`);
  }

  const where = conditions.join(" AND ");
  const from = `FROM orders o
       LEFT JOIN order_payments op ON op.order_id = o.id`;
  const orderBy = orderByClause(state.sort, SORT_COLUMNS, "o.created_at DESC");

  const [totalRow, page, viewCounts] = await Promise.all([
    env.DB.prepare(`SELECT COUNT(*) AS n ${from} WHERE ${where}`)
      .bind(...binds)
      .first<{ n: number }>(),

    env.DB.prepare(
      `SELECT o.id, o.order_number, o.status, o.grand_total, o.delivery_method,
              o.customer_first_name, o.customer_last_name, o.created_at,
              o.reservation_expires_at, op.status AS payment_status
         ${from}
        WHERE ${where}
        ORDER BY ${orderBy}, o.id
        LIMIT ?${binds.length + 1} OFFSET ?${binds.length + 2}`,
    )
      .bind(...binds, state.perPage, (state.page - 1) * state.perPage)
      .all<OrderRow>(),

    env.DB.prepare(
      `SELECT ${ORDER_VIEWS.map((v, i) => `SUM(CASE WHEN ${v.where} THEN 1 ELSE 0 END) AS v${i}`).join(", ")}
         FROM orders o`,
    ).first<Record<string, number>>(),
  ]);

  return {
    rows: page.results.map((order) => ({
      ...order,
      // Computed server-side from the domain, so the UI cannot drift from it.
      allowed: isOrderStatus(order.status) ? allowedTransitions(order.status) : [],
    })),
    state,
    pagination: paginate(state, totalRow?.n ?? 0),
    views: ORDER_VIEWS.map((v, i) => ({
      slug: v.slug,
      label: v.label,
      count: Number(viewCounts?.[`v${i}`] ?? 0),
    })),
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

type Row = OrderRow & { allowed: readonly OrderStatus[] };

export default function AdminOrders({ loaderData, actionData }: Route.ComponentProps) {
  const { rows, state, pagination, views, canWrite } = loaderData;

  const columns: Column<Row>[] = [
    {
      key: "number",
      header: "Ordine",
      numeric: true,
      render: (row) => <Link to={`/admin/ordini/${row.id}`}>{row.order_number}</Link>,
    },
    {
      key: "customer",
      header: "Cliente",
      render: (row) => `${row.customer_first_name} ${row.customer_last_name}`.trim() || "—",
    },
    {
      key: "total",
      header: "Totale",
      numeric: true,
      render: (row) => formatMoney(money(row.grand_total)),
    },
    {
      key: "delivery",
      header: "Consegna",
      secondary: true,
      render: (row) => DELIVERY_LABELS[row.delivery_method] ?? row.delivery_method,
    },
    {
      key: "status",
      header: "Stato",
      render: (row) => (
        <span className={`badge ${orderStatusTone(row.status)}`}>
          {isOrderStatus(row.status) ? ORDER_STATUS_LABELS[row.status] : row.status}
        </span>
      ),
    },
    {
      key: "payment",
      header: "Pagamento",
      secondary: true,
      render: (row) =>
        row.payment_status === null ? (
          <span className="muted">—</span>
        ) : (
          <span className={`badge ${paymentStatusTone(row.payment_status)}`}>
            {PAYMENT_STATUS_LABELS[row.payment_status as keyof typeof PAYMENT_STATUS_LABELS] ??
              row.payment_status}
          </span>
        ),
    },
    {
      key: "created",
      header: "Creato",
      secondary: true,
      render: (row) => <span className="small">{formatDateTime(row.created_at, "it")}</span>,
    },
    {
      key: "move",
      header: "Sposta a",
      render: (row) =>
        canWrite && row.allowed.length > 0 ? (
          <Form method="post" className="cluster">
            <input type="hidden" name="orderId" value={row.id} />
            <label className="visually-hidden" htmlFor={`st-${row.id}`}>
              Nuovo stato per l&apos;ordine {row.order_number}
            </label>
            <select id={`st-${row.id}`} name="status" className="input">
              {/* Exactly the legal transitions, minus `paid`, which only the
                  verification queue can set (invariant 6). */}
              {row.allowed
                .filter((s) => s !== "paid")
                .map((s) => (
                  <option key={s} value={s}>
                    {ORDER_STATUS_LABELS[s]}
                  </option>
                ))}
            </select>
            <button type="submit" className="btn btn--secondary btn--small">
              Applica
            </button>
          </Form>
        ) : (
          <span className="muted small">—</span>
        ),
    },
  ];

  return (
    <>
      <PageHeader
        title="Ordini"
        description="Ogni vista è una domanda pratica: chi devo contattare, cosa devo preparare."
        breadcrumbs={breadcrumbsFor("/admin/ordini")}
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

      <DataTable
        state={state}
        spec={SPEC}
        pagination={pagination}
        columns={columns}
        rows={rows}
        rowKey={(row) => row.id}
        views={views}
        searchLabel="Cerca per numero, cognome o email"
        emptyState={{
          title: "Nessun ordine",
          body: "Quando un cliente completa un ordine sul sito compare qui, insieme alle istruzioni di pagamento da inviargli.",
        }}
      />
    </>
  );
}
