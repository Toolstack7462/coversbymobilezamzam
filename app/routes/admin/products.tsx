import { adminTranslator } from "~/lib/admin-i18n";
import { adminLocaleFromMatches } from "~/lib/admin-locale";
import { useAdminTranslator } from "~/components/admin/use-admin-translator";
import { saleableImagePredicate } from "~/domain/media/storefront-image";
import type { Route } from "./+types/products";
import { Link } from "react-router";
import { appContext } from "~/runtime/context";
import { requireStaff } from "~/infrastructure/auth/session.server";
import { systemClock, cryptoIds } from "~/infrastructure/primitives";
import { money, format as formatMoney, parseAmountToMinorUnits } from "~/domain/pricing/money";
import { parseTableParams, paginate, orderByClause, type TableSpec } from "~/lib/table-params";
import { breadcrumbsFor } from "~/lib/admin-nav";
import { PageHeader } from "~/components/admin/admin-shell";
import { DataTable, type Column } from "~/components/admin/data-table";
import { PRODUCT_VIEWS, PRODUCT_VIEW_SLUGS } from "~/lib/product-views";
import { StatusBadge } from "~/components/admin/status-badge";

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

export function meta({ matches }: Route.MetaArgs) {
  const t = adminTranslator(adminLocaleFromMatches(matches));
  return [{ title: t("Prodotti") }, { name: "robots", content: "noindex, nofollow" }];
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
  image_key: string | null;
  first_sku: string | null;
  /** on_hand - reserved, summed. NULL when nothing is tracked. */
  available: number | null;
  depleted_variants: number;
  variant_count: number;
  compat_count: number;
  verified_count: number;
  min_price: number | null;
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const { env } = context.get(appContext);
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
              /*
               * Thumbnail, first SKU and stock, added so the catalogue can be
               * SCANNED rather than opened row by row. A merchant looking for
               * "the blue one" needs the picture, and a merchant asked whether
               * something is in stock should not have to click into it.
               *
               * All correlated subqueries inside this one statement, matching
               * what min_price already does. One query per row for any of these
               * would be an N+1 on the busiest screen in the admin.
               */
              (SELECT pi.object_key FROM product_images pi
                WHERE pi.product_id = p.id AND ${saleableImagePredicate()}
                ORDER BY pi.is_primary DESC, pi.sort_order ASC LIMIT 1) AS image_key,
              (SELECT v.sku FROM product_variants v
                WHERE v.product_id = p.id AND v.archived_at IS NULL
                ORDER BY v.is_default DESC, v.sort_order ASC, v.sku ASC LIMIT 1) AS first_sku,
              /*
               * available = on_hand - reserved, summed across the product's
               * variants and locations. NULL when the product has no inventory
               * rows at all, which is "not_tracked" — different from zero, and
               * shown differently.
               */
              (SELECT SUM(il.on_hand - il.reserved) FROM inventory_levels il
                 JOIN product_variants v ON v.id = il.variant_id
                WHERE v.product_id = p.id AND v.archived_at IS NULL) AS available,
              (SELECT COUNT(*) FROM inventory_levels il
                 JOIN product_variants v ON v.id = il.variant_id
                WHERE v.product_id = p.id AND v.archived_at IS NULL
                  AND (il.on_hand - il.reserved) <= 0) AS depleted_variants,
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
    // The same resolution every other screen uses: a configured CDN base, or
    // the application's own /media route when there is none.
    mediaBaseUrl: env.PUBLIC_MEDIA_BASE_URL?.replace(/\/$/, "") ?? "/media",
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
  const { env } = context.get(appContext);
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
  const t = useAdminTranslator();
  const { rows, state, pagination, views, canWrite, mediaBaseUrl } = loaderData;

  const columns: Column<ProductRow>[] = [
    {
      key: "name",
      header: "Prodotto",
      width: "wide",
      render: (row) => (
        <div className="ac-product-cell">
          {row.image_key ? (
            <img
              className="ac-row-thumb"
              src={`${mediaBaseUrl}/${row.image_key}`}
              /*
               * Empty alt, on purpose. The product name is right beside it and
               * is the link; repeating it here makes a screen reader announce
               * every row twice. The picture accompanies the name, it does not
               * replace it.
               */
              alt=""
              width={40}
              height={40}
              loading="lazy"
              decoding="async"
            />
          ) : (
            /*
             * Not a grey placeholder. A missing photo is a job to do — there is
             * a "Senza immagine" view for exactly this — so the cell says so
             * rather than pretending to be a picture that failed to load.
             */
            <span className="ac-row-thumb ac-row-thumb--empty" title={t("Nessuna immagine")}>
              <span className="visually-hidden">{t("Nessuna immagine")}</span>
              <span aria-hidden="true">—</span>
            </span>
          )}
          <span>
            <Link to={`/admin/prodotti/${row.id}`}>{row.name ?? row.slug}</Link>
            {!row.image_key && canWrite ? (
              <Link className="ac-photo-task" to={`/admin/prodotti/${row.id}#sez-foto`}>
                {t("Completa le foto ")}
                <span aria-hidden="true">↗</span>
              </Link>
            ) : null}
            {/* A product with no Italian name is not a blank row; it is a row
              whose translation is missing, and saying so is more useful. */}
            {row.name === null ? (
              <span className="badge badge--warning"> {t(" traduzione mancante")}</span>
            ) : null}
          </span>
        </div>
      ),
    },
    {
      key: "sku",
      header: "SKU",
      secondary: true,
      nowrap: true,
      width: "shrink",
      render: (row) =>
        row.first_sku === null ? (
          <span className="muted">—</span>
        ) : (
          <span className="numeric" title={row.first_sku}>
            {row.first_sku}
            {/*
              A product with several variants has several SKUs, and printing one
              of them as if it were THE SKU is a small lie that costs somebody a
              wrong order. The suffix says there are more without pretending to
              list them.
            */}
            {row.variant_count > 1 ? (
              <span className="muted"> +{row.variant_count - 1}</span>
            ) : null}
          </span>
        ),
    },
    {
      key: "brand",
      header: "Marchio",
      render: (row) => row.brand_name ?? "—",
      secondary: true,
    },
    {
      key: "status",
      header: "Stato",
      width: "shrink",
      render: (row) => (
        <StatusBadge kind="product" value={row.archived_at ? "archived" : row.status} />
      ),
    },
    {
      key: "price",
      header: "Prezzo da",
      numeric: true,
      render: (row) =>
        row.min_price === null ? (
          // Not "€0,00". A missing price and a free product are different facts.
          <span className="badge badge--warning">{t("nessun prezzo")}</span>
        ) : (
          formatMoney(money(row.min_price), t.intl)
        ),
    },
    {
      key: "stock",
      header: "Scorte",
      numeric: true,
      width: "shrink",
      render: (row) => {
        /*
         * NULL means the product has no inventory rows at all — the shop does
         * not count it. That is not the same fact as counting it and having
         * none, so it is never shown as zero.
         */
        if (row.available === null) {
          return <StatusBadge kind="availability" value="not_tracked" />;
        }

        const available = Number(row.available);
        return (
          <span className="ac-cell-stack">
            <strong className="numeric">{available}</strong>
            {available <= 0 ? (
              <StatusBadge kind="availability" value="out_of_stock" describedAs="Scorte" />
            ) : row.depleted_variants > 0 ? (
              /*
               * A sum hides the shape: three of one colour and none of another
               * still totals three. Saying how many variants are gone is the
               * difference between "in stock" and "in stock, but not the one
               * the customer asked for".
               */
              <span className="badge badge--warning">
                {row.depleted_variants} {t(" esaurit")}
                {row.depleted_variants === 1 ? t("a") : "e"}
              </span>
            ) : null}
          </span>
        );
      },
    },
    {
      key: "variants",
      header: "Varianti",
      width: "shrink",
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
          <span className="muted">{t("nessuna")}</span>
        ) : (
          <span className="numeric">
            {row.verified_count}/{row.compat_count} {t(" verificate")}
          </span>
        ),
    },
  ];

  return (
    <>
      <PageHeader
        title={t("Prodotti")}
        description={t("Il catalogo. Ogni riga porta alla scheda completa.")}
        breadcrumbs={breadcrumbsFor("/admin/prodotti")}
        {...(canWrite
          ? { primaryAction: { label: "Aggiungi prodotto", to: "/admin/prodotti/nuovo" } }
          : {})}
      />

      {actionData && "error" in actionData && actionData.error ? (
        <p className="notice notice--danger" role="alert">
          {t(actionData.error)}
        </p>
      ) : null}
      {actionData && "success" in actionData && actionData.success ? (
        <p className="notice notice--info" role="status">
          {t(actionData.success)}
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
        searchLabel={t("Cerca per nome, slug o SKU")}
        emptyState={{
          title: t("Nessun prodotto"),
          body: t(
            "Il catalogo è vuoto. Il primo prodotto è anche il modo più rapido per vedere come appare il sito.",
          ),
          ...(canWrite
            ? { action: { label: t("Aggiungi il primo prodotto"), to: "/admin/prodotti/nuovo" } }
            : {}),
        }}
      />
    </>
  );
}
