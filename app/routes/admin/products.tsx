import { Form, Link } from "react-router";
import type { Route } from "./+types/products";
import { cloudflareContext } from "../../../workers/app";
import { requireStaff } from "~/infrastructure/auth/session.server";
import { systemClock, cryptoIds } from "~/infrastructure/primitives";
import { money, format as formatMoney, parseAmountToMinorUnits } from "~/domain/pricing/money";

/**
 * Products.
 *
 * Two operations that carry real risk are handled carefully here:
 *
 *   - A price change writes a `price_history` row. Without it the 30-day prior
 *     price cannot be evidenced, and a discount could not lawfully be announced
 *     (D.Lgs. 84/2022).
 *   - A product is ARCHIVED, never deleted, because orders reference it
 *     (invariant 13). The foreign key would refuse a delete anyway.
 */
export async function loader({ request, context }: Route.LoaderArgs) {
  const { env } = context.get(cloudflareContext);
  const actor = await requireStaff(request, env, "product.read");

  const url = new URL(request.url);
  const q = url.searchParams.get("q")?.trim() ?? "";

  const { results } = await env.DB.prepare(
    `SELECT p.id, p.slug, p.status, p.archived_at, pt.name, b.name AS brand_name,
            (SELECT COUNT(*) FROM product_variants v WHERE v.product_id = p.id) AS variant_count,
            (SELECT COUNT(*) FROM product_compatibility pc WHERE pc.product_id = p.id) AS compat_count,
            (SELECT COUNT(*) FROM product_compatibility pc
              WHERE pc.product_id = p.id AND pc.verified = 1) AS verified_count,
            (SELECT MIN(vp.amount) FROM variant_prices vp
               JOIN product_variants v ON v.id = vp.variant_id
              WHERE v.product_id = p.id) AS min_price
       FROM products p
       LEFT JOIN product_translations pt ON pt.product_id = p.id AND pt.locale = 'it'
       LEFT JOIN brands b ON b.id = p.brand_id
      ${q ? "WHERE LOWER(pt.name) LIKE ?1 OR LOWER(p.slug) LIKE ?1" : ""}
      ORDER BY p.updated_at DESC LIMIT 100`,
  )
    .bind(...(q ? [`%${q.toLowerCase()}%`] : []))
    .all<{
      id: string;
      slug: string;
      status: string;
      archived_at: number | null;
      name: string | null;
      brand_name: string | null;
      variant_count: number;
      compat_count: number;
      verified_count: number;
      min_price: number | null;
    }>();

  return {
    products: results,
    query: q,
    canWrite: actor.permissions.includes("product.write"),
    canArchive: actor.permissions.includes("product.archive"),
    canPrice: actor.permissions.includes("price.write"),
  };
}

export async function action({ request, context }: Route.ActionArgs) {
  const { env } = context.get(cloudflareContext);
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");
  const now = systemClock.now();

  if (intent === "set-status") {
    const actor = await requireStaff(request, env, "product.write");
    const productId = String(form.get("productId") ?? "");
    const status = String(form.get("status") ?? "");

    if (!["draft", "active"].includes(status)) return { error: "Stato non valido." };

    await env.DB.batch([
      env.DB.prepare(
        `UPDATE products SET status = ?1, published_at = COALESCE(published_at, ?2), updated_at = ?2
          WHERE id = ?3`,
      ).bind(status, now, productId),
      env.DB.prepare(
        `INSERT INTO audit_logs (id, actor_id, actor_label, action, entity_type, entity_id, after_value, created_at)
         VALUES (?1,?2,?3,'product.status','product',?4,?5,?6)`,
      ).bind(
        cryptoIds.generate(),
        actor.userId,
        actor.displayName,
        productId,
        JSON.stringify({ status }),
        now,
      ),
    ]);
    return { success: `Prodotto aggiornato: ${status}.` };
  }

  if (intent === "archive") {
    const actor = await requireStaff(request, env, "product.archive");
    const productId = String(form.get("productId") ?? "");

    // Archive, never delete: orders reference this row (invariant 13).
    await env.DB.batch([
      env.DB.prepare(
        `UPDATE products SET archived_at = ?1, status = 'archived', updated_at = ?1 WHERE id = ?2`,
      ).bind(now, productId),
      env.DB.prepare(
        `INSERT INTO audit_logs (id, actor_id, actor_label, action, entity_type, entity_id, after_value, created_at)
         VALUES (?1,?2,?3,'product.archive','product',?4,?5,?6)`,
      ).bind(
        cryptoIds.generate(),
        actor.userId,
        actor.displayName,
        productId,
        JSON.stringify({ archived: true }),
        now,
      ),
    ]);
    return { success: "Prodotto archiviato. Gli ordini storici restano intatti." };
  }

  if (intent === "set-price") {
    const actor = await requireStaff(request, env, "price.write");
    const variantId = String(form.get("variantId") ?? "");
    const raw = String(form.get("amount") ?? "");

    let amount: number;
    try {
      amount = parseAmountToMinorUnits(raw);
    } catch {
      return { error: `Importo non leggibile: "${raw}". Usa la forma 39,90.` };
    }
    if (amount < 0) return { error: "Il prezzo non può essere negativo." };

    const current = await env.DB.prepare(
      `SELECT vp.id, vp.amount, vp.price_list_id FROM variant_prices vp
         JOIN price_lists pl ON pl.id = vp.price_list_id AND pl.is_default = 1
        WHERE vp.variant_id = ?1`,
    )
      .bind(variantId)
      .first<{ id: string; amount: number; price_list_id: string }>();
    if (!current) return { error: "Prezzo non trovato." };
    if (current.amount === amount) return { success: "Nessuna modifica." };

    await env.DB.batch([
      env.DB.prepare(`UPDATE variant_prices SET amount = ?1, updated_at = ?2 WHERE id = ?3`).bind(
        amount,
        now,
        current.id,
      ),
      // Close the previous history row, then open a new one. This is what makes
      // the 30-day prior price evidenced rather than asserted.
      env.DB.prepare(
        `UPDATE price_history SET effective_to = ?1
          WHERE variant_id = ?2 AND effective_to IS NULL`,
      ).bind(now, variantId),
      env.DB.prepare(
        `INSERT INTO price_history
           (id, variant_id, price_list_id, old_amount, new_amount, currency, channel,
            effective_from, reason, changed_by, created_at)
         VALUES (?1,?2,?3,?4,?5,'EUR','online',?6,'admin edit',?7,?6)`,
      ).bind(
        cryptoIds.generate(),
        variantId,
        current.price_list_id,
        current.amount,
        amount,
        now,
        actor.userId,
      ),
      env.DB.prepare(
        `INSERT INTO audit_logs (id, actor_id, actor_label, action, entity_type, entity_id, before_value, after_value, created_at)
         VALUES (?1,?2,?3,'price.update','variant_price',?4,?5,?6,?7)`,
      ).bind(
        cryptoIds.generate(),
        actor.userId,
        actor.displayName,
        variantId,
        JSON.stringify({ amount: current.amount }),
        JSON.stringify({ amount }),
        now,
      ),
    ]);

    return {
      success: `Prezzo aggiornato: ${formatMoney(money(current.amount))} → ${formatMoney(money(amount))}.`,
    };
  }

  return { error: "Azione non riconosciuta." };
}

export default function AdminProducts({ loaderData, actionData }: Route.ComponentProps) {
  const { products, query, canWrite, canArchive } = loaderData;

  return (
    <div className="stack">
      <h1>Prodotti</h1>

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

      <Form method="get" role="search" className="cluster">
        <div className="field">
          <label className="field__label" htmlFor="q">
            Cerca
          </label>
          <input id="q" name="q" type="search" className="input" defaultValue={query} />
        </div>
        <button type="submit" className="btn btn--secondary">
          Cerca
        </button>
      </Form>

      {products.length === 0 ? (
        <div className="empty-state">
          <p>Nessun prodotto{query ? ` per "${query}"` : ""}.</p>
          <p className="small">
            I prodotti si importano dal centro importazioni, non ancora disponibile. Vedi{" "}
            <code>docs/known-limitations.md</code>.
          </p>
        </div>
      ) : (
        <div className="admin-table-wrap">
          <table className="admin-table">
            <caption className="visually-hidden">Elenco prodotti</caption>
            <thead>
              <tr>
                <th scope="col">Nome</th>
                <th scope="col">Marca</th>
                <th scope="col">Varianti</th>
                <th scope="col">Compatibilità</th>
                <th scope="col">Prezzo da</th>
                <th scope="col">Stato</th>
                <th scope="col">Azioni</th>
              </tr>
            </thead>
            <tbody>
              {products.map((product) => (
                <tr key={product.id}>
                  <td>
                    <Link to={`/prodotti/${product.slug}`}>{product.name ?? product.slug}</Link>
                  </td>
                  <td className="small">{product.brand_name ?? "—"}</td>
                  <td className="numeric">{product.variant_count}</td>
                  <td className="small">
                    {product.compat_count === 0 ? (
                      <span className="muted">nessuna</span>
                    ) : (
                      <>
                        {product.verified_count}/{product.compat_count} verificate
                        {/* An unverified record is surfaced as unverified on
                            the storefront, so staff should see the gap here. */}
                        {product.verified_count < product.compat_count ? (
                          <span className="badge badge--warning"> da verificare</span>
                        ) : null}
                      </>
                    )}
                  </td>
                  <td className="numeric">
                    {product.min_price !== null ? formatMoney(money(product.min_price)) : "—"}
                  </td>
                  <td className="small">{product.archived_at ? "archiviato" : product.status}</td>
                  <td>
                    <div className="cluster">
                      {canWrite && !product.archived_at ? (
                        <Form method="post">
                          <input type="hidden" name="intent" value="set-status" />
                          <input type="hidden" name="productId" value={product.id} />
                          <input
                            type="hidden"
                            name="status"
                            value={product.status === "active" ? "draft" : "active"}
                          />
                          <button type="submit" className="btn btn--ghost">
                            {product.status === "active" ? "Metti in bozza" : "Pubblica"}
                          </button>
                        </Form>
                      ) : null}

                      {canArchive && !product.archived_at ? (
                        <Form method="post">
                          <input type="hidden" name="intent" value="archive" />
                          <input type="hidden" name="productId" value={product.id} />
                          <button type="submit" className="btn btn--ghost">
                            Archivia
                          </button>
                        </Form>
                      ) : null}
                    </div>
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
