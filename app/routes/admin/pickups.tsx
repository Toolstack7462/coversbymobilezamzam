import { Form, Link } from "react-router";
import type { Route } from "./+types/pickups";
import { cloudflareContext } from "../../../workers/app";
import { requireStaff } from "~/infrastructure/auth/session.server";
import { systemClock, cryptoIds } from "~/infrastructure/primitives";
import { formatDateTime } from "~/lib/i18n";
import { settingValue, SETTING_KEYS, canOfferPickup } from "~/domain/content/gates";
import { breadcrumbsFor } from "~/lib/admin-nav";
import { PageHeader } from "~/components/admin/admin-shell";

/**
 * Collection from the shop.
 *
 * The counter is this shop's one real advantage over a marketplace, and this is
 * the screen that runs it: which orders are waiting to be picked, which are
 * ready on the shelf, and who took what.
 *
 * ── Two states, and why they are separate ────────────────────────────────────
 *
 * "Ready" and "collected" are different facts and only one of them is about the
 * customer. Ready is a promise the shop makes — it is what triggers the "come
 * and get it" message — and collecting is the customer discharging it. Folding
 * them into one status loses the ability to answer "how long did that person
 * wait?", which is the only number that says whether this service is any good.
 *
 * ── Who collected it ─────────────────────────────────────────────────────────
 *
 * Recorded as a NAME, typed by whoever handed the parcel over, because it is
 * frequently not the person who ordered — a partner, a colleague, a parent. A
 * system that can only record "the customer collected it" makes staff either
 * lie or leave it blank.
 */
export function meta() {
  return [{ title: "Ritiri in negozio" }, { name: "robots", content: "noindex, nofollow" }];
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const { env } = context.get(cloudflareContext);
  const actor = await requireStaff(request, env, "order.read");

  const settingsResult = await env.DB.prepare(`SELECT key, value FROM store_settings`).all<{
    key: string;
    value: string;
  }>();
  const settings = Object.fromEntries(settingsResult.results.map((r) => [r.key, r.value]));

  const pickups = await env.DB.prepare(
    `SELECT k.id, k.ready_at, k.ready_by, k.collected_at, k.collected_by_name, k.pickup_deadline,
            k.created_at,
            o.id AS order_id, o.order_number, o.status,
            o.customer_first_name, o.customer_last_name, o.customer_phone,
            loc.name AS location_name
       FROM pickup_orders k
       JOIN orders o ON o.id = k.order_id
       LEFT JOIN inventory_locations loc ON loc.id = k.location_id
      ORDER BY k.collected_at IS NOT NULL, k.created_at DESC
      LIMIT 200`,
  ).all<{
    id: string;
    ready_at: number | null;
    ready_by: string | null;
    collected_at: number | null;
    collected_by_name: string | null;
    pickup_deadline: number | null;
    created_at: number;
    order_id: string;
    order_number: string;
    status: string;
    customer_first_name: string | null;
    customer_last_name: string | null;
    customer_phone: string | null;
    location_name: string | null;
  }>();

  /*
   * Orders asking for collection that have no pickup record yet.
   *
   * `delivery_method = 'pickup'` is the customer's choice at checkout, so this
   * list is the work queue: an order here is one nobody has started preparing.
   */
  const awaiting = await env.DB.prepare(
    `SELECT o.id, o.order_number, o.customer_first_name, o.customer_last_name, o.status
       FROM orders o
      WHERE o.delivery_method = 'pickup'
        AND NOT EXISTS (SELECT 1 FROM pickup_orders k WHERE k.order_id = o.id)
        AND o.status NOT IN ('cancelled', 'refunded')
      ORDER BY o.order_number DESC
      LIMIT 100`,
  ).all<{
    id: string;
    order_number: string;
    customer_first_name: string | null;
    customer_last_name: string | null;
    status: string;
  }>();

  const locations = await env.DB.prepare(
    `SELECT id, name FROM inventory_locations
      WHERE active = 1 AND sellable_in_store = 1 AND archived_at IS NULL
      ORDER BY sort_order`,
  ).all<{ id: string; name: string }>();

  return {
    pickups: pickups.results,
    awaiting: awaiting.results,
    locations: locations.results,
    // The customer-facing offer. If this is off, no order can have chosen
    // collection — which is why the screen says so rather than looking broken.
    pickupOffered: canOfferPickup(settings),
    storeName: settingValue(settings, SETTING_KEYS.shopName),
    canWrite: actor.permissions.includes("order.write"),
  };
}

export async function action({ request, context }: Route.ActionArgs) {
  const { env } = context.get(cloudflareContext);
  const actor = await requireStaff(request, env, "order.write");

  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");
  const now = systemClock.now();

  if (intent === "start") {
    const orderId = String(form.get("orderId") ?? "");
    const locationId = String(form.get("locationId") ?? "");

    const existing = await env.DB.prepare(`SELECT id FROM pickup_orders WHERE order_id = ?1`)
      .bind(orderId)
      .first<{ id: string }>();
    if (existing) return { error: "Questo ordine ha già una scheda di ritiro." };

    await env.DB.prepare(
      `INSERT INTO pickup_orders (id, order_id, location_id, created_at, updated_at)
       VALUES (?1, ?2, ?3, ?4, ?4)`,
    )
      .bind(cryptoIds.generate(), orderId, locationId, now)
      .run();

    return { success: "Ritiro aperto. Segna «pronto» quando il pacco è sullo scaffale." };
  }

  if (intent === "ready") {
    const id = String(form.get("pickupId") ?? "");
    await env.DB.prepare(
      `UPDATE pickup_orders SET ready_at = ?2, ready_by = ?3, updated_at = ?2 WHERE id = ?1`,
    )
      .bind(id, now, actor.userId)
      .run();

    return {
      success:
        "Segnato come pronto. Il cliente non viene avvisato in automatico: " +
        "l'invio dei messaggi non è ancora collegato, quindi avvisalo tu.",
    };
  }

  if (intent === "collected") {
    const id = String(form.get("pickupId") ?? "");
    const name = String(form.get("collected_by_name") ?? "").trim();

    if (name === "") {
      // Blank here would make the record useless later, which is exactly when
      // it gets looked at: "who took it?" after something goes missing.
      return {
        error: "Scrivi chi ha ritirato: serve a rispondere alla domanda «chi lo ha preso».",
      };
    }

    await env.DB.prepare(
      `UPDATE pickup_orders
          SET collected_at = ?2, collected_by = ?3, collected_by_name = ?4, updated_at = ?2
        WHERE id = ?1`,
    )
      .bind(id, now, actor.userId, name)
      .run();

    return { success: "Ritiro registrato." };
  }

  return { error: "Azione non riconosciuta." };
}

export default function AdminPickups({ loaderData, actionData }: Route.ComponentProps) {
  const { pickups, awaiting, locations, pickupOffered, canWrite } = loaderData;
  const waiting = pickups.filter((p) => p.collected_at === null);
  const ready = waiting.filter((p) => p.ready_at !== null);

  return (
    <>
      <PageHeader title="Ritiri in negozio" breadcrumbs={breadcrumbsFor("/admin/ritiri")} />

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

      {!pickupOffered ? (
        <p className="notice notice--warning">
          <strong>Il ritiro in negozio non è attivo sul sito.</strong> Finché resta spento, nessun
          cliente può sceglierlo alla cassa e questo elenco resta vuoto. Si accende da{" "}
          <Link to="/admin/impostazioni">Impostazioni</Link>.
        </p>
      ) : null}

      <section className="panel">
        <div className="ac-metrics">
          <div className="ac-metric">
            <span className="ac-metric__label">Da preparare</span>
            <span className="ac-metric__value numeric">{awaiting.length}</span>
          </div>
          <div className="ac-metric">
            <span className="ac-metric__label">Pronti sullo scaffale</span>
            <span className="ac-metric__value numeric">{ready.length}</span>
          </div>
          <div className="ac-metric">
            <span className="ac-metric__label">In attesa di ritiro</span>
            <span className="ac-metric__value numeric">{waiting.length}</span>
          </div>
        </div>
      </section>

      {awaiting.length > 0 ? (
        <section className="panel">
          <h2>Ordini da preparare</h2>
          <ul className="stack">
            {awaiting.map((o) => (
              <li key={o.id} className="cluster">
                <Link to={`/admin/ordini/${o.id}`}>{o.order_number}</Link>
                <span>
                  {o.customer_first_name} {o.customer_last_name}
                </span>
                <span className="badge">{o.status}</span>
                {canWrite && locations.length > 0 ? (
                  <Form method="post" className="cluster">
                    <input type="hidden" name="intent" value="start" />
                    <input type="hidden" name="orderId" value={o.id} />
                    <select name="locationId" required>
                      {locations.map((l) => (
                        <option key={l.id} value={l.id}>
                          {l.name}
                        </option>
                      ))}
                    </select>
                    <button className="btn" type="submit">
                      Apri ritiro
                    </button>
                  </Form>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {pickups.length === 0 ? (
        <div className="empty-state">
          <p>Nessun ritiro.</p>
          <p className="small">
            Compaiono qui gli ordini in cui il cliente ha scelto di passare in negozio.
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
            <caption className="visually-hidden">Ritiri in negozio</caption>
            <thead>
              <tr>
                <th scope="col">Ordine</th>
                <th scope="col">Cliente</th>
                <th scope="col">Sede</th>
                <th scope="col">Pronto</th>
                <th scope="col">Ritirato</th>
                {canWrite ? <th scope="col">Azione</th> : null}
              </tr>
            </thead>
            <tbody>
              {pickups.map((p) => (
                <tr key={p.id}>
                  <td>
                    <Link to={`/admin/ordini/${p.order_id}`}>{p.order_number}</Link>
                  </td>
                  <td>
                    {p.customer_first_name} {p.customer_last_name}
                    {p.customer_phone ? (
                      <>
                        <br />
                        <a className="small" href={`tel:${p.customer_phone.replace(/\s+/g, "")}`}>
                          {p.customer_phone}
                        </a>
                      </>
                    ) : null}
                  </td>
                  <td className="small">{p.location_name ?? "—"}</td>
                  <td className="small">{p.ready_at ? formatDateTime(p.ready_at, "it") : "—"}</td>
                  <td className="small">
                    {p.collected_at ? (
                      <>
                        {formatDateTime(p.collected_at, "it")}
                        <br />
                        <span className="muted">{p.collected_by_name}</span>
                      </>
                    ) : (
                      "—"
                    )}
                  </td>
                  {canWrite ? (
                    <td>
                      {p.collected_at ? (
                        <span className="small muted">concluso</span>
                      ) : p.ready_at ? (
                        <Form method="post" className="stack">
                          <input type="hidden" name="intent" value="collected" />
                          <input type="hidden" name="pickupId" value={p.id} />
                          <label>
                            Chi ritira
                            <input name="collected_by_name" required maxLength={80} />
                            <span className="field-help">
                              Spesso non è chi ha ordinato. Scrivi il nome di chi si presenta.
                            </span>
                          </label>
                          <button className="btn" type="submit">
                            Registra ritiro
                          </button>
                        </Form>
                      ) : (
                        <Form method="post">
                          <input type="hidden" name="intent" value="ready" />
                          <input type="hidden" name="pickupId" value={p.id} />
                          <button className="btn btn--primary" type="submit">
                            Segna pronto
                          </button>
                        </Form>
                      )}
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
