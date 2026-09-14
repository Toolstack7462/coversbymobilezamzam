import { adminTranslator } from "~/lib/admin-i18n";
import { adminLocaleFromMatches } from "~/lib/admin-locale";
import { useAdminTranslator } from "~/components/admin/use-admin-translator";
import { Link, Form } from "react-router";
import type { Route } from "./+types/search";
import { appContext } from "~/runtime/context";
import type { AppEnv } from "~/runtime/context";
import { requireStaff } from "~/infrastructure/auth/session.server";
import { PageHeader } from "~/components/admin/admin-shell";
import { StatusBadge } from "~/components/admin/status-badge";
import { EmptyState } from "~/components/admin/patterns";
import { breadcrumbsFor } from "~/lib/admin-nav";
import { money, format as formatMoney } from "~/domain/pricing/money";

/**
 * One search box for the whole control centre.
 *
 * ── WHY IT EXISTS ───────────────────────────────────────────────────────────
 *
 * Every list had its own search and none of them crossed. A customer rings up
 * quoting an order number, and the merchant had to know that order numbers live
 * under Ordini before they could look it up. Somebody reads a SKU off a box and
 * had to be on the product screen first. The thing being searched for is known;
 * which screen owns it is not, and that is the shop's problem to solve, not the
 * merchant's.
 *
 * ── WHAT IT IS NOT ──────────────────────────────────────────────────────────
 *
 * Not a fuzzy relevance engine. Four exact-ish lookups against indexed columns,
 * each bounded to five rows. A global search that scans the catalogue is a
 * global search that gets switched off after the first busy afternoon.
 *
 * Product NAME search deliberately goes through the same prefix matching the
 * storefront uses rather than a leading-wildcard LIKE, which cannot use an
 * index.
 *
 * ── PERMISSIONS ─────────────────────────────────────────────────────────────
 *
 * Each section is queried ONLY if the actor holds the permission for it. Not
 * queried-then-hidden: a staff member without `payment.read` must not be able
 * to learn that an order exists by watching a result count change. The server
 * is the authority; the topbar's box is only an entry point.
 */

/** Bounded per section. A global search is a jump list, not a report. */
const PER_SECTION = 5;

/** Longer than any SKU or order number this system issues. */
const MAX_QUERY = 64;

interface ProductHit {
  id: string;
  slug: string;
  name: string | null;
  status: string;
  sku: string | null;
}

interface OrderHit {
  id: string;
  order_number: string;
  status: string;
  customer_first_name: string;
  customer_last_name: string;
  grand_total: number;
}

interface CustomerHit {
  customer_email: string;
  customer_first_name: string;
  customer_last_name: string;
  orders: number;
}

interface DeviceHit {
  id: string;
  handle: string;
  name: string;
  brand_name: string | null;
}

export function meta({ matches }: Route.MetaArgs) {
  const t = adminTranslator(adminLocaleFromMatches(matches));
  return [{ title: t("Cerca") }, { name: "robots", content: "noindex, nofollow" }];
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const { env } = context.get(appContext);
  const actor = await requireStaff(request, env);

  const url = new URL(request.url);
  const raw = (url.searchParams.get("q") ?? "").trim().slice(0, MAX_QUERY);

  if (raw === "") {
    return { query: "", products: [], orders: [], customers: [], devices: [], searched: false };
  }

  const can = (permission: string) => actor.permissions.includes(permission);

  /*
   * Two patterns, on purpose.
   *
   * `prefix` anchors at the start so the index can be used — that is the fast
   * path and the one most lookups take, because a merchant types the beginning
   * of a SKU or an order number. `contains` is the fallback for a name, and is
   * accepted as a scan precisely because it is bounded to five rows.
   */
  const prefix = `${raw.toLowerCase()}%`;
  const contains = `%${raw.toLowerCase()}%`;

  const [products, orders, customers, devices] = await Promise.all([
    can("product.read") ? findProducts(env, prefix, contains) : Promise.resolve([]),
    can("order.read") ? findOrders(env, prefix, contains) : Promise.resolve([]),
    can("order.read") ? findCustomers(env, contains) : Promise.resolve([]),
    can("device.read") ? findDevices(env, contains) : Promise.resolve([]),
  ]);

  return { query: raw, products, orders, customers, devices, searched: true };
}

async function findProducts(env: AppEnv, prefix: string, contains: string): Promise<ProductHit[]> {
  const { results } = await env.DB.prepare(
    `SELECT p.id, p.slug, pt.name, p.status,
            (SELECT v.sku FROM product_variants v
              WHERE v.product_id = p.id AND v.archived_at IS NULL
              ORDER BY v.is_default DESC, v.sort_order ASC LIMIT 1) AS sku
       FROM products p
       LEFT JOIN product_translations pt ON pt.product_id = p.id AND pt.locale = 'it'
      WHERE p.archived_at IS NULL
        AND (LOWER(pt.name) LIKE ?2
             OR LOWER(p.slug) LIKE ?1
             OR EXISTS (SELECT 1 FROM product_variants v
                         WHERE v.product_id = p.id AND LOWER(v.sku) LIKE ?1))
      ORDER BY p.is_featured DESC, p.updated_at DESC
      LIMIT ?3`,
  )
    .bind(prefix, contains, PER_SECTION)
    .all<ProductHit>();
  return results;
}

async function findOrders(env: AppEnv, prefix: string, contains: string): Promise<OrderHit[]> {
  const { results } = await env.DB.prepare(
    `SELECT o.id, o.order_number, o.status, o.customer_first_name, o.customer_last_name,
            o.grand_total
       FROM orders o
      WHERE LOWER(o.order_number) LIKE ?1
         OR LOWER(o.customer_email) LIKE ?2
         OR LOWER(o.customer_last_name) LIKE ?2
      ORDER BY o.created_at DESC
      LIMIT ?3`,
  )
    .bind(prefix, contains, PER_SECTION)
    .all<OrderHit>();
  return results;
}

/**
 * Customers are DERIVED from orders; there is no customer table.
 *
 * That is deliberate elsewhere in this system and is preserved here: this
 * search must not invent a customer record, so it groups the orders that
 * already exist.
 */
async function findCustomers(env: AppEnv, contains: string): Promise<CustomerHit[]> {
  const { results } = await env.DB.prepare(
    `SELECT o.customer_email, o.customer_first_name, o.customer_last_name,
            COUNT(*) AS orders
       FROM orders o
      WHERE LOWER(o.customer_email) LIKE ?1
         OR LOWER(o.customer_last_name) LIKE ?1
         OR LOWER(o.customer_first_name) LIKE ?1
      GROUP BY o.customer_email, o.customer_first_name, o.customer_last_name
      ORDER BY COUNT(*) DESC
      LIMIT ?2`,
  )
    .bind(contains, PER_SECTION)
    .all<CustomerHit>();
  return results;
}

async function findDevices(env: AppEnv, contains: string): Promise<DeviceHit[]> {
  const { results } = await env.DB.prepare(
    `SELECT dm.id, dm.handle, dm.name, db.name AS brand_name
       FROM device_models dm
       LEFT JOIN device_brands db ON db.id = dm.device_brand_id
      WHERE dm.archived_at IS NULL
        AND (LOWER(dm.name) LIKE ?1 OR LOWER(dm.handle) LIKE ?1)
      ORDER BY dm.is_popular DESC, dm.sort_order ASC
      LIMIT ?2`,
  )
    .bind(contains, PER_SECTION)
    .all<DeviceHit>();
  return results;
}

export default function AdminSearch({ loaderData }: Route.ComponentProps) {
  const t = useAdminTranslator();
  const { query, products, orders, customers, devices, searched } = loaderData;
  const total = products.length + orders.length + customers.length + devices.length;

  return (
    <>
      <PageHeader
        title={t("Cerca")}
        description={t("Prodotti, ordini, clienti e dispositivi, in un posto solo.")}
        breadcrumbs={breadcrumbsFor("/admin/cerca")}
      />

      <Form method="get" className="ac-search" role="search">
        <label className="visually-hidden" htmlFor="ac-global-q">
          {t("Cerca")}
        </label>
        <input
          id="ac-global-q"
          type="search"
          name="q"
          defaultValue={query}
          maxLength={MAX_QUERY}
          placeholder={t("Numero d'ordine, SKU, nome prodotto, email, modello")}
          autoFocus
        />
        <button type="submit" className="btn btn--secondary">
          {t("Cerca")}
        </button>
      </Form>

      {!searched ? (
        <p className="muted small">
          {t(
            "Digita quello che hai davanti: il numero su un'email, lo SKU su una scatola, il cognome di chi ha telefonato.",
          )}
        </p>
      ) : total === 0 ? (
        <EmptyState
          title={t('Nessun risultato per "{{v0}}"', { v0: query })}
          body="Nessun prodotto, ordine, cliente o dispositivo corrisponde. Controlla il testo, oppure cerca dentro la sezione giusta dove i filtri sono più precisi."
        />
      ) : (
        <div className="stack">
          <Section title={t("Prodotti")} count={products.length}>
            {products.map((p) => (
              <ResultRow
                key={p.id}
                to={`/admin/prodotti/${p.id}`}
                title={p.name ?? p.slug}
                meta={p.sku ?? p.slug}
                badge={<StatusBadge kind="product" value={p.status} />}
              />
            ))}
          </Section>

          <Section title={t("Ordini")} count={orders.length}>
            {orders.map((o) => (
              <ResultRow
                key={o.id}
                to={`/admin/ordini/${o.id}`}
                title={o.order_number}
                meta={`${o.customer_first_name} ${o.customer_last_name} · ${formatMoney(money(o.grand_total), t.intl)}`}
                badge={<StatusBadge kind="order" value={o.status} />}
              />
            ))}
          </Section>

          <Section title={t("Clienti")} count={customers.length}>
            {customers.map((c) => (
              <ResultRow
                key={c.customer_email}
                to={`/admin/clienti?q=${encodeURIComponent(c.customer_email)}`}
                title={`${c.customer_first_name} ${c.customer_last_name}`}
                meta={`${c.customer_email} · ${t("{{v0}} ordini", { v0: c.orders })}`}
              />
            ))}
          </Section>

          <Section title={t("Dispositivi")} count={devices.length}>
            {devices.map((d) => (
              <ResultRow
                key={d.id}
                to={`/admin/dispositivi?q=${encodeURIComponent(d.name)}`}
                title={d.name}
                meta={d.brand_name ?? d.handle}
              />
            ))}
          </Section>
        </div>
      )}
    </>
  );
}

/** A section is omitted entirely when it has nothing — not shown as empty. */
function Section({
  title,
  count,
  children,
}: {
  title: string;
  count: number;
  children: React.ReactNode;
}) {
  if (count === 0) return null;
  return (
    <section className="stack" aria-labelledby={`sec-${title}`}>
      <h2 id={`sec-${title}`} className="h4">
        {title} <span className="ac-view__count numeric">{count}</span>
      </h2>
      <ul className="ac-results">{children}</ul>
    </section>
  );
}

function ResultRow({
  to,
  title,
  meta,
  badge,
}: {
  to: string;
  title: string;
  meta: string;
  badge?: React.ReactNode;
}) {
  return (
    <li className="ac-result">
      <Link to={to} className="ac-result__link">
        <span className="ac-result__title">{title}</span>
        <span className="ac-result__meta small muted">{meta}</span>
      </Link>
      {badge}
    </li>
  );
}
