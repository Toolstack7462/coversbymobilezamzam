import { adminTranslator } from "~/lib/admin-i18n";
import { adminLocaleFromMatches } from "~/lib/admin-locale";
import { useAdminTranslator } from "~/components/admin/use-admin-translator";
import { Link } from "react-router";
import type { Route } from "./+types/inventory-low-stock";
import { appContext } from "~/runtime/context";
import { requireStaff } from "~/infrastructure/auth/session.server";
import { breadcrumbsFor } from "~/lib/admin-nav";
import { PageHeader } from "~/components/admin/admin-shell";

/**
 * Low stock.
 *
 * A reorder list, ordered by how close each line is to being unsellable rather
 * than alphabetically or by name — the point of the screen is what to buy
 * first.
 *
 * "Available" is on_hand MINUS reserved, everywhere. A variant with eight in
 * the stockroom and eight held for orders can sell none, and a list that showed
 * eight would send somebody past a shelf that is already spoken for.
 *
 * Variants with no inventory record at all are excluded rather than shown as
 * zero. `not_tracked` is a different state from "none left", and the shop sells
 * things it does not count.
 */
export function meta({ matches }: Route.MetaArgs) {
  const t = adminTranslator(adminLocaleFromMatches(matches));
  return [{ title: t("Scorte basse") }, { name: "robots", content: "noindex, nofollow" }];
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const { env } = context.get(appContext);
  await requireStaff(request, env, "inventory.read");

  const { results } = await env.DB.prepare(
    `SELECT v.id, v.sku, v.variant_label,
            il.on_hand, il.reserved, il.incoming, il.reorder_threshold, il.allow_backorder,
            (il.on_hand - il.reserved) AS available,
            pt.name AS product_name, p.slug AS product_slug, loc.name AS location_name
       FROM inventory_levels il
       JOIN product_variants v ON v.id = il.variant_id
       JOIN products p ON p.id = v.product_id
       LEFT JOIN product_translations pt ON pt.product_id = p.id AND pt.locale = 'it'
       LEFT JOIN inventory_locations loc ON loc.id = il.location_id
      WHERE v.active = 1
        AND p.status = 'active'
        AND p.archived_at IS NULL
        AND (il.on_hand - il.reserved) <= il.reorder_threshold
      ORDER BY (il.on_hand - il.reserved) ASC, pt.name ASC
      LIMIT 300`,
  ).all<{
    id: string;
    sku: string;
    variant_label: string | null;
    on_hand: number;
    reserved: number;
    incoming: number;
    reorder_threshold: number;
    allow_backorder: number;
    available: number;
    product_name: string | null;
    product_slug: string;
    location_name: string | null;
  }>();

  return {
    rows: results,
    outOfStock: results.filter((r) => r.available <= 0).length,
  };
}

export default function InventoryLowStock({ loaderData }: Route.ComponentProps) {
  const t = useAdminTranslator();
  const { rows, outOfStock } = loaderData;

  return (
    <>
      <PageHeader
        title={t("Scorte basse")}
        breadcrumbs={breadcrumbsFor("/admin/inventario/scorte-basse")}
      />

      <section className="panel">
        <div className="ac-metrics">
          <div className="ac-metric">
            <span className="ac-metric__label">{t("Sotto soglia")}</span>
            <span className="ac-metric__value numeric">{rows.length}</span>
          </div>
          <div className="ac-metric">
            <span className="ac-metric__label">{t("Non vendibili adesso")}</span>
            <span className="ac-metric__value numeric">{outOfStock}</span>
            <span className="ac-metric__note">{t("Disponibile a zero o sotto")}</span>
          </div>
        </div>
        <p className="small">
          {t(
            "“Disponibile” è la giacenza meno i pezzi già impegnati da ordini. Otto in magazzino e otto prenotati fanno zero da vendere: è quel numero che conta quando si decide cosa riordinare.",
          )}
        </p>
      </section>

      {rows.length === 0 ? (
        <div className="empty-state">
          <p>{t("Nessun articolo sotto la soglia di riordino.")}</p>
          <p className="small">
            {t("Le soglie si impostano per variante da")}{" "}
            <Link to="/admin/inventario">{t("Panoramica scorte")}</Link>.
          </p>
        </div>
      ) : (
        <div
          className="admin-table-wrap"
          /* Focusable and labelled: a region that scrolls sideways and cannot
             take focus is unscrollable without a mouse. */
          tabIndex={0}
          role="region"
          aria-label={t("Tabella scorrevole")}
        >
          <table className="admin-table">
            <caption className="visually-hidden">
              {t("Articoli sotto la soglia di riordino, dal più critico")}
            </caption>
            <thead>
              <tr>
                <th scope="col">{t("Prodotto")}</th>
                <th scope="col" className="numeric">
                  {t("Disponibile")}
                </th>
                <th scope="col" className="numeric">
                  {t("Giacenza")}
                </th>
                <th scope="col" className="numeric">
                  {t("Impegnati")}
                </th>
                <th scope="col" className="numeric">
                  {t("In arrivo")}
                </th>
                <th scope="col" className="numeric">
                  {t("Soglia")}
                </th>
                <th scope="col">{t("Stato")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <td>
                    <Link to={`/admin/prodotti/${row.product_slug}`}>
                      {row.product_name ?? row.product_slug}
                    </Link>
                    <br />
                    <span className="small muted">
                      {row.variant_label ? `${row.variant_label} — ` : ""}
                      {row.sku}
                      {row.location_name ? ` — ${row.location_name}` : ""}
                    </span>
                  </td>
                  <td className="numeric">{row.available}</td>
                  <td className="numeric">{row.on_hand}</td>
                  <td className="numeric">{row.reserved}</td>
                  <td className="numeric">{row.incoming}</td>
                  <td className="numeric">{row.reorder_threshold}</td>
                  <td>
                    {row.available <= 0 ? (
                      row.allow_backorder ? (
                        // Backorder is a real state and not the same as sold
                        // out: the shop is still taking the order.
                        <span className="badge badge--warning">{t("su ordinazione")}</span>
                      ) : (
                        <span className="badge badge--danger">{t("esaurito")}</span>
                      )
                    ) : (
                      <span className="badge badge--warning">{t("in esaurimento")}</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
