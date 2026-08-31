import type { ListView } from "~/lib/order-views";

/**
 * Saved views for the stock list.
 *
 * `esauriti`, `scorte-basse` and `prenotazioni-scadute` are the action centre's
 * targets, so the slugs are a contract checked by `tests/unit/deep-links`.
 *
 * "Available" is always `on_hand - reserved`, never `on_hand`. A unit that is
 * reserved against an unpaid order is not available to sell, and a stock screen
 * that shows the raw count is how a shop oversells — the exact failure the
 * inventory ledger exists to prevent.
 */
export const INVENTORY_VIEWS: readonly ListView[] = [
  { slug: "tutte", label: "Tutte", where: "1 = 1" },
  { slug: "esauriti", label: "Esauriti", where: "(il.on_hand - il.reserved) <= 0" },
  {
    slug: "scorte-basse",
    label: "Scorte basse",
    where: `il.reorder_threshold IS NOT NULL
            AND (il.on_hand - il.reserved) <= il.reorder_threshold
            AND (il.on_hand - il.reserved) > 0`,
  },
  {
    slug: "prenotate",
    label: "Con prenotazioni",
    where: "il.reserved > 0",
  },
  {
    slug: "prenotazioni-scadute",
    label: "Prenotazioni scadute",
    // Rows still holding stock for a reservation that should already have been
    // released. Persistently non-zero means the sweeper has stopped.
    where: `EXISTS (SELECT 1 FROM stock_reservations sr
                     WHERE sr.variant_id = il.variant_id
                       AND sr.location_id = il.location_id
                       AND sr.status = 'active'
                       AND sr.expires_at < unixepoch() * 1000)`,
  },
  {
    slug: "senza-soglia",
    label: "Senza soglia di riordino",
    // Without a threshold these variants can never appear in "scorte basse",
    // so they run out silently. Worth being able to find.
    where: "il.reorder_threshold IS NULL",
  },
];

export const INVENTORY_VIEW_SLUGS = INVENTORY_VIEWS.map((v) => v.slug);
