import { Form, Link } from "react-router";
import type { Route } from "./+types/featured";
import { cloudflareContext } from "../../../workers/app";
import { requireStaff } from "~/infrastructure/auth/session.server";
import { systemClock } from "~/infrastructure/primitives";
import { breadcrumbsFor } from "~/lib/admin-nav";
import { PageHeader } from "~/components/admin/admin-shell";

/**
 * Featured, new and bestselling products.
 *
 * These three flags decide what the homepage puts in front of a stranger, and
 * until now they could only be set one product at a time from a product page —
 * which is the wrong shape for the job. Choosing what the shop leads with is a
 * decision about the whole set, made by comparing candidates side by side.
 *
 * ── "Bestseller" is a claim, not a flag ──────────────────────────────────────
 *
 * `is_bestseller` is set by hand, and this screen shows the number of units
 * actually sold beside it, because those two can disagree and only one of them
 * is true. A shop is free to lead with what it wants to sell; it should just be
 * able to see when the label and the sales have parted company.
 *
 * ── Out of stock stays visible ───────────────────────────────────────────────
 *
 * A featured product with nothing to sell is not hidden here. The homepage
 * decides how to render an unavailable product; this screen's job is to show
 * that you are leading with something nobody can buy.
 */
export function meta() {
  return [{ title: "Prodotti in evidenza" }, { name: "robots", content: "noindex, nofollow" }];
}

const FLAGS = [
  ["is_featured", "In evidenza"],
  ["is_new", "Novità"],
  ["is_bestseller", "Più venduto"],
] as const;

type FlagColumn = (typeof FLAGS)[number][0];

export async function loader({ request, context }: Route.LoaderArgs) {
  const { env } = context.get(cloudflareContext);
  const actor = await requireStaff(request, env, "product.read");

  const { results } = await env.DB.prepare(
    `SELECT p.id, p.slug, p.is_featured, p.is_new, p.is_bestseller, p.published_at,
            pt.name, COALESCE(ct.name, c.slug) AS category_name,
            (SELECT COALESCE(SUM(il.on_hand - il.reserved), 0)
               FROM inventory_levels il
               JOIN product_variants v ON v.id = il.variant_id
              WHERE v.product_id = p.id) AS available,
            (SELECT COALESCE(SUM(oi.quantity), 0)
               FROM order_items oi
               JOIN product_variants v2 ON v2.id = oi.variant_id
              WHERE v2.product_id = p.id) AS sold
       FROM products p
       LEFT JOIN product_translations pt ON pt.product_id = p.id AND pt.locale = 'it'
       LEFT JOIN categories c ON c.id = p.primary_category_id
       LEFT JOIN category_translations ct ON ct.category_id = c.id AND ct.locale = 'it'
      WHERE p.status = 'active' AND p.archived_at IS NULL
      ORDER BY (p.is_featured + p.is_new + p.is_bestseller) DESC, pt.name ASC
      LIMIT 300`,
  ).all<{
    id: string;
    slug: string;
    is_featured: number;
    is_new: number;
    is_bestseller: number;
    published_at: number | null;
    name: string | null;
    category_name: string | null;
    available: number;
    sold: number;
  }>();

  return {
    products: results,
    canWrite: actor.permissions.includes("product.write"),
    counts: {
      is_featured: results.filter((r) => r.is_featured).length,
      is_new: results.filter((r) => r.is_new).length,
      is_bestseller: results.filter((r) => r.is_bestseller).length,
    },
  };
}

export async function action({ request, context }: Route.ActionArgs) {
  const { env } = context.get(cloudflareContext);
  await requireStaff(request, env, "product.write");

  const form = await request.formData();
  const productId = String(form.get("productId") ?? "");
  const column = String(form.get("column") ?? "") as FlagColumn;
  const next = String(form.get("next") ?? "") === "1" ? 1 : 0;

  /*
   * The column name is checked against the allow-list rather than interpolated
   * from the form. It is the only part of this statement that cannot be bound,
   * so it is the only part that has to be proven safe.
   */
  if (!FLAGS.some(([name]) => name === column)) {
    return { error: "Campo non riconosciuto." };
  }

  await env.DB.prepare(`UPDATE products SET ${column} = ?2, updated_at = ?3 WHERE id = ?1`)
    .bind(productId, next, systemClock.now())
    .run();

  return { success: "Aggiornato." };
}

export default function AdminFeatured({ loaderData, actionData }: Route.ComponentProps) {
  const { products, canWrite, counts } = loaderData;

  return (
    <>
      <PageHeader title="Prodotti in evidenza" breadcrumbs={breadcrumbsFor("/admin/in-evidenza")} />

      {actionData && "error" in actionData && actionData.error ? (
        <p className="notice notice--danger" role="alert">
          {actionData.error}
        </p>
      ) : null}

      <section className="panel">
        <div className="ac-metrics">
          {FLAGS.map(([column, label]) => (
            <div className="ac-metric" key={column}>
              <span className="ac-metric__label">{label}</span>
              <span className="ac-metric__value numeric">{counts[column]}</span>
            </div>
          ))}
        </div>
        <p className="small">
          Sono i tre contrassegni che decidono cosa vede per primo chi arriva sul sito senza sapere
          niente del negozio. La colonna &ldquo;venduti&rdquo; è lì apposta: &ldquo;più
          venduto&rdquo; lo decidi tu, ma se il numero accanto è zero conviene saperlo.
        </p>
      </section>

      {products.length === 0 ? (
        <div className="empty-state">
          <p>Nessun prodotto attivo.</p>
          <p className="small">
            <Link to="/admin/prodotti">Prodotti</Link> è il posto da cui aggiungerne.
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
            <caption className="visually-hidden">
              Prodotti attivi e i loro contrassegni di evidenza
            </caption>
            <thead>
              <tr>
                <th scope="col">Prodotto</th>
                <th scope="col" className="numeric">
                  Disponibili
                </th>
                <th scope="col" className="numeric">
                  Venduti
                </th>
                {FLAGS.map(([column, label]) => (
                  <th scope="col" key={column}>
                    {label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {products.map((p) => (
                <tr key={p.id}>
                  <td>
                    <Link to={`/admin/prodotti/${p.slug}`}>{p.name ?? p.slug}</Link>
                    <br />
                    <span className="small muted">{p.category_name ?? "senza categoria"}</span>
                  </td>
                  <td className="numeric">
                    {p.available <= 0 ? (
                      <span className="badge badge--danger">0</span>
                    ) : (
                      p.available
                    )}
                  </td>
                  <td className="numeric">{p.sold}</td>
                  {FLAGS.map(([column]) => {
                    const on = p[column] === 1;
                    return (
                      <td key={column}>
                        {canWrite ? (
                          <Form method="post">
                            <input type="hidden" name="productId" value={p.id} />
                            <input type="hidden" name="column" value={column} />
                            <input type="hidden" name="next" value={on ? "0" : "1"} />
                            {/*
                              A button, not a checkbox. A checkbox that submits
                              on change is a control that acts without being
                              pressed, and one that does not needs a save button
                              somewhere the eye has already left.
                            */}
                            <button
                              className={on ? "btn btn--primary" : "btn"}
                              type="submit"
                              aria-pressed={on}
                            >
                              {on ? "Sì" : "No"}
                            </button>
                          </Form>
                        ) : on ? (
                          "Sì"
                        ) : (
                          "No"
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
