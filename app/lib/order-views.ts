import type { OrderStatus } from "~/domain/orders/status";
import type { PaymentStatus } from "~/domain/payments/status";

/**
 * Saved views and labels for orders and payments.
 *
 * Like `product-views.ts`, this is a contract with the screens that deep-link
 * here, so it lives outside the route and is checked by a test.
 *
 * It also holds the Italian labels for both status machines. The list used to
 * print raw values — a merchant was shown a filter chip reading
 * `awaiting_customer_contact`. Storing English snake_case in the database is
 * correct; showing it to a shopkeeper is not, and translating it inline in
 * three different screens is how three screens end up disagreeing.
 */

export interface ListView {
  slug: string;
  label: string;
  /** A complete boolean SQL fragment. */
  where: string;
}

/**
 * Order views.
 *
 * "da-contattare" and "da-preparare" are the action centre's targets. They are
 * phrased as jobs rather than states because that is what the merchant is
 * looking for: not "which orders are in status processing" but "which ones do
 * I have to put in a bag today".
 */
export const ORDER_VIEWS: readonly ListView[] = [
  {
    slug: "aperti",
    label: "Aperti",
    where: "o.status NOT IN ('cancelled','expired','refunded','delivered','collected')",
  },
  { slug: "tutti", label: "Tutti", where: "1 = 1" },
  {
    slug: "da-contattare",
    label: "Da contattare",
    where: "o.status = 'awaiting_customer_contact'",
  },
  {
    slug: "in-attesa-pagamento",
    label: "In attesa di pagamento",
    where: "o.status IN ('awaiting_payment','payment_under_review')",
  },
  { slug: "da-preparare", label: "Da preparare", where: "o.status IN ('paid','processing')" },
  { slug: "pronti", label: "Pronti", where: "o.status IN ('ready_for_pickup','shipped')" },
  {
    slug: "conclusi",
    label: "Conclusi",
    where: "o.status IN ('delivered','collected')",
  },
  {
    slug: "annullati",
    label: "Annullati",
    where: "o.status IN ('cancelled','expired','refunded','partially_refunded')",
  },
];

export const ORDER_VIEW_SLUGS = ORDER_VIEWS.map((v) => v.slug);

/** Facet values the orders list accepts, and the SQL each one means. */
export const ORDER_DELIVERY_FACET: Readonly<Record<string, string>> = {
  ritiro: "o.delivery_method = 'pickup'",
  spedizione: "o.delivery_method = 'shipping'",
};

/**
 * Payment views. "da-verificare" is the action centre's target and the single
 * most-used screen in the shop, so it is also the default.
 */
export const PAYMENT_VIEWS: readonly ListView[] = [
  {
    slug: "da-verificare",
    label: "Da verificare",
    where: "op.status IN ('proof_received','under_verification')",
  },
  { slug: "in-verifica", label: "In verifica", where: "op.status = 'under_verification'" },
  { slug: "in-attesa", label: "In attesa", where: "op.status = 'awaiting_payment'" },
  { slug: "verificati", label: "Verificati", where: "op.status = 'verified'" },
  {
    slug: "problemi",
    label: "Con problemi",
    where: "op.status IN ('partially_paid','overpaid','rejected')",
  },
  { slug: "tutti", label: "Tutti", where: "1 = 1" },
];

export const PAYMENT_VIEW_SLUGS = PAYMENT_VIEWS.map((v) => v.slug);

/** Italian labels for every order status. Exhaustive by type. */
export const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  draft: "Bozza",
  awaiting_customer_contact: "Da contattare",
  awaiting_payment: "In attesa di pagamento",
  payment_under_review: "Pagamento in verifica",
  paid: "Pagato",
  processing: "In preparazione",
  ready_for_pickup: "Pronto per il ritiro",
  shipped: "Spedito",
  delivered: "Consegnato",
  collected: "Ritirato",
  cancelled: "Annullato",
  expired: "Scaduto",
  return_requested: "Reso richiesto",
  returned: "Reso ricevuto",
  partially_refunded: "Rimborsato in parte",
  refunded: "Rimborsato",
};

/** Italian labels for every payment status. Exhaustive by type. */
export const PAYMENT_STATUS_LABELS: Record<PaymentStatus, string> = {
  awaiting_customer_contact: "Da contattare",
  awaiting_payment: "In attesa di pagamento",
  proof_received: "Ricevuta ricevuta",
  under_verification: "In verifica",
  verified: "Verificato",
  partially_paid: "Pagato in parte",
  overpaid: "Pagato in eccesso",
  rejected: "Rifiutato",
  expired: "Scaduto",
  refunded: "Rimborsato",
  cancelled: "Annullato",
};

/**
 * The visual tone for a status badge.
 *
 * The word inside the badge always carries the meaning; the tone only
 * reinforces it, so nothing is lost in greyscale or to a colour-vision
 * difference. `verified` is the only payment status that earns success, because
 * it is the only one that means the money is actually there.
 */
export function orderStatusTone(status: string): string {
  if (status === "delivered" || status === "collected") return "badge--success";
  if (status === "cancelled" || status === "expired") return "badge--muted";
  if (status === "refunded" || status === "partially_refunded" || status === "returned")
    return "badge--sale";
  if (status === "awaiting_customer_contact" || status === "payment_under_review")
    return "badge--warning";
  return "badge--info";
}

export function paymentStatusTone(status: string): string {
  if (status === "verified") return "badge--success";
  if (status === "rejected" || status === "partially_paid" || status === "overpaid")
    return "badge--sale";
  if (status === "proof_received" || status === "under_verification") return "badge--warning";
  if (status === "expired" || status === "cancelled") return "badge--muted";
  return "badge--info";
}

/** Delivery method in the merchant's words. */
export const DELIVERY_LABELS: Readonly<Record<string, string>> = {
  pickup: "Ritiro in negozio",
  shipping: "Spedizione",
};
