import {
  ORDER_STATUS_LABELS,
  PAYMENT_STATUS_LABELS,
  orderStatusTone,
  paymentStatusTone,
} from "~/lib/order-views";
import { COMPATIBILITY_LABELS } from "~/lib/compatibility-views";
import type { AvailabilityState } from "~/domain/inventory/availability";

/**
 * One badge, for every state this system has.
 *
 * ── WHY THIS EXISTS ─────────────────────────────────────────────────────────
 *
 * Five admin screens were rendering the raw database value straight into the
 * page. An Italian shopkeeper looking at their own stock list saw:
 *
 *     out_of_stock        low_stock        in_stock
 *
 * and on the payments, pickups and staff screens the same thing with different
 * words. The project has been here before — CLAUDE.md records a merchant being
 * shown a filter chip reading `awaiting_customer_contact` — and the reason it
 * keeps happening is that the labels lived next to the screens that remembered
 * to use them, so a new screen simply did not know they existed.
 *
 * This is the one place that knows. Every state in the system is named here, in
 * Italian, with the tone it earns.
 *
 * ── WHY THE TONE NEVER CARRIES THE MEANING ──────────────────────────────────
 *
 * The word inside the badge always says what the state is. Colour only
 * reinforces it, so nothing is lost in greyscale, in a screenshot printed in
 * black and white, or to a colour-vision difference. That rule is inherited
 * from the existing `orderStatusTone`, and it is why there is no badge whose
 * only content is a coloured dot.
 *
 * ── WHAT HAPPENS TO AN UNKNOWN VALUE ────────────────────────────────────────
 *
 * It is shown, humanised, in the warning tone, and logged in development. NOT
 * hidden, and NOT passed through raw. A state nobody has translated is a real
 * gap and the merchant should be able to see that something is there, while the
 * next developer gets told about it in the console rather than by a customer.
 */

export type StatusKind =
  "order" | "payment" | "product" | "availability" | "staff" | "compatibility";

/** Stock states. The one set that had no Italian labels anywhere. */
const AVAILABILITY_LABELS: Record<AvailabilityState, string> = {
  in_stock: "Disponibile",
  low_stock: "In esaurimento",
  out_of_stock: "Esaurito",
  backorder: "Su ordinazione",
  // Not "zero": a variant with no inventory row is one the shop does not count,
  // which is different from one it counts and has none of. Saying "esaurito"
  // here would claim a stock level that was never recorded.
  not_tracked: "Non tracciato",
};

const AVAILABILITY_TONES: Record<AvailabilityState, string> = {
  in_stock: "badge--success",
  low_stock: "badge--warning",
  out_of_stock: "badge--sale",
  backorder: "badge--info",
  not_tracked: "badge--muted",
};

/**
 * Publication states, moved off the products list.
 *
 * `active` is labelled "Pubblicato" rather than "Attivo" because that is the
 * question the merchant is asking of this column: is it on the website?
 */
const PRODUCT_LABELS: Record<string, string> = {
  active: "Pubblicato",
  draft: "Bozza",
  archived: "Archiviato",
};

const PRODUCT_TONES: Record<string, string> = {
  active: "badge--success",
  draft: "badge--info",
  archived: "badge--muted",
};

/**
 * Staff account states.
 *
 * `suspended` and `disabled` look identical to the access check and completely
 * different to a human reading the staff list — which is exactly why the column
 * exists, and why it must not print the English word.
 */
const STAFF_LABELS: Record<string, string> = {
  invited: "Invitato",
  active: "Attivo",
  suspended: "Sospeso",
  disabled: "Disattivato",
  archived: "Archiviato",
};

const STAFF_TONES: Record<string, string> = {
  invited: "badge--info",
  active: "badge--success",
  suspended: "badge--warning",
  disabled: "badge--sale",
  archived: "badge--muted",
};

const COMPATIBILITY_TONES: Record<string, string> = {
  exact_fit: "badge--success",
  compatible: "badge--success",
  universal: "badge--info",
  adapter_required: "badge--warning",
  incompatible: "badge--sale",
  unverified: "badge--muted",
};

function resolve(kind: StatusKind, value: string): { label: string; tone: string } {
  switch (kind) {
    case "order": {
      const label = ORDER_STATUS_LABELS[value as keyof typeof ORDER_STATUS_LABELS];
      return label ? { label, tone: orderStatusTone(value) } : unknownState(kind, value);
    }
    case "payment": {
      const label = PAYMENT_STATUS_LABELS[value as keyof typeof PAYMENT_STATUS_LABELS];
      return label ? { label, tone: paymentStatusTone(value) } : unknownState(kind, value);
    }
    case "availability": {
      const label = AVAILABILITY_LABELS[value as AvailabilityState];
      return label
        ? { label, tone: AVAILABILITY_TONES[value as AvailabilityState]! }
        : unknownState(kind, value);
    }
    case "product": {
      const label = PRODUCT_LABELS[value];
      return label ? { label, tone: PRODUCT_TONES[value]! } : unknownState(kind, value);
    }
    case "staff": {
      const label = STAFF_LABELS[value];
      return label ? { label, tone: STAFF_TONES[value]! } : unknownState(kind, value);
    }
    case "compatibility": {
      const label = COMPATIBILITY_LABELS[value as keyof typeof COMPATIBILITY_LABELS];
      return label
        ? { label, tone: COMPATIBILITY_TONES[value] ?? "badge--info" }
        : unknownState(kind, value);
    }
  }
}

/**
 * A state with no Italian label.
 *
 * Humanised — `awaiting_thing` becomes `Awaiting thing` — so it reads as a
 * missing translation rather than as a database column that leaked, and toned
 * as a warning so it is visibly not a normal state.
 */
function unknownState(kind: StatusKind, value: string): { label: string; tone: string } {
  if (import.meta.env.DEV) {
    console.warn(
      `StatusBadge: no Italian label for ${kind} state ${JSON.stringify(value)}. ` +
        "Add it to app/components/admin/status-badge.tsx.",
    );
  }
  const humanised = value.replace(/_/g, " ");
  return {
    label: humanised.charAt(0).toUpperCase() + humanised.slice(1),
    tone: "badge--warning",
  };
}

export function StatusBadge({
  kind,
  value,
  /**
   * Extra context for a screen reader, when the badge's own word is not enough
   * on its own — a table cell reading "Esaurito" with no column context, say.
   */
  describedAs,
}: {
  kind: StatusKind;
  value: string;
  describedAs?: string;
}) {
  const { label, tone } = resolve(kind, value);
  return (
    <span className={`badge ${tone}`}>
      {describedAs ? <span className="visually-hidden">{describedAs}: </span> : null}
      {label}
    </span>
  );
}

/** The label alone, for places that are not a badge — a sentence, a title. */
export function statusLabel(kind: StatusKind, value: string): string {
  return resolve(kind, value).label;
}

export { AVAILABILITY_LABELS, PRODUCT_LABELS, STAFF_LABELS };
