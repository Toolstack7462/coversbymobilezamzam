import { Link } from "react-router";
import type { Route } from "./+types/inventory-adjustments";
import { cloudflareContext } from "../../../workers/app";
import { requireStaff } from "~/infrastructure/auth/session.server";
import { formatDateTime } from "~/lib/i18n";
import { breadcrumbsFor } from "~/lib/admin-nav";
import { PageHeader } from "~/components/admin/admin-shell";

/**
 * Stock adjustments.
 *
 * The subset of movements a person made by hand, with the reason they gave.
 * Separate from the movements ledger on purpose: a sale explains itself, while
 * somebody deciding the count was wrong does not, and those are the entries a
 * shop owner actually reviews.
 *
 * Read against `stock_adjustments`, which the inventory screen writes alongside
 * every movement (invariant 4). No adjustment can be made from this screen —
 * adjusting happens where the stock is shown, so nobody changes a number
 * without seeing what it currently is.
 */
export function meta() {
  return [{ title: "Rettifiche di magazzino" }, { name: "robots", content: "noindex, nofollow" }];
}

/** The reason codes the inventory screen offers, in the same words. */
const REASON_LABELS: Record<string, string> = {
  stocktake: "Inventario fisico",
  damage: "Danneggiato",
  loss: "Smarrito",
  theft: "Furto",
  supplier_error: "Errore fornitore",
  correction: "Correzione",
  other: "Altro",
};

export async function loader({ request, context }: Route.LoaderArgs) {
  const { env } = context.get(cloudflareContext);
  await requireStaff(request, env, "inventory.read");

  const reason = new URL(request.url).searchParams.get("motivo") ?? "";

  const { results } = await env.DB.prepare(
    `SELECT a.id, a.quantity_before, a.quantity_after, a.reason_code, a.reason_note,
            a.performed_by, a.created_at,
            v.sku, pt.name AS product_name, p.slug AS product_slug, loc.name AS location_name
       FROM stock_adjustments a
       JOIN product_variants v ON v.id = a.variant_id
       JOIN products p ON p.id = v.product_id
       LEFT JOIN product_translations pt ON pt.product_id = p.id AND pt.locale = 'it'
       LEFT JOIN inventory_locations loc ON loc.id = a.location_id
       ${reason ? "WHERE a.reason_code = ?1" : ""}
      ORDER BY a.created_at DESC
      LIMIT 200`,
  )
    .bind(...(reason ? [reason] : []))
    .all<{
      id: string;
      quantity_before: number;
      quantity_after: number;
      reason_code: string;
      reason_note: string | null;
      performed_by: string | null;
      created_at: number;
      sku: string;
      product_name: string | null;
      product_slug: string;
      location_name: string | null;
    }>();

  /*
   * Totals by reason, over everything rather than the page.
   *
   * "Nine adjustments for damage this year" is the number that changes a
   * decision; the individual rows are how you check it. A count of what happens
   * to be on screen would answer neither question.
   */
  const summary = await env.DB.prepare(
    `SELECT reason_code, COUNT(*) AS n, SUM(quantity_after - quantity_before) AS net
       FROM stock_adjustments
      GROUP BY reason_code
      ORDER BY n DESC`,
  ).all<{ reason_code: string; n: number; net: number }>();

  return { adjustments: results, summary: summary.results, filter: reason };
}

export default function InventoryAdjustments({ loaderData }: Route.ComponentProps) {
  const { adjustments, summary, filter } = loaderData;

  return (
    <>
      <PageHeader
        title="Rettifiche di magazzino"
        breadcrumbs={breadcrumbsFor("/admin/inventario/rettifiche")}
      />

      <section className="panel">
        <p className="small">
          Le correzioni fatte a mano, con la causale di chi le ha fatte. Una vendita si spiega da
          sola; qualcuno che decide che la giacenza era sbagliata no, ed è questo l&apos;elenco che
          vale la pena rileggere. Per rettificare una quantità si passa da{" "}
          <Link to="/admin/inventario">Panoramica scorte</Link>, dove il numero attuale è sotto gli
          occhi.
        </p>
      </section>

      {summary.length > 0 ? (
        <section className="panel">
          <h2>Per causale</h2>
          <div className="ac-metrics">
            {summary.map((row) => (
              <div className="ac-metric" key={row.reason_code}>
                <span className="ac-metric__label">
                  {REASON_LABELS[row.reason_code] ?? row.reason_code}
                </span>
                <span className="ac-metric__value numeric">{row.n}</span>
                <span className="ac-metric__note numeric">
                  {row.net > 0 ? `+${row.net}` : row.net} pezzi
                </span>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {summary.length > 1 ? (
        <nav className="cluster" aria-label="Filtra per causale">
          <Link
            className="chip"
            to="/admin/inventario/rettifiche"
            aria-current={filter === "" || undefined}
          >
            Tutte
          </Link>
          {summary.map((row) => (
            <Link
              key={row.reason_code}
              className="chip"
              to={`/admin/inventario/rettifiche?motivo=${row.reason_code}`}
              aria-current={filter === row.reason_code || undefined}
            >
              {REASON_LABELS[row.reason_code] ?? row.reason_code}
            </Link>
          ))}
        </nav>
      ) : null}

      {adjustments.length === 0 ? (
        <div className="empty-state">
          <p>Nessuna rettifica registrata.</p>
          <p className="small">
            È un buon segno: vuol dire che finora le giacenze non hanno avuto bisogno di correzioni.
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
            <caption className="visually-hidden">Rettifiche, dalla più recente</caption>
            <thead>
              <tr>
                <th scope="col">Quando</th>
                <th scope="col">Prodotto</th>
                <th scope="col" className="numeric">
                  Da → a
                </th>
                <th scope="col" className="numeric">
                  Differenza
                </th>
                <th scope="col">Causale</th>
                <th scope="col">Chi</th>
              </tr>
            </thead>
            <tbody>
              {adjustments.map((a) => {
                const delta = a.quantity_after - a.quantity_before;
                return (
                  <tr key={a.id}>
                    <td>{formatDateTime(a.created_at, "it")}</td>
                    <td>
                      <Link to={`/admin/prodotti/${a.product_slug}`}>
                        {a.product_name ?? a.product_slug}
                      </Link>
                      <br />
                      <span className="small muted">
                        {a.sku}
                        {a.location_name ? ` — ${a.location_name}` : ""}
                      </span>
                    </td>
                    <td className="numeric">
                      {a.quantity_before} → {a.quantity_after}
                    </td>
                    <td className="numeric">{delta > 0 ? `+${delta}` : delta}</td>
                    <td>
                      {REASON_LABELS[a.reason_code] ?? a.reason_code}
                      {a.reason_note ? (
                        <>
                          <br />
                          <span className="small muted">{a.reason_note}</span>
                        </>
                      ) : null}
                    </td>
                    <td className="small">{a.performed_by ?? "—"}</td>
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
