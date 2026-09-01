import { Link } from "react-router";
import type { Route } from "./+types/inventory-movements";
import { cloudflareContext } from "../../../workers/app";
import { requireStaff } from "~/infrastructure/auth/session.server";
import { formatDateTime } from "~/lib/i18n";
import { breadcrumbsFor } from "~/lib/admin-nav";
import { PageHeader } from "~/components/admin/admin-shell";

/**
 * Stock movements.
 *
 * Every change to a quantity writes a row here, whatever caused it: a sale, a
 * manual adjustment, a transfer, a return. It is the answer to "the count is
 * wrong — when did it go wrong, and what did it?", which is unanswerable from
 * the current quantity alone.
 *
 * Read-only, like the audit log and for the same reason: a ledger that can be
 * edited is a ledger nobody can rely on. The way to correct a movement is
 * another movement, which is also how a stockroom works.
 */
export function meta() {
  return [{ title: "Movimenti di magazzino" }, { name: "robots", content: "noindex, nofollow" }];
}

/**
 * What each movement type means, in the words a shop assistant would use.
 *
 * Unmapped types render their raw value rather than being hidden: a movement
 * nobody labelled still moved stock, and dropping it from the list would make
 * the ledger disagree with the quantity it explains.
 */
const MOVEMENT_LABELS: Record<string, string> = {
  sale: "Vendita",
  adjustment: "Rettifica",
  transfer_out: "Trasferimento in uscita",
  transfer_in: "Trasferimento in entrata",
  return: "Reso",
  receipt: "Carico da fornitore",
  reservation: "Prenotazione",
  release: "Rilascio prenotazione",
  cancellation: "Annullamento ordine",
};

const PER_PAGE = 100;

export async function loader({ request, context }: Route.LoaderArgs) {
  const { env } = context.get(cloudflareContext);
  await requireStaff(request, env, "inventory.read");

  const url = new URL(request.url);
  const type = url.searchParams.get("tipo") ?? "";
  const page = Math.max(1, Number(url.searchParams.get("pagina") ?? "1") || 1);

  const where = type ? "WHERE m.movement_type = ?3" : "";
  const binds: unknown[] = [PER_PAGE, (page - 1) * PER_PAGE];
  if (type) binds.push(type);

  const { results } = await env.DB.prepare(
    `SELECT m.id, m.movement_type, m.quantity_delta, m.quantity_before, m.quantity_after,
            m.reference_type, m.reference_id, m.reason, m.performed_by, m.created_at,
            v.sku, pt.name AS product_name, p.slug AS product_slug, loc.name AS location_name
       FROM stock_movements m
       JOIN product_variants v ON v.id = m.variant_id
       JOIN products p ON p.id = v.product_id
       LEFT JOIN product_translations pt ON pt.product_id = p.id AND pt.locale = 'it'
       LEFT JOIN inventory_locations loc ON loc.id = m.location_id
       ${where}
      ORDER BY m.created_at DESC, m.id DESC
      LIMIT ?1 OFFSET ?2`,
  )
    .bind(...binds)
    .all<{
      id: string;
      movement_type: string;
      quantity_delta: number;
      quantity_before: number;
      quantity_after: number;
      reference_type: string | null;
      reference_id: string | null;
      reason: string | null;
      performed_by: string | null;
      created_at: number;
      sku: string;
      product_name: string | null;
      product_slug: string;
      location_name: string | null;
    }>();

  const total = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM stock_movements m ${type ? "WHERE m.movement_type = ?1" : ""}`,
  )
    .bind(...(type ? [type] : []))
    .first<{ n: number }>();

  const types = await env.DB.prepare(
    `SELECT DISTINCT movement_type FROM stock_movements ORDER BY movement_type`,
  ).all<{ movement_type: string }>();

  return {
    movements: results,
    types: types.results.map((t) => t.movement_type),
    filter: type,
    page,
    perPage: PER_PAGE,
    total: total?.n ?? 0,
  };
}

export default function InventoryMovements({ loaderData }: Route.ComponentProps) {
  const { movements, types, filter, page, perPage, total } = loaderData;
  const pages = Math.max(1, Math.ceil(total / perPage));

  const href = (params: Record<string, string>) => {
    const search = new URLSearchParams();
    if (params.tipo ?? filter) search.set("tipo", params.tipo ?? filter);
    if (params.pagina && params.pagina !== "1") search.set("pagina", params.pagina);
    const qs = search.toString();
    return `/admin/inventario/movimenti${qs ? `?${qs}` : ""}`;
  };

  return (
    <>
      <PageHeader
        title="Movimenti di magazzino"
        breadcrumbs={breadcrumbsFor("/admin/inventario/movimenti")}
      />

      <section className="panel">
        <p className="small">
          Ogni variazione di quantità lascia una riga qui, qualunque cosa l&apos;abbia causata. È il
          registro che risponde alla domanda &ldquo;la giacenza è sbagliata: quando lo è
          diventata?&rdquo;. Non si modifica e non si cancella — si corregge con un altro movimento.
        </p>
      </section>

      {types.length > 0 ? (
        <nav className="cluster" aria-label="Filtra per tipo">
          <Link className="chip" to={href({ tipo: "" })} aria-current={filter === "" || undefined}>
            Tutti
          </Link>
          {types.map((type) => (
            <Link
              key={type}
              className="chip"
              to={href({ tipo: type })}
              aria-current={filter === type || undefined}
            >
              {MOVEMENT_LABELS[type] ?? type}
            </Link>
          ))}
        </nav>
      ) : null}

      {movements.length === 0 ? (
        <div className="empty-state">
          <p>Nessun movimento registrato.</p>
          <p className="small">
            Compaiono qui appena una vendita, una rettifica o un trasferimento cambia una quantità.
          </p>
        </div>
      ) : (
        <div className="admin-table-wrap">
          <table className="admin-table">
            <caption className="visually-hidden">Movimenti di magazzino, dal più recente</caption>
            <thead>
              <tr>
                <th scope="col">Quando</th>
                <th scope="col">Prodotto</th>
                <th scope="col">Tipo</th>
                <th scope="col" className="numeric">
                  Variazione
                </th>
                <th scope="col" className="numeric">
                  Da → a
                </th>
                <th scope="col">Sede</th>
                <th scope="col">Causale</th>
              </tr>
            </thead>
            <tbody>
              {movements.map((m) => (
                <tr key={m.id}>
                  <td>{formatDateTime(m.created_at, "it")}</td>
                  <td>
                    <Link to={`/admin/prodotti/${m.product_slug}`}>
                      {m.product_name ?? m.product_slug}
                    </Link>
                    <br />
                    <span className="small muted">{m.sku}</span>
                  </td>
                  <td>{MOVEMENT_LABELS[m.movement_type] ?? m.movement_type}</td>
                  {/* Signed, always. A bare "3" does not say whether stock
                      arrived or left, which is the only thing this column is for. */}
                  <td className="numeric">
                    {m.quantity_delta > 0 ? `+${m.quantity_delta}` : m.quantity_delta}
                  </td>
                  <td className="numeric">
                    {m.quantity_before} → {m.quantity_after}
                  </td>
                  <td>{m.location_name ?? "—"}</td>
                  <td className="small">
                    {m.reason ?? m.reference_type ?? "—"}
                    {m.performed_by ? (
                      <>
                        <br />
                        <span className="muted">{m.performed_by}</span>
                      </>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {pages > 1 ? (
        <nav className="cluster" aria-label="Pagine">
          {page > 1 ? (
            <Link className="btn" to={href({ pagina: String(page - 1) })} rel="prev">
              Precedente
            </Link>
          ) : null}
          <span className="small muted">
            Pagina {page} di {pages} — {total} movimenti
          </span>
          {page < pages ? (
            <Link className="btn" to={href({ pagina: String(page + 1) })} rel="next">
              Successiva
            </Link>
          ) : null}
        </nav>
      ) : null}
    </>
  );
}
