import { Link, Form, useLocation, redirect } from "react-router";
import type { Route } from "./+types/cart";
import { cloudflareContext } from "../../../workers/app";
import { parseLocalePath, translator, localePath } from "~/lib/i18n";
import { money, format as formatMoney } from "~/domain/pricing/money";
import { calculateTotals } from "~/domain/cart/totals";
import { systemClock, cryptoIds } from "~/infrastructure/primitives";
import {
  readCartToken,
  serialiseCartToken,
  ensureCart,
  readCartLines,
  addToCart,
  setQuantity,
} from "~/lib/cart.server";

const VAT_BASIS_POINTS = 2200;

export function meta() {
  // noindex: a cart page is per-visitor and has nothing to offer a search
  // engine, and an indexed one leaks nothing useful but wastes crawl budget.
  return [{ title: "Carrello" }, { name: "robots", content: "noindex, follow" }];
}

export async function loader({ context, request }: Route.LoaderArgs) {
  const { env } = context.get(cloudflareContext);
  const token = await readCartToken(request, env.BETTER_AUTH_SECRET);
  if (!token) return { lines: [], totals: null };

  const cart = await env.DB.prepare(`SELECT id FROM carts WHERE token = ?1`)
    .bind(token)
    .first<{ id: string }>();
  if (!cart) return { lines: [], totals: null };

  const lines = await readCartLines(env.DB, cart.id);
  if (lines.length === 0) return { lines: [], totals: null };

  // Prices are re-read here, every render. A change is shown to the customer
  // now rather than sprung on them at checkout (invariant 2).
  const totals = calculateTotals({
    lines: lines.map((l) => ({
      variantId: l.variantId,
      quantity: l.quantity,
      unitPrice: money(l.unitPrice),
    })),
    vatBasisPoints: VAT_BASIS_POINTS,
  });

  return {
    lines,
    totals: {
      subtotal: totals.itemSubtotal.amount,
      grandTotal: totals.grandTotal.amount,
      tax: totals.taxTotal.amount,
    },
  };
}

export async function action({ context, request }: Route.ActionArgs) {
  const { env } = context.get(cloudflareContext);
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");
  const now = systemClock.now();

  let token = await readCartToken(request, env.BETTER_AUTH_SECRET);
  let setCookie: string | null = null;
  if (!token) {
    token = cryptoIds.generate();
    setCookie = await serialiseCartToken(token, env.BETTER_AUTH_SECRET);
  }

  const cartId = await ensureCart(env.DB, token, now, cryptoIds.generate());

  const variantId = String(form.get("variantId") ?? "");
  // Quantity is clamped server-side. A negative or absurd value submitted by
  // hand is corrected here, not trusted.
  const quantity = Math.max(0, Math.min(99, Number(form.get("quantity") ?? 1) || 0));

  if (intent === "add" && variantId) {
    await addToCart(env.DB, cartId, variantId, Math.max(1, quantity), now, cryptoIds.generate());
  } else if (intent === "update" && variantId) {
    await setQuantity(env.DB, cartId, variantId, quantity, now);
  } else if (intent === "remove" && variantId) {
    await setQuantity(env.DB, cartId, variantId, 0, now);
  }

  const { locale } = parseLocalePath(new URL(request.url).pathname);
  return redirect(
    localePath(locale, "/carrello"),
    setCookie ? { headers: { "Set-Cookie": setCookie } } : undefined,
  );
}

export default function CartPage({ loaderData }: Route.ComponentProps) {
  const { pathname } = useLocation();
  const { locale } = parseLocalePath(pathname);
  const t = translator(locale);
  const path = (p: string) => localePath(locale, p);
  const intl = locale === "it" ? "it-IT" : "en-GB";

  const { lines, totals } = loaderData;

  if (lines.length === 0) {
    return (
      <div className="page section">
        <h1>{t("cart.title")}</h1>
        <div className="empty-state">
          <p>{t("cart.empty")}</p>
          <p>{t("cart.empty_help")}</p>
          <Link className="btn btn--primary" to={path("/shop")}>
            {t("cart.continue_shopping")}
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="page section stack">
      <h1>{t("cart.title")}</h1>

      <ul className="cart-lines stack">
        {lines.map((line) => {
          const short = !line.allowBackorder && line.quantity > line.available;
          return (
            <li key={line.variantId} className="card cart-line">
              <div className="cart-line__body">
                <h2 className="cart-line__title">
                  <Link to={path(`/prodotti/${line.slug}`)}>{line.productName}</Link>
                </h2>
                {line.variantLabel ? <p className="small muted">{line.variantLabel}</p> : null}
                <p className="caption muted numeric">{line.sku}</p>

                {/* Availability changes are surfaced on the cart, not at the
                    last step of checkout. */}
                {short ? (
                  <p className="notice notice--warning small">{t("cart.stock_changed")}</p>
                ) : null}
              </div>

              <div className="cart-line__controls">
                <Form method="post" className="cluster">
                  <input type="hidden" name="intent" value="update" />
                  <input type="hidden" name="variantId" value={line.variantId} />
                  <label className="visually-hidden" htmlFor={`qty-${line.variantId}`}>
                    {t("common.quantity")}
                  </label>
                  <input
                    id={`qty-${line.variantId}`}
                    name="quantity"
                    type="number"
                    inputMode="numeric"
                    min={0}
                    max={99}
                    defaultValue={line.quantity}
                    className="input numeric"
                    style={{ width: "5rem" }}
                  />
                  <button type="submit" className="btn btn--secondary">
                    {t("common.save")}
                  </button>
                </Form>

                <Form method="post">
                  <input type="hidden" name="intent" value="remove" />
                  <input type="hidden" name="variantId" value={line.variantId} />
                  <button type="submit" className="btn btn--ghost">
                    {t("common.remove")}
                  </button>
                </Form>
              </div>

              <p className="price cart-line__price">
                {formatMoney(money(line.unitPrice * line.quantity), intl)}
              </p>
            </li>
          );
        })}
      </ul>

      {totals ? (
        <div className="panel stack cart-summary">
          <p className="cluster">
            <span>{t("common.subtotal")}</span>
            <span className="price">{formatMoney(money(totals.subtotal), intl)}</span>
          </p>
          <p className="cluster">
            <strong>{t("common.total")}</strong>
            <strong className="price">{formatMoney(money(totals.grandTotal), intl)}</strong>
          </p>
          <p className="caption muted">{t("common.vat_included")}</p>
          <Link className="btn btn--primary" to={path("/cassa")}>
            {t("cart.checkout")}
          </Link>
          <Link className="btn btn--ghost" to={path("/shop")}>
            {t("cart.continue_shopping")}
          </Link>
        </div>
      ) : null}
    </div>
  );
}
