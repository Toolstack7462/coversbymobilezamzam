import { Link, useLocation } from "react-router";
import type { Route } from "./+types/customers";
import { cloudflareContext } from "../../../workers/app";
import { requireStaff } from "~/infrastructure/auth/session.server";
import { money, format as formatMoney } from "~/domain/pricing/money";
import { formatDateTime } from "~/lib/i18n";
import { parseTableParams, paginate, orderByClause, type TableSpec } from "~/lib/table-params";
import { breadcrumbsFor } from "~/lib/admin-nav";
import { PageHeader } from "~/components/admin/admin-shell";
import { DataTable, type Column } from "~/components/admin/data-table";

/**
 * Customers.
 *
 * **There is no customers table, and this screen does not create one.**
 *
 * The shop sells to guests: an order carries the buyer's name, email and phone,
 * and nothing requires an account. So a "customer" here is exactly what the
 * data supports — a history of orders that share an email address — and the
 * screen is a GROUP BY over orders rather than a record with a life of its own.
 *
 * That is the honest shape, and it avoids a specific harm. A customers table
 * would be a second copy of personal data that has to be kept in step with the
 * orders, and would outlive the orders it came from: deleting a customer's
 * orders would leave the customer, and a GDPR erasure request would then have
 * two places to reach rather than one. Derived means there is exactly one copy,
 * inside the order it was given for.
 *
 * The cost, stated plainly: someone who orders once as `mario@example.com` and
 * once as `Mario@Example.com` is one person and two rows here. Emails are
 * lower-cased for grouping, which handles that; someone using two different
 * addresses is genuinely two customers as far as this shop can tell, and
 * pretending otherwise would require guessing.
 */

export function meta() {
  return [{ title: "Clienti" }, { name: "robots", content: "noindex, nofollow" }];
}

const SPEC: TableSpec = {
  views: ["tutti", "abituali", "recenti"],
  sortable: ["name", "orders", "spent", "last"],
  defaultSort: { key: "last", direction: "desc" },
  perPage: 50,
};

const SORT_COLUMNS: Record<string, string> = {
  name: "customer_last_name",
  orders: "order_count",
  spent: "total_spent",
  last: "last_order_at",
};

const VIEWS = [
  { slug: "tutti", label: "Tutti", having: "1 = 1" },
  // Two or more orders. The distinction a shop actually acts on: a returning
  // customer is the one worth recognising at the counter.
  { slug: "abituali", label: "Abituali", having: "COUNT(*) > 1" },
  { slug: "recenti", label: "Ultimi 90 giorni", having: "MAX(o.created_at) > ?BOUND" },
] as const;

interface CustomerRow {
  email: string;
  customer_first_name: string;
  customer_last_name: string;
  customer_phone: string | null;
  order_count: number;
  total_spent: number;
  verified_spent: number;
  last_order_at: number;
  first_order_at: number;
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const { env } = context.get(cloudflareContext);
  const actor = await requireStaff(request, env, "customer.read");

  const url = new URL(request.url);
  const state = parseTableParams(url.searchParams, SPEC);
  const view = VIEWS.find((v) => v.slug === state.view) ?? VIEWS[0];

  const ninetyDaysAgo = Date.now() - 90 * 24 * 60 * 60 * 1000;
  const binds: unknown[] = [];

  // `?BOUND` is a placeholder in the view definition rather than a bound
  // parameter, because the HAVING clauses are fixed strings and only this one
  // needs a value. Substituted here, never from request data.
  const having = view.having.replace("?BOUND", String(ninetyDaysAgo));

  const whereParts = ["o.status NOT IN ('draft')"];
  if (state.q) {
    binds.push(`%${state.q.toLowerCase()}%`);
    whereParts.push(`(LOWER(o.customer_email) LIKE ?${binds.length}
                      OR LOWER(o.customer_last_name) LIKE ?${binds.length}
                      OR LOWER(o.customer_first_name) LIKE ?${binds.length})`);
  }
  const where = whereParts.join(" AND ");

  const grouped = `
    SELECT LOWER(o.customer_email) AS email,
           MAX(o.customer_first_name) AS customer_first_name,
           MAX(o.customer_last_name) AS customer_last_name,
           MAX(o.customer_phone) AS customer_phone,
           COUNT(*) AS order_count,
           -- Ordered, not necessarily paid. Kept separate from what was
           -- actually verified, because calling the first figure "spent" would
           -- overstate every customer who abandoned an order.
           COALESCE(SUM(CASE WHEN o.status NOT IN ('cancelled','expired')
                             THEN o.grand_total ELSE 0 END), 0) AS total_spent,
           COALESCE((SELECT SUM(p.amount_received) FROM order_payments p
                       JOIN orders o2 ON o2.id = p.order_id
                      WHERE LOWER(o2.customer_email) = LOWER(o.customer_email)
                        AND p.status = 'verified'), 0) AS verified_spent,
           MAX(o.created_at) AS last_order_at,
           MIN(o.created_at) AS first_order_at
      FROM orders o
     WHERE ${where}
     GROUP BY LOWER(o.customer_email)
    HAVING ${having}`;

  const orderBy = orderByClause(state.sort, SORT_COLUMNS, "last_order_at DESC");

  const [totalRow, page, viewCounts] = await Promise.all([
    env.DB.prepare(`SELECT COUNT(*) AS n FROM (${grouped})`)
      .bind(...binds)
      .first<{ n: number }>(),

    env.DB.prepare(
      `SELECT * FROM (${grouped}) ORDER BY ${orderBy}, email
        LIMIT ?${binds.length + 1} OFFSET ?${binds.length + 2}`,
    )
      .bind(...binds, state.perPage, (state.page - 1) * state.perPage)
      .all<CustomerRow>(),

    env.DB.prepare(
      `SELECT
         (SELECT COUNT(*) FROM (SELECT 1 FROM orders o WHERE o.status NOT IN ('draft')
            GROUP BY LOWER(o.customer_email))) AS v0,
         (SELECT COUNT(*) FROM (SELECT 1 FROM orders o WHERE o.status NOT IN ('draft')
            GROUP BY LOWER(o.customer_email) HAVING COUNT(*) > 1)) AS v1,
         (SELECT COUNT(*) FROM (SELECT 1 FROM orders o WHERE o.status NOT IN ('draft')
            GROUP BY LOWER(o.customer_email) HAVING MAX(o.created_at) > ?1)) AS v2`,
    )
      .bind(ninetyDaysAgo)
      .first<Record<string, number>>(),
  ]);

  return {
    rows: page.results,
    state,
    pagination: paginate(state, totalRow?.n ?? 0),
    views: VIEWS.map((v, i) => ({
      slug: v.slug,
      label: v.label,
      count: Number(viewCounts?.[`v${i}`] ?? 0),
    })),
    canSeePayments: actor.permissions.includes("payment.read"),
  };
}

export default function Customers({ loaderData }: Route.ComponentProps) {
  const { pathname } = useLocation();
  const { rows, state, pagination, views, canSeePayments } = loaderData;

  const columns: Column<CustomerRow>[] = [
    {
      key: "name",
      header: "Cliente",
      render: (row) => (
        <>
          {`${row.customer_first_name} ${row.customer_last_name}`.trim() || "—"}
          <br />
          <span className="caption muted">{row.email}</span>
        </>
      ),
    },
    {
      key: "phone",
      header: "Telefono",
      secondary: true,
      render: (row) => row.customer_phone ?? <span className="muted">—</span>,
    },
    {
      key: "orders",
      header: "Ordini",
      numeric: true,
      render: (row) => (
        <Link to={`/admin/ordini?q=${encodeURIComponent(row.email)}`}>{row.order_count}</Link>
      ),
    },
    {
      key: "spent",
      header: "Ordinato",
      numeric: true,
      render: (row) => formatMoney(money(row.total_spent)),
    },
    ...(canSeePayments
      ? [
          {
            key: "verified",
            header: "Incassato",
            numeric: true,
            secondary: true,
            // The two differ by everything ordered and never paid for. Showing
            // only the first would overstate every abandoned order as revenue.
            render: (row: CustomerRow) => formatMoney(money(row.verified_spent)),
          },
        ]
      : []),
    {
      key: "last",
      header: "Ultimo ordine",
      secondary: true,
      render: (row) => <span className="small">{formatDateTime(row.last_order_at, "it")}</span>,
    },
  ];

  return (
    <>
      <PageHeader
        title="Clienti"
        description="Chi ha comprato, quante volte. Ricavato dagli ordini: il negozio non tiene una rubrica separata."
        breadcrumbs={breadcrumbsFor(pathname)}
      />

      <p className="notice notice--info small">
        Questi dati vivono <strong>dentro gli ordini</strong>, non in un archivio clienti a parte.
        Significa una sola copia dei dati personali di ognuno: se un cliente chiede la
        cancellazione, c&apos;è un solo posto da cui toglierla. Due indirizzi email diversi restano
        due clienti diversi, perché il negozio non ha modo di sapere che sono la stessa persona.
      </p>

      <DataTable
        state={state}
        spec={SPEC}
        pagination={pagination}
        columns={columns}
        rows={rows}
        rowKey={(row) => row.email}
        views={views}
        searchLabel="Cerca per nome o email"
        emptyState={{
          title: "Nessun cliente",
          body: "Comparirà qui chiunque completi un ordine. Non serve che si registri: il negozio vende anche agli ospiti.",
        }}
      />
    </>
  );
}
