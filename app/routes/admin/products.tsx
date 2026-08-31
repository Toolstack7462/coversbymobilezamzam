import type { Route } from "./+types/products";
import { Link } from "react-router";
import { cloudflareContext } from "../../../workers/app";
import { requireStaff } from "~/infrastructure/auth/session.server";
import { systemClock, cryptoIds } from "~/infrastructure/primitives";
import { money, format as formatMoney, parseAmountToMinorUnits } from "~/domain/pricing/money";
import { parseTableParams, paginate, orderByClause, type TableSpec } from "~/lib/table-params";
import { breadcrumbsFor } from "~/lib/admin-nav";
import { PageHeader } from "~/components/admin/admin-shell";
import { DataTable, type Column } from "~/components/admin/data-table";
import { PRODUCT_VIEWS, PRODUCT_VIEW_SLUGS } from "~/lib/product-views";

/**
 * Products.
 *
 * The list is the shared DataTable, so sorting, paging, search and the saved
 * views behave the same here as everywhere else and all live in the URL.
 *
 * Two operations that carry real risk are handled carefully in the action:
 *
 *   - A price change writes a `price_history` row. Without it the 30-day prior
 *     price cannot be evidenced, and a discount could not lawfully be announced
 *     (D.Lgs. 84/2022).
 *   - A product is ARCHIVED, never deleted, because orders reference it
 *     (invariant 13). The foreign key would refuse a delete anyway.
 */

export function meta() {
  return [{ title: "Prodotti" }, { name: "robots", content: "noindex, nofollow" }];
}

const SPEC: TableSpec = {
  views: PRODUCT_VIEW_SLUGS,
  sortable: ["name", "brand", "status", "price", "updated"],
  defaultSort: { key: "updated", direction: "desc" },
};

/** Declared sort keys mapped to columns. No user input ever becomes SQL. */
const SORT_COLUMNS: Record<string, string> = {
  name: "pt.name",
  brand: "b.name",
  status: "p.status",
  price: "min_price",
  updated: "p.updated_at",
};

interface ProductRow {
  id: string;
  slug: string;
  status: string;
  archived_at: number | null;
  updated_at: number;
  name: string | null;
  brand_name: string | null;
  variant_count: number;
  compat_count: number;
  verified_count: number;
  min_price: number | null;
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const { env } = context.get(cloudflareContext);
  const actor = await requireStaff(request, env, "product.read");

  const url = new URL(request.url);
  const state = parseTableParams(url.searchParams, SPEC);
  const view = PRODUCT_VIEWS.find((v) => v.slug === state.view) ?? PRODUCT_VIEWS[0]!;

  const conditions: string[] = [view.where];
  const binds: unknown[] = [];

  if (state.q) {
    // LIKE, not FTS5: this table is small, and the search has to match a
    // partial SKU as readily as a partial name. FTS5 is for the storefront.
    binds.push(`%${state.q.toLowerCase()}%`);
    conditions.push(`(LOWER(pt.name) LIKE ?${binds.length}
                      OR LOWER(p.slug) LIKE ?${binds.length}
                      OR EXISTS (SELECT 1 FROM product_variants v
                                  WHERE v.product_id = p.id
                                    AND LOWER(v.sku) LIKE ?${binds.length}))`);
  }

  const where = conditions.join(" AND ");
  const from = `FROM products p
       LEFT JOIN product_translations pt ON pt.product_id = p.id AND pt.locale = 'it'
       LEFT JOIN brands b ON b.id = p.brand_id`;

  // ORDER BY is always present, and always ends with a unique tiebreaker: an
  // unstable order in SQLite lets rows repeat or vanish between pages.
  const orderBy = orderByClause(state.sort, SORT_COLUMNS, "p.updated_at DESC");

  const [totalRow, page, viewCounts] = await Promise.all([
    env.DB.prepare(`SELECT COUNT(*) AS n ${from} WHERE ${where}`)
      .bind(...binds)
      .first<{ n: number }>(),

    env.DB.prepare(
      `SELECT p.id, p.slug, p.status, p.archived_at, p.updated_at,
              pt.name, b.name AS brand_name,
              (SELECT COUNT(*) FROM product_variants v WHERE v.product_id = p.id) AS variant_count,
              (SELECT COUNT(*) FROM product_compatibility pc WHERE pc.product_id = p.id) AS compat_count,
              (SELECT COUNT(*) FROM product_compatibility pc
                WHERE pc.product_id = p.id AND pc.verified = 1) AS verified_count,
              (SELECT MIN(vp.amount) FROM variant_prices vp
                 JOIN product_variants v ON v.id = vp.variant_id
                WHERE v.product_id = p.id) AS min_price
         ${from}
        WHERE ${where}
        ORDER BY ${orderBy}, p.id
        LIMIT ?${binds.length + 1} OFFSET ?${binds.length + 2}`,
    )
      .bind(...binds, state.perPage, (state.page - 1) * state.perPage)
      .all<ProductRow>(),

    // Tab counts deliberately ignore the search box: a tab whose number moves
    // as you type is telling you about your query, not about your shop.
    env.DB.prepare(
      `SELECT ${PRODUCT_VIEWS.map((v, i) => `SUM(CASE WHEN ${v.where} THEN 1 ELSE 0 END) AS v${i}`).join(", ")}
         ${from}`,
    ).first<Record<string, number>>(),
  ]);

  const total = totalRow?.n ?? 0;

  return {
    rows: page.results,
    state,
    pagination: paginate(state, total),
    views: PRODUCT_VIEWS.map((v, i) => ({
      slug: v.slug,
      label: v.label,
      count: Number(viewCounts?.[`v${i}`] ?? 0),
    })),
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
  const { rows, state, pagination, views, canWrite } = loaderData;

  const columns: Column<ProductRow>[] = [
    {
      key: "name",
      header: "Prodotto",
      render: (row) => (
        <>
          <Link to={`/admin/prodotti/${row.id}`}>{row.name ?? row.slug}</Link>
          {/* A product with no Italian name is not a blank row; it is a row
              whose translation is missing, and saying so is more useful. */}
          {row.name === null ? (
            <span className="badge badge--warning"> traduzione mancante</span>
          ) : null}
        </>
      ),
    },
    { key: "brand", header: "Marchio", render: (row) => row.brand_name ?? "—", secondary: true },
    {
      key: "status",
      header: "Stato",
      render: (row) => <StatusBadge status={row.archived_at ? "archived" : row.status} />,
    },
    {
      key: "price",
      header: "Prezzo da",
      numeric: true,
      render: (row) =>
        row.min_price === null ? (
          // Not "€0,00". A missing price and a free product are different facts.
          <span className="badge badge--warning">nessun prezzo</span>
        ) : (
          formatMoney(money(row.min_price))
        ),
    },
    {
      key: "variants",
      header: "Varianti",
      numeric: true,
      secondary: true,
      render: (row) => row.variant_count,
    },
    {
      key: "compat",
      header: "Compatibilità",
      secondary: true,
      render: (row) =>
        row.compat_count === 0 ? (
          <span className="muted">nessuna</span>
        ) : (
          <span className="numeric">
            {row.verified_count}/{row.compat_count} verificate
          </span>
        ),
    },
  ];

  return (
    <>
      <PageHeader
        title="Prodotti"
        description="Il catalogo. Ogni riga porta alla scheda completa."
        breadcrumbs={breadcrumbsFor("/admin/prodotti")}
        {...(canWrite
          ? { primaryAction: { label: "Aggiungi prodotto", to: "/admin/prodotti/nuovo" } }
          : {})}
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
        rowHref={(row) => `/admin/prodotti/${row.id}`}
        views={views}
        searchLabel="Cerca per nome, slug o SKU"
        emptyState={{
          title: "Nessun prodotto",
          body: "Il catalogo è vuoto. Il primo prodotto è anche il modo più rapido per vedere come appare il sito.",
          ...(canWrite
            ? { action: { label: "Aggiungi il primo prodotto", to: "/admin/prodotti/nuovo" } }
            : {}),
        }}
      />
    </>
  );
}

function StatusBadge({ status }: { status: string }) {
  const label =
    status === "active"
      ? "Pubblicato"
      : status === "draft"
        ? "Bozza"
        : status === "archived"
          ? "Archiviato"
          : status;

  // The word carries the meaning; the colour only reinforces it.
  const tone =
    status === "active" ? "badge--success" : status === "archived" ? "badge--muted" : "badge--info";

  return <span className={`badge ${tone}`}>{label}</span>;
}
