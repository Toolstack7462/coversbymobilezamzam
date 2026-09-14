import { adminTranslator } from "~/lib/admin-i18n";
import { adminLocaleFromMatches, adminLocaleFromCookie } from "~/lib/admin-locale";
import { useAdminTranslator } from "~/components/admin/use-admin-translator";
import { Form, Link, useLocation } from "react-router";
import type { Route } from "./+types/order-detail";
import { appContext, type AppEnv } from "~/runtime/context";
import { requireStaff } from "~/infrastructure/auth/session.server";
import { systemClock, cryptoIds } from "~/infrastructure/primitives";
import { money, format as formatMoney } from "~/domain/pricing/money";
import { formatDateTime } from "~/lib/i18n";
import {
  allowedTransitions,
  assertTransition,
  isOrderStatus,
  type OrderStatus,
} from "~/domain/orders/status";
import { buildWhatsAppMessage, buildWhatsAppUrl } from "~/domain/orders/whatsapp-message";
import {
  ORDER_STATUS_LABELS,
  PAYMENT_STATUS_LABELS,
  DELIVERY_LABELS,
  orderStatusTone,
  paymentStatusTone,
} from "~/lib/order-views";
import { SETTING_KEYS } from "~/domain/content/gates";
import { breadcrumbsFor } from "~/lib/admin-nav";
import { PageHeader } from "~/components/admin/admin-shell";

/**
 * One order.
 *
 * The screen is arranged around the single question a shopkeeper opens it to
 * answer: **what do I do with this now?** So the WhatsApp button, the status
 * move and the reservation clock come first, and the historical record comes
 * after.
 *
 * The line items are the ORDER'S OWN SNAPSHOT — `order_items.product_name`,
 * `sku`, `unit_price` — never a join back to the live product. That is
 * invariant 8, and it is the difference between an order that still says what
 * was actually sold and one that silently rewrites itself when a price changes
 * or a product is renamed six months later.
 */

export function meta({ loaderData, matches }: Route.MetaArgs) {
  const t = adminTranslator(adminLocaleFromMatches(matches));
  const number = loaderData?.order?.order_number ?? t("Ordine");
  return [
    { title: t("Ordine {{v0}}", { v0: number }) },
    { name: "robots", content: "noindex, nofollow" },
  ];
}

/**
 * Every database read this screen needs.
 *
 * Exported and separated from the loader for one reason: **raw SQL is invisible
 * to TypeScript.** The first version of this file selected `changed_at`,
 * `changed_by` and `note` from `order_status_history`, whose columns are
 * actually `created_at`, `actor` and `reason`, and inserted an `author_label`
 * into `order_notes`, which has no such column. All of it typechecked, built
 * and passed every existing test; it would have thrown a 500 the first time a
 * merchant opened an order.
 *
 * With the queries here, `tests/integration/detail-queries.test.ts` runs
 * exactly the statements the route runs, against the real schema — no copy in
 * the test that could drift back into agreement with a bug.
 */
export async function loadOrderDetail(env: AppEnv, orderId: string) {
  const order = await env.DB.prepare(
    `SELECT o.*, pm.name_it AS payment_method_name,
            op.status AS payment_status, op.amount_expected, op.amount_received,
            op.transaction_reference, op.verified_at
       FROM orders o
       LEFT JOIN payment_methods pm ON pm.id = o.payment_method_id
       LEFT JOIN order_payments op ON op.order_id = o.id
      WHERE o.id = ?1`,
  )
    .bind(orderId)
    .first<Record<string, string | number | null>>();

  if (!order) throw new Response("Ordine non trovato", { status: 404 });

  const [items, history, address, settings] = await Promise.all([
    env.DB.prepare(
      `SELECT product_id, product_name, variant_label, sku, quantity, unit_price, line_total,
              compatibility_state, device_model_name
         FROM order_items WHERE order_id = ?1 ORDER BY created_at`,
    )
      .bind(orderId)
      .all<{
        product_id: string | null;
        product_name: string;
        variant_label: string | null;
        sku: string;
        quantity: number;
        unit_price: number;
        line_total: number;
        compatibility_state: string | null;
        device_model_name: string | null;
      }>(),

    env.DB.prepare(
      `SELECT from_status, to_status, created_at, actor, reason
         FROM order_status_history WHERE order_id = ?1 ORDER BY created_at DESC LIMIT 50`,
    )
      .bind(orderId)
      .all<{
        from_status: string | null;
        to_status: string;
        created_at: number;
        actor: string;
        reason: string | null;
      }>(),

    env.DB.prepare(
      `SELECT street, street_number, postcode, city, province, country
         FROM order_addresses WHERE order_id = ?1 LIMIT 1`,
    )
      .bind(orderId)
      .first<{
        street: string;
        street_number: string | null;
        postcode: string;
        city: string;
        province: string | null;
        country: string;
      }>(),

    env.DB.prepare(`SELECT key, value FROM store_settings WHERE key = ?1`)
      .bind(SETTING_KEYS.whatsappNumber)
      .first<{ key: string; value: string }>(),
  ]);

  return { order, items: items.results, history: history.results, address, settings };
}

export async function loader({ request, params, context }: Route.LoaderArgs) {
  const { env } = context.get(appContext);
  const actor = await requireStaff(request, env, "order.read");

  const { order, items, history, address, settings } = await loadOrderDetail(env, params.orderId);

  const status = String(order.status);
  const deliveryMethod = String(order.delivery_method) as "shipping" | "pickup";

  // Composed on the server so nothing client-side decides what goes into a
  // message that will be forwarded, screenshotted and backed up to a cloud the
  // shop does not control.
  const message = buildWhatsAppMessage({
    orderNumber: String(order.order_number),
    customerFirstName: String(order.customer_first_name),
    customerLastName: String(order.customer_last_name),
    total: money(Number(order.grand_total)),
    paymentMethodName: String(order.payment_method_name ?? "—"),
    deliveryMethod,
    items: items.map((i) => ({
      quantity: i.quantity,
      productName: i.product_name,
      variantLabel: i.variant_label,
    })),
  });

  // The customer's own number is preferred; the shop's is the fallback so the
  // button still does something useful when the customer left no number.
  const customerNumber = order.customer_whatsapp ?? order.customer_phone;
  const whatsappUrl =
    buildWhatsAppUrl(customerNumber ? String(customerNumber) : null, message) ??
    buildWhatsAppUrl(settings?.value ?? null, message);

  return {
    order,
    items,
    history,
    address,
    allowed: isOrderStatus(status) ? allowedTransitions(status) : [],
    whatsappUrl,
    whatsappIsCustomer: Boolean(customerNumber),
    now: systemClock.now(),
    canWrite: actor.permissions.includes("order.write"),
    canSeePayments: actor.permissions.includes("payment.read"),
  };
}

export async function action({ request, params, context }: Route.ActionArgs) {
  const { env } = context.get(appContext);
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");
  const now = systemClock.now();
  const orderId = params.orderId;

  if (intent === "set-status") {
    const actor = await requireStaff(request, env, "order.write");
    const to = String(form.get("status") ?? "");
    if (!isOrderStatus(to)) return { error: "Stato non valido." };

    const order = await env.DB.prepare(`SELECT status FROM orders WHERE id = ?1`)
      .bind(orderId)
      .first<{ status: string }>();
    if (!order) return { error: "Ordine non trovato." };
    if (!isOrderStatus(order.status)) return { error: "Stato attuale non riconosciuto." };

    // The domain decides, not the form. A dropdown can be edited; the state
    // machine is the thing that actually holds.
    try {
      assertTransition(order.status, to);
    } catch (error) {
      return { error: error instanceof Error ? error.message : "Transizione non consentita." };
    }

    await env.DB.batch([
      env.DB.prepare(`UPDATE orders SET status = ?1, updated_at = ?2 WHERE id = ?3`).bind(
        to,
        now,
        orderId,
      ),
      env.DB.prepare(
        `INSERT INTO order_status_history (id, order_id, from_status, to_status, actor, created_at)
         VALUES (?1,?2,?3,?4,?5,?6)`,
      ).bind(cryptoIds.generate(), orderId, order.status, to, actor.userId, now),
      env.DB.prepare(
        `INSERT INTO audit_logs
           (id, actor_id, actor_label, action, entity_type, entity_id, before_value, after_value, created_at)
         VALUES (?1,?2,?3,'order.status','order',?4,?5,?6,?7)`,
      ).bind(
        cryptoIds.generate(),
        actor.userId,
        actor.displayName,
        orderId,
        JSON.stringify({ status: order.status }),
        JSON.stringify({ status: to }),
        now,
      ),
    ]);

    const t = adminTranslator(adminLocaleFromCookie(request.headers.get("Cookie")));
    return {
      success: t('Ordine spostato in "{{v0}}".', { v0: t(ORDER_STATUS_LABELS[to]) }),
    };
  }

  if (intent === "add-note") {
    const actor = await requireStaff(request, env, "order.write");
    const note = String(form.get("note") ?? "").trim();
    if (note === "") return { error: "La nota è vuota." };

    await env.DB.prepare(
      // customer_visible is written explicitly rather than left to the column
      // default. This form is labelled "internal", and an internal note that
      // quietly became visible is the sort of mistake nobody notices until a
      // customer quotes it back.
      `INSERT INTO order_notes (id, order_id, author_id, body, customer_visible, created_at)
       VALUES (?1,?2,?3,?4,0,?5)`,
    )
      .bind(cryptoIds.generate(), orderId, actor.userId, note, now)
      .run();

    return { success: "Nota aggiunta." };
  }

  return { error: "Azione non riconosciuta." };
}

export default function OrderDetail({ loaderData, actionData }: Route.ComponentProps) {
  const t = useAdminTranslator();
  const { pathname } = useLocation();
  const {
    order,
    items,
    history,
    address,
    allowed,
    whatsappUrl,
    whatsappIsCustomer,
    now,
    canWrite,
    canSeePayments,
  } = loaderData;

  const status = String(order.status);
  const paymentStatus = order.payment_status === null ? null : String(order.payment_status);
  const expiresAt = order.reservation_expires_at ? Number(order.reservation_expires_at) : null;
  const minutesLeft = expiresAt === null ? null : Math.floor((expiresAt - now) / 60000);

  return (
    <>
      <PageHeader
        title={t("Ordine {{v0}}", { v0: String(order.order_number ?? "") })}
        description={`${order.customer_first_name} ${order.customer_last_name} · ${formatDateTime(Number(order.created_at), t.locale)}`}
        breadcrumbs={breadcrumbsFor(pathname)}
        secondaryActions={[{ label: t("Torna agli ordini"), to: "/admin/ordini" }]}
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

      {/* ── The reservation clock ─────────────────────────────────────────── */}
      {minutesLeft !== null && !["cancelled", "expired"].includes(status) ? (
        <p
          className={`notice ${minutesLeft <= 0 ? "notice--danger" : minutesLeft < 60 ? "notice--warning" : "notice--info"}`}
          role="status"
        >
          {minutesLeft <= 0 ? (
            <>
              {t("La prenotazione delle scorte è ")}
              <strong>{t("scaduta")}</strong>
              {t(". I pezzi sono tornati disponibili per altri clienti.")}
            </>
          ) : (
            <>
              {t("Le scorte restano prenotate per")}{" "}
              <strong className="numeric">
                {minutesLeft < 120
                  ? t("{{v0}} minuti", { v0: minutesLeft })
                  : t("{{v0}} ore", { v0: Math.floor(minutesLeft / 60) })}
              </strong>
              {t(". Dopo tornano disponibili automaticamente.")}
            </>
          )}
        </p>
      ) : null}

      {/*
        The workspace: the order on the left, who and what next on the right.

        It was one column of six stacked panels, so on a shop computer the
        customer's phone number sat below the fold beneath the line items and
        the history — and telephoning the customer is the single most common
        thing anyone does on this screen.

        The columns are assigned by CSS, not by moving the markup, so the
        SOURCE order is the phone order: what to do next, then the items, then
        who to contact. On a phone that is the right sequence, and on a desktop
        the grid puts the two side panels in the second column.
      */}
      <div className="ac-workspace">
        {/*
          The side column, FIRST in the source.

          Two real containers rather than CSS placement inside one grid: with
          each panel placed into a column individually, the grid gave every
          one its own row, so the items table started level with the bottom of
          the taller actions panel and left a screen-high gap above it.

          Source order is the phone order. On a narrow screen this stacks
          first — what to do next, then who to call — which is the right
          sequence when somebody is standing at the counter. The grid moves it
          to the right-hand column only when there is room for two.
        */}
        <div className="ac-workspace__side">
          {/* ── What to do now ────────────────────────────────────────────────── */}
          <section className="panel stack ac-workspace__side">
            <h2>{t("Cosa fare adesso")}</h2>

            <p className="cluster">
              <span className={`badge ${orderStatusTone(status)}`}>
                {t(isOrderStatus(status) ? ORDER_STATUS_LABELS[status] : status)}
              </span>
              {paymentStatus ? (
                <span className={`badge ${paymentStatusTone(paymentStatus)}`}>
                  {t("Pagamento:")}{" "}
                  {t(
                    PAYMENT_STATUS_LABELS[paymentStatus as keyof typeof PAYMENT_STATUS_LABELS] ??
                      paymentStatus,
                  )}
                </span>
              ) : null}
              <span className="badge badge--muted">
                {t(DELIVERY_LABELS[String(order.delivery_method)] ?? String(order.delivery_method))}
              </span>
            </p>

            {whatsappUrl ? (
              <p className="stack">
                <a className="btn btn--primary" href={whatsappUrl} target="_blank" rel="noreferrer">
                  {t("Apri WhatsApp con il messaggio pronto")}
                </a>
                <span className="field__hint">
                  {whatsappIsCustomer
                    ? t(
                        "Si apre una chat con il numero lasciato dal cliente, con il riepilogo già scritto. Potete modificarlo prima di inviarlo.",
                      )
                    : t(
                        "Il cliente non ha lasciato un numero, quindi si apre una chat con il numero del negozio: da lì potete inoltrare il messaggio.",
                      )}{" "}
                  {t(
                    "Il messaggio contiene solo numero d'ordine, articoli e totale — mai l'indirizzo né codici interni, perché una chat viene inoltrata e salvata altrove.",
                  )}
                </span>
              </p>
            ) : (
              <p className="notice notice--warning small">
                {t(
                  "Nessun numero WhatsApp configurato e nessun numero lasciato dal cliente. Impostate il numero del negozio nelle ",
                )}
                <Link to="/admin/impostazioni">{t("impostazioni")}</Link>.
              </p>
            )}

            {canWrite && allowed.length > 0 ? (
              <Form method="post" className="cluster">
                <input type="hidden" name="intent" value="set-status" />
                <label className="field__label" htmlFor="next-status">
                  {t("Sposta l'ordine a")}
                </label>
                <select id="next-status" name="status" className="input">
                  {/* `paid` is absent on purpose: only the verification queue can
                    set it, and only with step-up (invariant 6). */}
                  {allowed
                    .filter((s: OrderStatus) => s !== "paid")
                    .map((s: OrderStatus) => (
                      <option key={s} value={s}>
                        {t(ORDER_STATUS_LABELS[s])}
                      </option>
                    ))}
                </select>
                <button type="submit" className="btn btn--secondary">
                  {t("Applica")}
                </button>
              </Form>
            ) : null}

            {canSeePayments && paymentStatus && paymentStatus !== "verified" ? (
              <p>
                <Link className="btn btn--secondary" to="/admin/pagamenti?vista=da-verificare">
                  {t("Vai alla verifica pagamenti")}
                </Link>
              </p>
            ) : null}
          </section>

          {/* ── Customer ──────────────────────────────────────────────────────── */}
          <section className="panel stack ac-workspace__side">
            <h2>{t("Cliente")}</h2>
            <dl className="ac-facts">
              <Fact label={t("Nome")}>
                {order.customer_first_name} {order.customer_last_name}
              </Fact>
              <Fact label="Email">{String(order.customer_email)}</Fact>
              {order.customer_phone ? (
                <Fact label={t("Telefono")}>{String(order.customer_phone)}</Fact>
              ) : null}
              {address ? (
                <Fact label={t("Indirizzo")}>
                  {address.street} {address.street_number ?? ""}
                  <br />
                  {address.postcode} {address.city}{" "}
                  {address.province ? `(${address.province})` : ""}
                  <br />
                  {address.country}
                </Fact>
              ) : (
                <Fact label={t("Indirizzo")}>
                  <span className="muted">
                    {t("Ritiro in negozio: nessun indirizzo di spedizione.")}
                  </span>
                </Fact>
              )}
              {order.customer_note ? (
                <Fact label={t("Nota del cliente")}>{String(order.customer_note)}</Fact>
              ) : null}
            </dl>
          </section>
        </div>
        <div className="ac-workspace__main">
          {/* ── Items ─────────────────────────────────────────────────────────── */}
          <section className="panel stack ac-workspace__main">
            <h2>{t("Articoli")}</h2>
            <p className="small muted">
              {t(
                "Questi valori sono la fotografia dell'ordine al momento dell'acquisto. Non cambiano se il prodotto viene rinominato o se il prezzo cambia dopo.",
              )}
            </p>

            <div className="ac-table-scroll">
              <table className="ac-table">
                <caption className="visually-hidden">{t("Articoli dell'ordine")}</caption>
                <thead>
                  <tr>
                    <th scope="col">{t("Articolo")}</th>
                    <th scope="col">SKU</th>
                    <th scope="col" className="ac-table__numeric">
                      {t("Qtà")}
                    </th>
                    <th scope="col" className="ac-table__numeric">
                      {t("Prezzo")}
                    </th>
                    <th scope="col" className="ac-table__numeric">
                      {t("Totale")}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((item, i) => (
                    <tr key={i}>
                      <td data-label="Articolo">
                        {/* The snapshot name is what is shown. The link to the live
                          product is an extra, and it is absent when the product
                          has since been archived. */}
                        {item.product_id ? (
                          <Link to={`/admin/prodotti/${item.product_id}`}>{item.product_name}</Link>
                        ) : (
                          item.product_name
                        )}
                        {item.variant_label ? (
                          <span className="muted small"> · {item.variant_label}</span>
                        ) : null}
                        {item.device_model_name ? (
                          <>
                            <br />
                            <span className="caption muted">
                              {t("per ")}
                              {item.device_model_name}
                              {item.compatibility_state ? ` · ${item.compatibility_state}` : ""}
                            </span>
                          </>
                        ) : null}
                      </td>
                      <td data-label="SKU" className="numeric">
                        {item.sku}
                      </td>
                      <td data-label="Qtà" className="ac-table__numeric numeric">
                        {item.quantity}
                      </td>
                      <td data-label="Prezzo" className="ac-table__numeric numeric">
                        {formatMoney(money(item.unit_price), t.intl)}
                      </td>
                      <td data-label="Totale" className="ac-table__numeric numeric">
                        {formatMoney(money(item.line_total), t.intl)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <dl className="ac-totals">
              <Total label={t("Subtotale")} amount={Number(order.item_subtotal)} />
              {Number(order.discount_total) > 0 ? (
                <Total label={t("Sconto")} amount={-Number(order.discount_total)} />
              ) : null}
              {Number(order.shipping_total) > 0 ? (
                <Total label={t("Spedizione")} amount={Number(order.shipping_total)} />
              ) : null}
              <Total label={t("di cui IVA")} amount={Number(order.tax_total)} muted />
              <Total label={t("Totale")} amount={Number(order.grand_total)} strong />
            </dl>
          </section>

          {/* ── Payment ───────────────────────────────────────────────────────── */}
          {canSeePayments ? (
            <section className="panel stack ac-workspace__main">
              <h2>{t("Pagamento")}</h2>
              <dl className="ac-facts">
                <Fact label={t("Metodo")}>{String(order.payment_method_name ?? "—")}</Fact>
                <Fact label={t("Atteso")}>
                  {formatMoney(money(Number(order.amount_expected ?? 0)), t.intl)}
                </Fact>
                <Fact label={t("Ricevuto")}>
                  {order.amount_received === null ? (
                    <span className="muted">{t("non ancora verificato")}</span>
                  ) : (
                    formatMoney(money(Number(order.amount_received)), t.intl)
                  )}
                </Fact>
                {order.transaction_reference ? (
                  <Fact label={t("Riferimento")}>
                    <span className="numeric">{String(order.transaction_reference)}</span>
                  </Fact>
                ) : null}
                {order.verified_at ? (
                  <Fact label={t("Verificato il")}>
                    {formatDateTime(Number(order.verified_at), t.locale)}
                  </Fact>
                ) : null}
              </dl>
            </section>
          ) : null}

          {/* ── History ───────────────────────────────────────────────────────── */}
          <section className="panel stack ac-workspace__main">
            <h2>{t("Cronologia")}</h2>
            {history.length === 0 ? (
              <p className="small muted">{t("Nessun cambio di stato registrato.")}</p>
            ) : (
              <ul className="stack small">
                {history.map((row, i) => (
                  <li key={i}>
                    <span className="numeric">{formatDateTime(row.created_at, t.locale)}</span> —{" "}
                    {t(
                      row.from_status && isOrderStatus(row.from_status)
                        ? ORDER_STATUS_LABELS[row.from_status]
                        : (row.from_status ?? "creato"),
                    )}{" "}
                    →{" "}
                    <strong>
                      {t(
                        isOrderStatus(row.to_status)
                          ? ORDER_STATUS_LABELS[row.to_status]
                          : row.to_status,
                      )}
                    </strong>
                    {row.reason ? <span className="muted"> · {row.reason}</span> : null}
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* ── Internal note ─────────────────────────────────────────────────── */}
          {canWrite ? (
            <section className="panel stack ac-workspace__main">
              <h2>{t("Nota interna")}</h2>
              <p className="small muted">
                {t(
                  "Visibile solo allo staff. Il cliente non la vede mai, e non compare nel messaggio WhatsApp.",
                )}
              </p>
              <Form method="post" className="stack">
                <input type="hidden" name="intent" value="add-note" />
                <div className="field">
                  <label className="visually-hidden" htmlFor="note">
                    {t("Nota")}
                  </label>
                  <textarea id="note" name="note" className="input" rows={2} maxLength={1000} />
                </div>
                <button type="submit" className="btn btn--secondary">
                  {t("Aggiungi nota")}
                </button>
              </Form>
            </section>
          ) : null}
        </div>
      </div>
    </>
  );
}

function Total({
  label,
  amount,
  strong,
  muted,
}: {
  label: string;
  amount: number;
  strong?: boolean;
  muted?: boolean;
}) {
  const t = useAdminTranslator();
  return (
    <div className={`ac-total ${muted ? "muted" : ""}`}>
      <dt>{t(label)}</dt>
      <dd className="numeric">
        {strong ? (
          <strong>{formatMoney(money(amount), t.intl)}</strong>
        ) : (
          formatMoney(money(amount), t.intl)
        )}
      </dd>
    </div>
  );
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  const t = useAdminTranslator();
  return (
    <div className="ac-fact">
      <dt>{t(label)}</dt>
      <dd>{children}</dd>
    </div>
  );
}
