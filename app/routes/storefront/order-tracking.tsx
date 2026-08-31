import { useLocation } from "react-router";
import { data } from "react-router";
import type { Route } from "./+types/order-tracking";
import { cloudflareContext } from "../../../workers/app";
import { parseLocalePath, translator, formatDateTime } from "~/lib/i18n";
import { money, format as formatMoney } from "~/domain/pricing/money";

/**
 * Public order tracking.
 *
 * Authorised by a 32-character random token and nothing else. The order number
 * carries its own date and is therefore partly guessable, so it never grants
 * access on its own (docs/security-threat-model.md).
 */
export function meta() {
  // The URL carries a tracking token. Indexing it would publish the token.
  return [{ title: "Stato dell'ordine" }, { name: "robots", content: "noindex, nofollow" }];
}

export async function loader({ context, params }: Route.LoaderArgs) {
  const { env } = context.get(cloudflareContext);

  // A short token is not worth a database round trip, and rejecting early
  // keeps the endpoint cheap to defend.
  if (!params.token || params.token.length !== 32) throw data(null, { status: 404 });

  const order = await env.DB.prepare(
    `SELECT o.id, o.order_number, o.status, o.grand_total, o.delivery_method,
            o.created_at, o.reservation_expires_at, op.status AS payment_status
       FROM orders o
       LEFT JOIN order_payments op ON op.order_id = o.id
      WHERE o.tracking_token = ?1`,
  )
    .bind(params.token)
    .first<{
      id: string;
      order_number: string;
      status: string;
      grand_total: number;
      delivery_method: string;
      created_at: number;
      reservation_expires_at: number | null;
      payment_status: string | null;
    }>();

  if (!order) throw data(null, { status: 404 });

  // Only customer-visible events. The flag is checked in the QUERY, so an
  // internal note is never one template mistake away from being read.
  const events = await env.DB.prepare(
    `SELECT event_type, created_at FROM order_events
      WHERE order_id = ?1 AND customer_visible = 1 ORDER BY created_at ASC`,
  )
    .bind(order.id)
    .all<{ event_type: string; created_at: number }>();

  return { order, events: events.results };
}

export default function OrderTracking({ loaderData }: Route.ComponentProps) {
  const { pathname } = useLocation();
  const { locale } = parseLocalePath(pathname);
  const t = translator(locale);
  const intl = locale === "it" ? "it-IT" : "en-GB";
  const { order, events } = loaderData;

  return (
    <div className="page section stack" style={{ maxWidth: "42rem" }}>
      <h1>{t("order.track_order")}</h1>

      <div className="panel stack">
        <p>
          <span className="muted">{t("order.order_number")}: </span>
          <strong className="numeric">{order.order_number}</strong>
        </p>
        <p>
          <span className="muted">{t("order.status")}: </span>
          <strong>{t(`order_status.${order.status}`)}</strong>
        </p>
        {order.payment_status ? (
          <p>
            <span className="muted">{t("checkout.payment_method")}: </span>
            <span>{t(`payment_status.${order.payment_status}`)}</span>
          </p>
        ) : null}
        <p>
          <span className="muted">{t("common.total")}: </span>
          <span className="price">{formatMoney(money(order.grand_total), intl)}</span>
        </p>
        {order.reservation_expires_at && order.status === "awaiting_payment" ? (
          <p className="notice notice--info small">
            {t("order.reserved_until", {
              datetime: formatDateTime(order.reservation_expires_at, locale),
            })}
          </p>
        ) : null}
      </div>

      {events.length > 0 ? (
        <ol className="stack timeline">
          {events.map((event, index) => (
            <li key={index} className="small">
              <span className="muted">{formatDateTime(event.created_at, locale)}</span>{" "}
              <span>{event.event_type}</span>
            </li>
          ))}
        </ol>
      ) : null}
    </div>
  );
}
