import { Link } from "react-router";
import type { Route } from "./+types/inventory-reservations";
import { cloudflareContext } from "../../../workers/app";
import { requireStaff } from "~/infrastructure/auth/session.server";
import { systemClock } from "~/infrastructure/primitives";
import { formatDateTime } from "~/lib/i18n";
import { breadcrumbsFor } from "~/lib/admin-nav";
import { PageHeader } from "~/components/admin/admin-shell";

/**
 * Stock reservations.
 *
 * When an order is placed, its stock is held rather than deducted. That hold is
 * why "eight in the stockroom" and "eight you can sell" are different numbers,
 * and this screen is where the difference becomes visible.
 *
 * The screen exists mostly for one question: why can I not sell something I can
 * see on the shelf? The answer is nearly always a reservation, and without this
 * list it is invisible.
 *
 * Expired-but-unreleased rows are called out separately. A reservation past its
 * expiry that has not been released is stock held for nobody — the customer is
 * gone and the shelf is still blocked. That is a bug in the release job or a
 * job that has not run, and it is worth seeing rather than quietly filtering
 * out.
 */
export function meta() {
  return [{ title: "Prenotazioni di stock" }, { name: "robots", content: "noindex, nofollow" }];
}

const STATUS_LABELS: Record<string, string> = {
  active: "Attiva",
  released: "Rilasciata",
  consumed: "Consumata",
  expired: "Scaduta",
};

export async function loader({ request, context }: Route.LoaderArgs) {
  const { env } = context.get(cloudflareContext);
  await requireStaff(request, env, "inventory.read");

  const now = systemClock.now();
  const status = new URL(request.url).searchParams.get("stato") ?? "active";

  const { results } = await env.DB.prepare(
    `SELECT r.id, r.order_id, r.quantity, r.status, r.expires_at, r.released_at,
            r.released_reason, r.created_at,
            v.sku, v.variant_label, pt.name AS product_name, p.slug AS product_slug,
            loc.name AS location_name, o.order_number
       FROM stock_reservations r
       JOIN product_variants v ON v.id = r.variant_id
       JOIN products p ON p.id = v.product_id
       LEFT JOIN product_translations pt ON pt.product_id = p.id AND pt.locale = 'it'
       LEFT JOIN inventory_locations loc ON loc.id = r.location_id
       LEFT JOIN orders o ON o.id = r.order_id
      ${status === "tutte" ? "" : "WHERE r.status = ?1"}
      ORDER BY r.created_at DESC
      LIMIT 200`,
  )
    .bind(...(status === "tutte" ? [] : [status]))
    .all<{
      id: string;
      order_id: string | null;
      quantity: number;
      status: string;
      expires_at: number | null;
      released_at: number | null;
      released_reason: string | null;
      created_at: number;
      sku: string;
      variant_label: string | null;
      product_name: string | null;
      product_slug: string;
      location_name: string | null;
      order_number: string | null;
    }>();

  const stale = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM stock_reservations
      WHERE status = 'active' AND expires_at IS NOT NULL AND expires_at < ?1`,
  )
    .bind(now)
    .first<{ n: number }>();

  const held = await env.DB.prepare(
    `SELECT COALESCE(SUM(quantity), 0) AS n FROM stock_reservations WHERE status = 'active'`,
  ).first<{ n: number }>();

  return {
    reservations: results,
    filter: status,
    stale: stale?.n ?? 0,
    held: held?.n ?? 0,
    now,
  };
}

export default function InventoryReservations({ loaderData }: Route.ComponentProps) {
  const { reservations, filter, stale, held, now } = loaderData;

  const tab = (slug: string, label: string) => (
    <Link
      className="chip"
      to={`/admin/inventario/prenotazioni?stato=${slug}`}
      aria-current={filter === slug || undefined}
    >
      {label}
    </Link>
  );

  return (
    <>
      <PageHeader
        title="Prenotazioni di stock"
        breadcrumbs={breadcrumbsFor("/admin/inventario/prenotazioni")}
      />

      <section className="panel">
        <div className="ac-metrics">
          <div className="ac-metric">
            <span className="ac-metric__label">Pezzi impegnati adesso</span>
            <span className="ac-metric__value numeric">{held}</span>
          </div>
          <div className="ac-metric">
            <span className="ac-metric__label">Scadute e non rilasciate</span>
            <span className="ac-metric__value numeric">{stale}</span>
            <span className="ac-metric__note">Stock fermo per nessuno</span>
          </div>
        </div>
        <p className="small">
          Quando arriva un ordine il suo stock viene <em>trattenuto</em>, non scalato. È per questo
          che &ldquo;in magazzino&rdquo; e &ldquo;vendibile&rdquo; sono due numeri diversi, e di
          solito è la risposta alla domanda &ldquo;perché non riesco a vendere una cosa che vedo
          sullo scaffale?&rdquo;.
        </p>
        {stale > 0 ? (
          <p className="notice notice--warning">
            <strong>{stale} prenotazioni sono scadute senza essere rilasciate.</strong> Quello stock
            è bloccato per clienti che non ci sono più. Se il numero non torna a zero da solo, il
            lavoro programmato che le rilascia non sta girando — si controlla da{" "}
            <Link to="/admin/sistema">Stato del sistema</Link>.
          </p>
        ) : null}
      </section>

      <nav className="cluster" aria-label="Filtra per stato">
        {tab("active", "Attive")}
        {tab("released", "Rilasciate")}
        {tab("consumed", "Consumate")}
        {tab("tutte", "Tutte")}
      </nav>

      {reservations.length === 0 ? (
        <div className="empty-state">
          <p>Nessuna prenotazione in questo stato.</p>
          <p className="small">
            Le prenotazioni nascono con gli ordini: senza ordini aperti questo elenco resta vuoto.
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
            <caption className="visually-hidden">Prenotazioni di stock</caption>
            <thead>
              <tr>
                <th scope="col">Prodotto</th>
                <th scope="col" className="numeric">
                  Pezzi
                </th>
                <th scope="col">Ordine</th>
                <th scope="col">Stato</th>
                <th scope="col">Scade</th>
                <th scope="col">Creata</th>
              </tr>
            </thead>
            <tbody>
              {reservations.map((r) => {
                const expired =
                  r.status === "active" && r.expires_at !== null && r.expires_at < now;
                return (
                  <tr key={r.id}>
                    <td>
                      <Link to={`/admin/prodotti/${r.product_slug}`}>
                        {r.product_name ?? r.product_slug}
                      </Link>
                      <br />
                      <span className="small muted">
                        {r.variant_label ? `${r.variant_label} — ` : ""}
                        {r.sku}
                        {r.location_name ? ` — ${r.location_name}` : ""}
                      </span>
                    </td>
                    <td className="numeric">{r.quantity}</td>
                    <td>
                      {r.order_number && r.order_id ? (
                        <Link to={`/admin/ordini/${r.order_id}`}>{r.order_number}</Link>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td>
                      {expired ? (
                        <span className="badge badge--danger">scaduta</span>
                      ) : (
                        <span className="badge">{STATUS_LABELS[r.status] ?? r.status}</span>
                      )}
                      {r.released_reason ? (
                        <>
                          <br />
                          <span className="small muted">{r.released_reason}</span>
                        </>
                      ) : null}
                    </td>
                    <td className="small">
                      {r.expires_at ? formatDateTime(r.expires_at, "it") : "—"}
                    </td>
                    <td className="small">{formatDateTime(r.created_at, "it")}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
