import { Form, Link } from "react-router";
import type { Route } from "./+types/shipments";
import { cloudflareContext } from "../../../workers/app";
import { requireStaff } from "~/infrastructure/auth/session.server";
import { systemClock, cryptoIds } from "~/infrastructure/primitives";
import { formatDateTime } from "~/lib/i18n";
import { canOfferShipping } from "~/domain/content/gates";
import { breadcrumbsFor } from "~/lib/admin-nav";
import { PageHeader } from "~/components/admin/admin-shell";

/**
 * Shipments.
 *
 * Recording a shipment creates a fulfilment and a shipment together, in one
 * batch. They are separate tables because a fulfilment is "this part of the
 * order left the shop" and a shipment is "by this carrier, with this number" —
 * but there is no such thing as one without the other, so nothing here can
 * produce a half of the pair.
 *
 * ── The tracking URL ─────────────────────────────────────────────────────────
 *
 * Built from a per-carrier template rather than typed, because a customer-facing
 * link assembled by hand is a link that is occasionally wrong, and a tracking
 * page for somebody else's parcel is worse than no link at all. A carrier with
 * no template gets the number and no link, which is honest.
 *
 * ── What this screen does NOT do ─────────────────────────────────────────────
 *
 * It does not buy postage, print a label, or tell a carrier anything. It records
 * what somebody did at the post office. Presenting it as an integration would
 * mean a shop watching for a collection that nobody ever requested.
 */
export function meta() {
  return [{ title: "Spedizioni" }, { name: "robots", content: "noindex, nofollow" }];
}

/**
 * Tracking URL templates.
 *
 * `{n}` is the tracking number. Kept short and boring on purpose: these change,
 * and a wrong one sends a customer to a page saying their parcel does not exist.
 */
const CARRIERS = [
  {
    name: "Poste Italiane",
    url: "https://www.poste.it/cerca/index.html#/risultati-spedizioni/{n}",
  },
  {
    name: "BRT",
    url: "https://vas.brt.it/vas/sped_det_show.hsm?referer=sped_numspe_par.htm&Nspediz={n}",
  },
  {
    name: "GLS",
    url: "https://www.gls-italy.com/?option=com_gls&view=track_e_trace&numero_spedizione={n}",
  },
  { name: "DHL", url: "https://www.dhl.com/it-it/home/tracciabilita.html?tracking-id={n}" },
  { name: "UPS", url: "https://www.ups.com/track?tracknum={n}" },
  { name: "Altro", url: "" },
] as const;

export async function loader({ request, context }: Route.LoaderArgs) {
  const { env } = context.get(cloudflareContext);
  const actor = await requireStaff(request, env, "order.read");

  const settingsResult = await env.DB.prepare(`SELECT key, value FROM store_settings`).all<{
    key: string;
    value: string;
  }>();
  const settings = Object.fromEntries(settingsResult.results.map((r) => [r.key, r.value]));

  const shipments = await env.DB.prepare(
    `SELECT s.id, s.carrier_name, s.tracking_number, s.tracking_url, s.shipped_at,
            s.delivered_at, s.created_at,
            o.id AS order_id, o.order_number,
            o.customer_first_name, o.customer_last_name
       FROM shipments s
       JOIN fulfilments f ON f.id = s.fulfilment_id
       JOIN orders o ON o.id = f.order_id
      ORDER BY s.delivered_at IS NOT NULL, s.created_at DESC
      LIMIT 200`,
  ).all<{
    id: string;
    carrier_name: string | null;
    tracking_number: string | null;
    tracking_url: string | null;
    shipped_at: number | null;
    delivered_at: number | null;
    created_at: number;
    order_id: string;
    order_number: string;
    customer_first_name: string | null;
    customer_last_name: string | null;
  }>();

  const awaiting = await env.DB.prepare(
    `SELECT o.id, o.order_number, o.customer_first_name, o.customer_last_name, o.status
       FROM orders o
      WHERE o.delivery_method <> 'pickup'
        AND o.status NOT IN ('cancelled', 'refunded')
        AND NOT EXISTS (
          SELECT 1 FROM fulfilments f
           JOIN shipments s2 ON s2.fulfilment_id = f.id
          WHERE f.order_id = o.id
        )
      ORDER BY o.order_number DESC
      LIMIT 100`,
  ).all<{
    id: string;
    order_number: string;
    customer_first_name: string | null;
    customer_last_name: string | null;
    status: string;
  }>();

  return {
    shipments: shipments.results,
    awaiting: awaiting.results,
    carriers: CARRIERS,
    // The domain gate, not a second copy of the same comparison.
    shippingOffered: canOfferShipping(settings),
    canWrite: actor.permissions.includes("order.write"),
  };
}

export async function action({ request, context }: Route.ActionArgs) {
  const { env } = context.get(cloudflareContext);
  const actor = await requireStaff(request, env, "order.write");

  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");
  const now = systemClock.now();

  if (intent === "record") {
    const orderId = String(form.get("orderId") ?? "");
    const carrierName = String(form.get("carrier") ?? "").trim();
    const trackingNumber = String(form.get("tracking_number") ?? "").trim();

    const carrier = CARRIERS.find((c) => c.name === carrierName);
    if (!carrier) return { error: "Corriere non riconosciuto." };
    if (trackingNumber === "") return { error: "Serve il numero di tracciatura." };

    /*
     * A fulfilment and a shipment, in one batch.
     *
     * There is no such thing as a shipment without a fulfilment, so nothing
     * here can produce half the pair — a shipment row pointing at a fulfilment
     * that failed to insert would be invisible everywhere that joins them.
     */
    const fulfilmentId = cryptoIds.generate();
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO fulfilments
           (id, order_id, status, fulfilment_type, prepared_by, created_at, updated_at)
         VALUES (?1, ?2, 'shipped', 'shipment', ?3, ?4, ?4)`,
      ).bind(fulfilmentId, orderId, actor.userId, now),
      env.DB.prepare(
        `INSERT INTO shipments
           (id, fulfilment_id, carrier_name, tracking_number, tracking_url, shipped_at,
            created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6, ?6)`,
      ).bind(
        cryptoIds.generate(),
        fulfilmentId,
        carrier.name,
        trackingNumber,
        // No template means no link, rather than a guessed one.
        carrier.url ? carrier.url.replace("{n}", encodeURIComponent(trackingNumber)) : null,
        now,
      ),
    ]);

    return {
      success:
        "Spedizione registrata. Il cliente non riceve un messaggio in automatico: " +
        "l'invio email non è ancora collegato.",
    };
  }

  if (intent === "delivered") {
    const id = String(form.get("shipmentId") ?? "");
    await env.DB.prepare(`UPDATE shipments SET delivered_at = ?2, updated_at = ?2 WHERE id = ?1`)
      .bind(id, now)
      .run();
    return { success: "Segnata come consegnata." };
  }

  return { error: "Azione non riconosciuta." };
}

export default function AdminShipments({ loaderData, actionData }: Route.ComponentProps) {
  const { shipments, awaiting, carriers, shippingOffered, canWrite } = loaderData;
  const inTransit = shipments.filter((s) => s.delivered_at === null);

  return (
    <>
      <PageHeader title="Spedizioni" breadcrumbs={breadcrumbsFor("/admin/spedizioni")} />

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

      {!shippingOffered ? (
        <p className="notice notice--warning">
          <strong>La spedizione non è attiva sul sito.</strong> Finché resta spenta nessun cliente
          può sceglierla, e questo elenco resta vuoto. Si accende da{" "}
          <Link to="/admin/impostazioni">Impostazioni</Link>.
        </p>
      ) : null}

      <section className="panel">
        <div className="ac-metrics">
          <div className="ac-metric">
            <span className="ac-metric__label">Da spedire</span>
            <span className="ac-metric__value numeric">{awaiting.length}</span>
          </div>
          <div className="ac-metric">
            <span className="ac-metric__label">In viaggio</span>
            <span className="ac-metric__value numeric">{inTransit.length}</span>
          </div>
        </div>
        <p className="small">
          Questa schermata registra quello che è stato fatto allo sportello: non compra
          affrancature, non stampa etichette e non comunica niente al corriere.
        </p>
      </section>

      {canWrite && awaiting.length > 0 ? (
        <section className="panel">
          <h2>Registra una spedizione</h2>
          <Form method="post" className="stack">
            <input type="hidden" name="intent" value="record" />
            <label>
              Ordine
              <select name="orderId" required defaultValue="">
                <option value="" disabled>
                  Scegli…
                </option>
                {awaiting.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.order_number} — {o.customer_first_name} {o.customer_last_name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Corriere
              <select name="carrier" defaultValue={carriers[0].name}>
                {carriers.map((c) => (
                  <option key={c.name} value={c.name}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Numero di tracciatura
              <input name="tracking_number" required maxLength={64} />
              <span className="field-help">
                Il link di tracciatura viene composto dal corriere scelto. &ldquo;Altro&rdquo; salva
                il numero senza link, invece di indovinarne uno sbagliato.
              </span>
            </label>
            <button className="btn btn--primary" type="submit">
              Registra spedizione
            </button>
          </Form>
        </section>
      ) : null}

      {shipments.length === 0 ? (
        <div className="empty-state">
          <p>Nessuna spedizione.</p>
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
            <caption className="visually-hidden">Spedizioni</caption>
            <thead>
              <tr>
                <th scope="col">Ordine</th>
                <th scope="col">Cliente</th>
                <th scope="col">Corriere</th>
                <th scope="col">Tracciatura</th>
                <th scope="col">Spedita</th>
                <th scope="col">Consegnata</th>
                {canWrite ? <th scope="col">Azione</th> : null}
              </tr>
            </thead>
            <tbody>
              {shipments.map((s) => (
                <tr key={s.id}>
                  <td>
                    <Link to={`/admin/ordini/${s.order_id}`}>{s.order_number}</Link>
                  </td>
                  <td>
                    {s.customer_first_name} {s.customer_last_name}
                  </td>
                  <td>{s.carrier_name ?? "—"}</td>
                  <td className="small">
                    {s.tracking_url ? (
                      <a href={s.tracking_url} target="_blank" rel="noopener noreferrer">
                        {s.tracking_number}
                      </a>
                    ) : (
                      (s.tracking_number ?? "—")
                    )}
                  </td>
                  <td className="small">
                    {s.shipped_at ? formatDateTime(s.shipped_at, "it") : "—"}
                  </td>
                  <td className="small">
                    {s.delivered_at ? formatDateTime(s.delivered_at, "it") : "—"}
                  </td>
                  {canWrite ? (
                    <td>
                      {s.delivered_at ? (
                        <span className="small muted">conclusa</span>
                      ) : (
                        <Form method="post">
                          <input type="hidden" name="intent" value="delivered" />
                          <input type="hidden" name="shipmentId" value={s.id} />
                          <button className="btn" type="submit">
                            Segna consegnata
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
