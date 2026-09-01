import { Form, Link } from "react-router";
import type { Route } from "./+types/returns";
import { cloudflareContext } from "../../../workers/app";
import { requireStaff } from "~/infrastructure/auth/session.server";
import { systemClock, cryptoIds } from "~/infrastructure/primitives";
import { formatDateTime } from "~/lib/i18n";
import { breadcrumbsFor } from "~/lib/admin-nav";
import { PageHeader } from "~/components/admin/admin-shell";

/**
 * Returns.
 *
 * ── Withdrawal is not the same as a return ──────────────────────────────────
 *
 * `is_withdrawal` marks the legal right of withdrawal — recesso — which a
 * consumer buying at distance has for fourteen days and which needs no reason
 * at all. Everything else is a return the shop chooses to accept, or a fault.
 *
 * They are one table because the physical work is identical and two would drift,
 * but they are one COLUMN apart because the obligations are not: a withdrawal
 * cannot be refused for being unjustified, and refusing a courtesy return is a
 * commercial decision. A screen that blurred them would let somebody refuse the
 * first as if it were the second.
 *
 * ── Why nothing here touches money or stock ──────────────────────────────────
 *
 * Approving a return is not refunding one, and receiving goods back is not
 * restocking them. A returned item may be faulty, opened, or fine; deciding
 * which is an inspection, and putting a broken case back on the shelf because a
 * status changed is worse than the extra click.
 *
 * So this records the request and its progress, and the refund stays where
 * refunds live. Stated because "approved" reading as "money sent" is the
 * assumption that costs real money.
 */
export function meta() {
  return [{ title: "Resi" }, { name: "robots", content: "noindex, nofollow" }];
}

/**
 * The reasons, in the customer's words rather than a warehouse code.
 *
 * `withdrawal` is deliberately first and deliberately separate: it is a right,
 * not a complaint, and a shop assistant choosing from this list should see that.
 */
const REASONS = [
  { code: "withdrawal", label: "Recesso (ripensamento, entro 14 giorni)", withdrawal: true },
  { code: "faulty", label: "Prodotto difettoso", withdrawal: false },
  { code: "wrong_item", label: "Articolo sbagliato", withdrawal: false },
  { code: "not_compatible", label: "Non compatibile col telefono", withdrawal: false },
  { code: "damaged_in_transit", label: "Danneggiato nel trasporto", withdrawal: false },
  { code: "other", label: "Altro", withdrawal: false },
] as const;

const STATUS_LABELS: Record<string, string> = {
  requested: "Richiesto",
  approved: "Approvato",
  received: "Ricevuto",
  rejected: "Rifiutato",
};

export async function loader({ request, context }: Route.LoaderArgs) {
  const { env } = context.get(cloudflareContext);
  const actor = await requireStaff(request, env, "order.read");

  const returns = await env.DB.prepare(
    `SELECT r.id, r.reference, r.status, r.reason_code, r.reason_note, r.is_withdrawal,
            r.requested_at, r.approved_at, r.received_at, r.created_at,
            o.id AS order_id, o.order_number,
            o.customer_first_name, o.customer_last_name
       FROM return_requests r
       JOIN orders o ON o.id = r.order_id
      ORDER BY r.status = 'received', r.created_at DESC
      LIMIT 200`,
  ).all<{
    id: string;
    reference: string;
    status: string;
    reason_code: string | null;
    reason_note: string | null;
    is_withdrawal: number;
    requested_at: number | null;
    approved_at: number | null;
    received_at: number | null;
    created_at: number;
    order_id: string;
    order_number: string;
    customer_first_name: string | null;
    customer_last_name: string | null;
  }>();

  const orders = await env.DB.prepare(
    `SELECT id, order_number, customer_first_name, customer_last_name
       FROM orders
      WHERE status NOT IN ('cancelled')
      ORDER BY order_number DESC
      LIMIT 200`,
  ).all<{
    id: string;
    order_number: string;
    customer_first_name: string | null;
    customer_last_name: string | null;
  }>();

  return {
    returns: returns.results,
    orders: orders.results,
    reasons: REASONS,
    canWrite: actor.permissions.includes("order.write"),
  };
}

export async function action({ request, context }: Route.ActionArgs) {
  const { env } = context.get(cloudflareContext);
  const actor = await requireStaff(request, env, "order.write");

  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");
  const now = systemClock.now();

  if (intent === "open") {
    const orderId = String(form.get("orderId") ?? "");
    const reasonCode = String(form.get("reason") ?? "");
    const note = String(form.get("note") ?? "").trim();

    const reason = REASONS.find((r) => r.code === reasonCode);
    if (!reason) return { error: "Motivo non riconosciuto." };

    const order = await env.DB.prepare(`SELECT order_number FROM orders WHERE id = ?1`)
      .bind(orderId)
      .first<{ order_number: string }>();
    if (!order) return { error: "Ordine non trovato." };

    const id = cryptoIds.generate();
    await env.DB.prepare(
      `INSERT INTO return_requests
         (id, order_id, reference, status, reason_code, reason_note, is_withdrawal,
          requested_at, created_at, updated_at)
       VALUES (?1, ?2, ?3, 'requested', ?4, ?5, ?6, ?7, ?7, ?7)`,
    )
      .bind(
        id,
        orderId,
        `RE-${order.order_number}-${id.slice(0, 4).toUpperCase()}`,
        reason.code,
        note || null,
        // Derived from the reason, never a free checkbox: whether this is a
        // withdrawal is a consequence of why it was sent back.
        reason.withdrawal ? 1 : 0,
        now,
      )
      .run();

    return { success: "Reso aperto." };
  }

  if (intent === "approve" || intent === "reject" || intent === "received") {
    const id = String(form.get("returnId") ?? "");

    if (intent === "reject") {
      const existing = await env.DB.prepare(
        `SELECT is_withdrawal, reference FROM return_requests WHERE id = ?1`,
      )
        .bind(id)
        .first<{ is_withdrawal: number; reference: string }>();

      /*
       * A withdrawal cannot be refused.
       *
       * Within fourteen days a consumer buying at distance does not need a
       * reason, so there is nothing to reject. Enforced rather than trusted to
       * training, because the person clicking is usually busy and the customer
       * is usually standing there.
       */
      if (existing?.is_withdrawal) {
        return {
          error:
            `${existing.reference} è un recesso: non può essere rifiutato. ` +
            "Entro quattordici giorni il cliente non deve dare motivazioni.",
        };
      }
    }

    const status =
      intent === "approve" ? "approved" : intent === "reject" ? "rejected" : "received";

    await env.DB.prepare(
      `UPDATE return_requests
          SET status = ?2,
              approved_by = CASE WHEN ?2 = 'approved' THEN ?3 ELSE approved_by END,
              approved_at = CASE WHEN ?2 = 'approved' THEN ?4 ELSE approved_at END,
              received_at = CASE WHEN ?2 = 'received' THEN ?4 ELSE received_at END,
              updated_at = ?4
        WHERE id = ?1`,
    )
      .bind(id, status, actor.userId, now)
      .run();

    return {
      success:
        intent === "received"
          ? "Merce ricevuta. La giacenza NON è stata aggiornata: rimettere a scaffale è una decisione da prendere dopo aver guardato il pezzo."
          : intent === "approve"
            ? "Reso approvato. Il rimborso è un passaggio a parte, da Pagamenti."
            : "Reso rifiutato.",
    };
  }

  return { error: "Azione non riconosciuta." };
}

export default function AdminReturns({ loaderData, actionData }: Route.ComponentProps) {
  const { returns, orders, reasons, canWrite } = loaderData;
  const open = returns.filter((r) => r.status === "requested" || r.status === "approved");

  return (
    <>
      <PageHeader title="Resi" breadcrumbs={breadcrumbsFor("/admin/resi")} />

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
        <div className="ac-metrics">
          <div className="ac-metric">
            <span className="ac-metric__label">Aperti</span>
            <span className="ac-metric__value numeric">{open.length}</span>
          </div>
          <div className="ac-metric">
            <span className="ac-metric__label">Totali</span>
            <span className="ac-metric__value numeric">{returns.length}</span>
          </div>
        </div>
        <p className="small">
          <strong>Recesso e reso non sono la stessa cosa.</strong> Il recesso è un diritto: entro
          quattordici giorni il cliente restituisce senza dover spiegare perché, e non si può
          rifiutare. Tutto il resto è un reso che il negozio decide se accettare.
        </p>
        <p className="small">
          Approvare un reso non è rimborsarlo, e riceverlo non è rimetterlo a scaffale. Il rimborso
          si fa da <Link to="/admin/pagamenti">Pagamenti</Link>; la giacenza si aggiorna da{" "}
          <Link to="/admin/inventario">Inventario</Link>, dopo aver guardato il pezzo.
        </p>
      </section>

      {canWrite && orders.length > 0 ? (
        <section className="panel">
          <h2>Apri un reso</h2>
          <Form method="post" className="stack">
            <input type="hidden" name="intent" value="open" />
            <label>
              Ordine
              <select name="orderId" required defaultValue="">
                <option value="" disabled>
                  Scegli…
                </option>
                {orders.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.order_number} — {o.customer_first_name} {o.customer_last_name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Motivo
              <select name="reason" defaultValue={reasons[0].code}>
                {reasons.map((r) => (
                  <option key={r.code} value={r.code}>
                    {r.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Note
              <input name="note" maxLength={200} />
            </label>
            <button className="btn btn--primary" type="submit">
              Apri reso
            </button>
          </Form>
        </section>
      ) : null}

      {returns.length === 0 ? (
        <div className="empty-state">
          <p>Nessun reso.</p>
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
            <caption className="visually-hidden">Resi</caption>
            <thead>
              <tr>
                <th scope="col">Riferimento</th>
                <th scope="col">Ordine</th>
                <th scope="col">Motivo</th>
                <th scope="col">Stato</th>
                <th scope="col">Aperto</th>
                {canWrite ? <th scope="col">Azioni</th> : null}
              </tr>
            </thead>
            <tbody>
              {returns.map((r) => (
                <tr key={r.id}>
                  <td>
                    <code>{r.reference}</code>
                    {r.is_withdrawal ? (
                      <>
                        <br />
                        <span className="badge badge--warning">recesso</span>
                      </>
                    ) : null}
                  </td>
                  <td>
                    <Link to={`/admin/ordini/${r.order_id}`}>{r.order_number}</Link>
                    <br />
                    <span className="small muted">
                      {r.customer_first_name} {r.customer_last_name}
                    </span>
                  </td>
                  <td className="small">
                    {reasons.find((x) => x.code === r.reason_code)?.label ?? r.reason_code ?? "—"}
                    {r.reason_note ? (
                      <>
                        <br />
                        <span className="muted">{r.reason_note}</span>
                      </>
                    ) : null}
                  </td>
                  <td>
                    <span
                      className={
                        r.status === "received"
                          ? "badge badge--success"
                          : r.status === "rejected"
                            ? "badge badge--danger"
                            : "badge badge--warning"
                      }
                    >
                      {STATUS_LABELS[r.status] ?? r.status}
                    </span>
                  </td>
                  <td className="small">{formatDateTime(r.created_at, "it")}</td>
                  {canWrite ? (
                    <td>
                      <div className="cluster">
                        {r.status === "requested" ? (
                          <>
                            <Form method="post">
                              <input type="hidden" name="intent" value="approve" />
                              <input type="hidden" name="returnId" value={r.id} />
                              <button className="btn btn--primary" type="submit">
                                Approva
                              </button>
                            </Form>
                            {/* Absent for a withdrawal, and refused by the
                                action too: the button is not the guard. */}
                            {!r.is_withdrawal ? (
                              <Form method="post">
                                <input type="hidden" name="intent" value="reject" />
                                <input type="hidden" name="returnId" value={r.id} />
                                <button className="btn btn--danger" type="submit">
                                  Rifiuta
                                </button>
                              </Form>
                            ) : null}
                          </>
                        ) : null}
                        {r.status === "approved" ? (
                          <Form method="post">
                            <input type="hidden" name="intent" value="received" />
                            <input type="hidden" name="returnId" value={r.id} />
                            <button className="btn" type="submit">
                              Merce ricevuta
                            </button>
                          </Form>
                        ) : null}
                      </div>
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
