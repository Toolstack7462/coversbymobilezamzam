import { Form, Link, useLocation, redirect } from "react-router";
import type { Route } from "./+types/checkout";
import { cloudflareContext } from "../../../workers/app";
import { parseLocalePath, translator, localePath } from "~/lib/i18n";
import { money, format as formatMoney } from "~/domain/pricing/money";
import { calculateTotals } from "~/domain/cart/totals";
import { systemClock, cryptoIds } from "~/infrastructure/primitives";
import { readCartToken, readCartLines } from "~/lib/cart.server";
import { createOrder, CreateOrderInput } from "~/application/commands/create-order";
import { canOfferPickup, canOfferShipping, type SettingsMap } from "~/domain/content/gates";

const VAT_BASIS_POINTS = 2200;

export async function loader({ context, request }: Route.LoaderArgs) {
  const { env } = context.get(cloudflareContext);

  const token = await readCartToken(request, env.BETTER_AUTH_SECRET);
  const cart = token
    ? await env.DB.prepare(`SELECT id FROM carts WHERE token = ?1`)
        .bind(token)
        .first<{ id: string }>()
    : null;
  const lines = cart ? await readCartLines(env.DB, cart.id) : [];

  const [methods, settingsResult, location] = await Promise.all([
    // ONLY active methods. A method whose merchant data is missing is never
    // offered (invariant 12) — better no option than money sent to the wrong
    // place.
    env.DB.prepare(
      `SELECT id, code, name_it, name_en, description_it, description_en,
              eligible_for_shipping, eligible_for_pickup, reservation_minutes
         FROM payment_methods
        WHERE active = 1 AND archived_at IS NULL
        ORDER BY sort_order ASC`,
    ).all<{
      id: string;
      code: string;
      name_it: string;
      name_en: string;
      description_it: string | null;
      description_en: string | null;
      eligible_for_shipping: number;
      eligible_for_pickup: number;
      reservation_minutes: number;
    }>(),
    env.DB.prepare(`SELECT key, value FROM store_settings`).all<{
      key: string;
      value: string;
    }>(),
    env.DB.prepare(
      `SELECT id FROM inventory_locations WHERE sellable_online = 1 AND active = 1 LIMIT 1`,
    ).first<{ id: string }>(),
  ]);

  const settings: SettingsMap = Object.fromEntries(
    settingsResult.results.map((r) => [r.key, r.value]),
  );

  const totals =
    lines.length > 0
      ? calculateTotals({
          lines: lines.map((l) => ({
            variantId: l.variantId,
            quantity: l.quantity,
            unitPrice: money(l.unitPrice),
          })),
          vatBasisPoints: VAT_BASIS_POINTS,
        })
      : null;

  return {
    lines,
    grandTotal: totals?.grandTotal.amount ?? 0,
    paymentMethods: methods.results,
    canPickup: canOfferPickup(settings),
    canShip: canOfferShipping(settings),
    hasLocation: Boolean(location),
  };
}

export async function action({ context, request }: Route.ActionArgs) {
  const { env } = context.get(cloudflareContext);
  const form = await request.formData();
  const { locale } = parseLocalePath(new URL(request.url).pathname);

  const token = await readCartToken(request, env.BETTER_AUTH_SECRET);
  if (!token) return { error: "generic" as const };

  const cart = await env.DB.prepare(`SELECT id FROM carts WHERE token = ?1`)
    .bind(token)
    .first<{ id: string }>();
  if (!cart) return { error: "generic" as const };

  const lines = await readCartLines(env.DB, cart.id);
  if (lines.length === 0) return { error: "generic" as const };

  const location = await env.DB.prepare(
    `SELECT id FROM inventory_locations WHERE sellable_online = 1 AND active = 1 LIMIT 1`,
  ).first<{ id: string }>();
  if (!location) return { error: "generic" as const };

  const deliveryMethod = form.get("deliveryMethod") === "pickup" ? "pickup" : "shipping";

  const parsed = CreateOrderInput.safeParse({
    cartToken: token,
    // Scoped to this cart so one customer cannot replay another's key.
    idempotencyKey: String(form.get("idempotencyKey") ?? `${token}:${cryptoIds.generate()}`),
    customerFirstName: String(form.get("firstName") ?? ""),
    customerLastName: String(form.get("lastName") ?? ""),
    customerEmail: String(form.get("email") ?? ""),
    customerPhone: String(form.get("phone") ?? "") || undefined,
    deliveryMethod,
    paymentMethodId: String(form.get("paymentMethodId") ?? ""),
    customerNote: String(form.get("note") ?? "") || undefined,
    address:
      deliveryMethod === "shipping"
        ? {
            street: String(form.get("street") ?? ""),
            streetNumber: String(form.get("streetNumber") ?? "") || undefined,
            postcode: String(form.get("postcode") ?? ""),
            city: String(form.get("city") ?? ""),
            province: String(form.get("province") ?? "") || undefined,
            country: "IT",
          }
        : undefined,
    // The cart is a list of variant ids and quantities. No price, no total.
    lines: lines.map((l) => ({ variantId: l.variantId, quantity: l.quantity })),
  });

  if (!parsed.success) {
    return {
      error: "validation" as const,
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }

  const result = await createOrder(parsed.data, {
    d1: env.DB,
    clock: systemClock,
    ids: cryptoIds,
    vatBasisPoints: VAT_BASIS_POINTS,
    defaultLocationId: location.id,
  });

  if (!result.ok) return { error: result.reason };

  // The cart is emptied only after the order exists.
  await env.DB.prepare(`DELETE FROM cart_items WHERE cart_id = ?1`).bind(cart.id).run();

  return redirect(localePath(locale, `/ordine/${result.orderNumber}?t=${result.trackingToken}`));
}

export default function Checkout({ loaderData, actionData }: Route.ComponentProps) {
  const { pathname } = useLocation();
  const { locale } = parseLocalePath(pathname);
  const t = translator(locale);
  const path = (p: string) => localePath(locale, p);
  const intl = locale === "it" ? "it-IT" : "en-GB";

  const { lines, grandTotal, paymentMethods, canPickup, canShip } = loaderData;

  if (lines.length === 0) {
    return (
      <div className="page section">
        <h1>{t("checkout.title")}</h1>
        <div className="empty-state">
          <p>{t("cart.empty")}</p>
          <Link className="btn btn--primary" to={path("/shop")}>
            {t("cart.continue_shopping")}
          </Link>
        </div>
      </div>
    );
  }

  // No configured payment method means no order can be completed. Say so
  // plainly instead of showing a button that cannot work.
  if (paymentMethods.length === 0) {
    return (
      <div className="page section">
        <h1>{t("checkout.title")}</h1>
        <div className="notice notice--warning">
          <p>{t("checkout.no_payment_methods")}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="page section stack checkout">
      <h1>{t("checkout.title")}</h1>

      {/* Stated before the customer commits, not after. */}
      <p className="notice notice--info">{t("checkout.no_payment_on_site")}</p>

      {actionData && "error" in actionData ? (
        <div className="notice notice--danger" role="alert">
          {t(`errors.${actionData.error === "validation" ? "generic" : actionData.error}`)}
        </div>
      ) : null}

      <Form method="post" className="stack">
        <fieldset className="panel stack">
          <legend>
            <h2>{t("checkout.your_details")}</h2>
          </legend>

          <div className="field">
            <label className="field__label" htmlFor="firstName">
              {t("checkout.first_name")}
            </label>
            <input
              id="firstName"
              name="firstName"
              className="input"
              required
              autoComplete="given-name"
            />
          </div>

          <div className="field">
            <label className="field__label" htmlFor="lastName">
              {t("checkout.last_name")}
            </label>
            <input
              id="lastName"
              name="lastName"
              className="input"
              required
              autoComplete="family-name"
            />
          </div>

          <div className="field">
            <label className="field__label" htmlFor="email">
              {t("checkout.email")}
            </label>
            {/* type=email so mobile shows the right keyboard. */}
            <input
              id="email"
              name="email"
              type="email"
              className="input"
              required
              autoComplete="email"
            />
          </div>

          <div className="field">
            <label className="field__label" htmlFor="phone">
              {t("checkout.whatsapp")} <span className="muted">({t("common.optional")})</span>
            </label>
            <input id="phone" name="phone" type="tel" className="input" autoComplete="tel" />
          </div>
        </fieldset>

        <fieldset className="panel stack">
          <legend>
            <h2>{t("checkout.delivery")}</h2>
          </legend>

          {/* Only genuinely configured options appear. */}
          {canShip ? (
            <label className="cluster">
              <input type="radio" name="deliveryMethod" value="shipping" defaultChecked />
              <span>{t("checkout.delivery_shipping")}</span>
            </label>
          ) : null}
          {canPickup ? (
            <label className="cluster">
              <input type="radio" name="deliveryMethod" value="pickup" defaultChecked={!canShip} />
              <span>{t("checkout.delivery_pickup")}</span>
            </label>
          ) : null}

          {canShip ? (
            <>
              <div className="field">
                <label className="field__label" htmlFor="street">
                  {t("checkout.address")}
                </label>
                <input id="street" name="street" className="input" autoComplete="address-line1" />
              </div>
              <div className="field">
                <label className="field__label" htmlFor="postcode">
                  {t("checkout.postcode")}
                </label>
                <input
                  id="postcode"
                  name="postcode"
                  className="input numeric"
                  inputMode="numeric"
                  pattern="[0-9]{5}"
                  autoComplete="postal-code"
                />
                <span className="field__hint">{t("checkout.invalid_postcode")}</span>
              </div>
              <div className="field">
                <label className="field__label" htmlFor="city">
                  {t("checkout.city")}
                </label>
                <input id="city" name="city" className="input" autoComplete="address-level2" />
              </div>
              <div className="field">
                <label className="field__label" htmlFor="province">
                  {t("checkout.province")}
                </label>
                <input id="province" name="province" className="input" maxLength={2} />
              </div>
            </>
          ) : null}
        </fieldset>

        <fieldset className="panel stack">
          <legend>
            <h2>{t("checkout.payment_method")}</h2>
          </legend>
          {paymentMethods.map((method, index) => (
            <label key={method.id} className="cluster">
              <input
                type="radio"
                name="paymentMethodId"
                value={method.id}
                defaultChecked={index === 0}
                required
              />
              <span>
                {locale === "it" ? method.name_it : method.name_en}
                {(locale === "it" ? method.description_it : method.description_en) ? (
                  <span className="small muted">
                    {" — "}
                    {locale === "it" ? method.description_it : method.description_en}
                  </span>
                ) : null}
              </span>
            </label>
          ))}
        </fieldset>

        <div className="panel stack">
          <p className="cluster">
            <strong>{t("common.total")}</strong>
            <strong className="price">{formatMoney(money(grandTotal), intl)}</strong>
          </p>
          <p className="caption muted">{t("common.vat_included")}</p>
          <p className="caption muted">{t("checkout.terms_accept")}</p>

          {/*
            "Conferma l'ordine", never "Paga ora". The site takes no money and
            the button must not imply otherwise.
          */}
          <button type="submit" className="btn btn--primary">
            {t("checkout.confirm_order")}
          </button>
        </div>
      </Form>
    </div>
  );
}
