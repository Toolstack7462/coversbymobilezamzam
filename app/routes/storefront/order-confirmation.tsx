import { Link, useLocation } from "react-router";
import { data } from "react-router";
import type { Route } from "./+types/order-confirmation";
import { cloudflareContext } from "../../../workers/app";
import { parseLocalePath, translator, localePath, formatDateTime } from "~/lib/i18n";
import { money, format as formatMoney } from "~/domain/pricing/money";
import { buildWhatsAppMessage, buildWhatsAppUrl } from "~/domain/orders/whatsapp-message";
import { settingValue, SETTING_KEYS, type SettingsMap } from "~/domain/content/gates";

export async function loader({ context, request, params }: Route.LoaderArgs) {
  const { env } = context.get(cloudflareContext);
  const trackingToken = new URL(request.url).searchParams.get("t");

  // The order number alone never authorises access: it contains the date and is
  // therefore partly guessable. The random tracking token is what grants it.
  if (!trackingToken) throw data(null, { status: 404 });

  const order = await env.DB.prepare(
    `SELECT o.id, o.order_number, o.status, o.grand_total, o.currency,
            o.customer_first_name, o.customer_last_name, o.delivery_method,
            o.reservation_expires_at,
            pm.name_it AS method_name_it, pm.name_en AS method_name_en,
            pm.instructions_it, pm.instructions_en,
            pm.beneficiary_name, pm.account_identifier_masked,
            op.status AS payment_status
       FROM orders o
       LEFT JOIN payment_methods pm ON pm.id = o.payment_method_id
       LEFT JOIN order_payments op ON op.order_id = o.id
      WHERE o.order_number = ?1 AND o.tracking_token = ?2`,
  )
    .bind(params.orderNumber, trackingToken)
    .first<{
      id: string;
      order_number: string;
      status: string;
      grand_total: number;
      currency: string;
      customer_first_name: string;
      customer_last_name: string;
      delivery_method: string;
      reservation_expires_at: number | null;
      method_name_it: string | null;
      method_name_en: string | null;
      instructions_it: string | null;
      instructions_en: string | null;
      beneficiary_name: string | null;
      account_identifier_masked: string | null;
      payment_status: string | null;
    }>();

  if (!order) throw data(null, { status: 404 });

  const [items, settingsResult] = await Promise.all([
    env.DB.prepare(
      `SELECT product_name, variant_label, quantity FROM order_items WHERE order_id = ?1`,
    )
      .bind(order.id)
      .all<{ product_name: string; variant_label: string | null; quantity: number }>(),
    env.DB.prepare(`SELECT key, value FROM store_settings`).all<{
      key: string;
      value: string;
    }>(),
  ]);

  const settings: SettingsMap = Object.fromEntries(
    settingsResult.results.map((r) => [r.key, r.value]),
  );

  // Composed on the SERVER, so the exclusion list is testable: no address, no
  // token, no internal id ever enters the message.
  const message = buildWhatsAppMessage({
    orderNumber: order.order_number,
    customerFirstName: order.customer_first_name,
    customerLastName: order.customer_last_name,
    total: money(order.grand_total),
    paymentMethodName: order.method_name_it ?? "",
    deliveryMethod: order.delivery_method === "pickup" ? "pickup" : "shipping",
    items: items.results.map((i) => ({
      quantity: i.quantity,
      productName: i.product_name,
      variantLabel: i.variant_label,
    })),
  });

  // Null when no number is configured: the CTA then renders nothing at all,
  // rather than a broken link.
  const whatsappUrl = buildWhatsAppUrl(
    settingValue(settings, SETTING_KEYS.whatsappNumber),
    message,
  );

  return {
    order,
    items: items.results,
    whatsappUrl,
    trackingToken,
  };
}

export default function OrderConfirmation({ loaderData }: Route.ComponentProps) {
  const { pathname } = useLocation();
  const { locale } = parseLocalePath(pathname);
  const t = translator(locale);
  const intl = locale === "it" ? "it-IT" : "en-GB";
  const { order, items, whatsappUrl, trackingToken } = loaderData;

  return (
    <div className="page section stack" style={{ maxWidth: "42rem" }}>
      <h1>{t("order.confirmed_title")}</h1>
      <p>{t("order.confirmed_body")}</p>

      <div className="panel stack">
        <p>
          <span className="muted">{t("order.order_number")}: </span>
          <strong className="numeric">{order.order_number}</strong>
        </p>
        <p>
          <span className="muted">{t("common.total")}: </span>
          <strong className="price">{formatMoney(money(order.grand_total), intl)}</strong>
        </p>
        <p>
          <span className="muted">{t("order.status")}: </span>
          <span>{t(`order_status.${order.status}`)}</span>
        </p>

        {/*
          An exact expiry instant, in Italian local time. Never a ticking
          countdown: the deadline is real information, not a pressure device.
        */}
        {order.reservation_expires_at ? (
          <p className="notice notice--info small">
            {t("order.reserved_until", {
              datetime: formatDateTime(order.reservation_expires_at, locale),
            })}
          </p>
        ) : null}
      </div>

      <section className="panel stack">
        <h2>{t("order.payment_instructions")}</h2>
        {/* Always on the page, not only in the chat: a customer who never opens
            WhatsApp must still be able to pay. */}
        {order.beneficiary_name ? (
          <p>
            <span className="muted">{t("order.beneficiary")}: </span>
            {order.beneficiary_name}
          </p>
        ) : null}
        {order.account_identifier_masked ? (
          <p className="numeric">{order.account_identifier_masked}</p>
        ) : null}
        <p>
          <span className="muted">{t("order.payment_reference")}: </span>
          <strong className="numeric">{order.order_number}</strong>
        </p>
        {(locale === "it" ? order.instructions_it : order.instructions_en) ? (
          <p style={{ whiteSpace: "pre-line" }}>
            {locale === "it" ? order.instructions_it : order.instructions_en}
          </p>
        ) : null}
      </section>

      <ul className="stack">
        {items.map((item, index) => (
          <li key={index} className="small">
            <span className="numeric">{item.quantity} ×</span> {item.product_name}
            {item.variant_label ? ` — ${item.variant_label}` : ""}
          </li>
        ))}
      </ul>

      <div className="cluster">
        {/* Renders only when a WhatsApp number is configured. */}
        {whatsappUrl ? (
          <a
            className="btn btn--primary"
            href={whatsappUrl}
            rel="noopener noreferrer"
            target="_blank"
          >
            {t("order.continue_whatsapp")}
          </a>
        ) : null}
        <Link className="btn btn--secondary" to={localePath(locale, `/traccia/${trackingToken}`)}>
          {t("order.track_order")}
        </Link>
      </div>
    </div>
  );
}
