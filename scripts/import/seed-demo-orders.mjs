/**
 * Demo ORDERS, for the browser suite and for looking at the order screens.
 *
 *   node scripts/import/seed-demo-orders.mjs --db DB --persist-to .wrangler/e2e
 *
 * Depends on seed.mjs (payment methods, location) and seed-demo.mjs (catalogue)
 * having run first.
 *
 * ── WHY THIS IS SEPARATE FROM seed-demo.mjs ─────────────────────────────────
 *
 * That file refuses to create orders, and it is right to: it says so in its own
 * header, because a seeded VERIFIED payment would be a lie told to the one
 * screen whose entire job is to be trustworthy. Nothing here contradicts that.
 *
 * What it creates instead is the state a real shop is actually in most of the
 * time — orders that have arrived and have NOT been paid yet:
 *
 *   awaiting_customer_contact   just placed, instructions not sent
 *   awaiting_payment            instructions sent, waiting
 *   payment_under_review        a proof arrived and a human must look at it
 *
 * **No order is `paid`. No payment is `verified`. No payment proof file is
 * created.** Verification is a human act against a real bank account
 * (invariant 6), and the whole point of the payments screen is that a row in it
 * means somebody checked. A seeded `verified` row would make the screen lie in
 * exactly the place it must not.
 *
 * That still exercises everything the order screens do: the list, its views,
 * the detail workspace, the timeline, reservations, the WhatsApp message, and —
 * most importantly — the verification flow itself, which now has something
 * real to act on rather than an empty queue.
 *
 * ── RESERVATIONS ARE REAL ───────────────────────────────────────────────────
 *
 * Each order holds stock through `stock_reservations` AND increments
 * `inventory_levels.reserved`, exactly as `create-order.ts` does. Seeding an
 * order without its reservation would produce a shop whose stock figures do not
 * add up, and the inventory screen would be showing a fiction.
 *
 * One order is deliberately EXPIRED, so the reservation sweeper has something
 * to release and the "Prenotazioni scadute" view is not permanently empty.
 *
 * Idempotent: fixed ids, `ON CONFLICT DO NOTHING`.
 */

import { execFileSync } from "node:child_process";

const args = process.argv.slice(2);
const dbIndex = args.indexOf("--db");
const DB = dbIndex >= 0 ? args[dbIndex + 1] : "DB";
const envIndex = args.indexOf("--env");
const ENVIRONMENT = envIndex >= 0 ? args[envIndex + 1] : null;
const REMOTE = args.includes("--remote");
const persistIndex = args.indexOf("--persist-to");
const PERSIST_TO = persistIndex >= 0 ? args[persistIndex + 1] : null;

if (REMOTE && PERSIST_TO) {
  console.error("--persist-to is a local-only option; it cannot be combined with --remote.");
  process.exit(1);
}

/*
 * A fixed instant, so re-running produces identical rows rather than a new
 * timestamp that makes every record look freshly edited.
 *
 * The same constant seed-demo.mjs uses, so the catalogue and the orders agree
 * about when this shop started trading.
 */
const NOW = 1_756_000_000_000;
const HOUR = 60 * 60 * 1000;

const statements = [];
const sql = (text) => statements.push(text.trim());
const esc = (value) => String(value).replace(/'/g, "''");

/**
 * The variants these orders are for.
 *
 * Fixed ids from seed-demo.mjs. If that file's ids change these inserts fail on
 * the foreign key — loudly, which is correct: an order pointing at a product
 * that does not exist is worse than no order.
 */
const LOCATION = "loc_shop";

const ORDERS = [
  {
    id: "ord_demo_contact",
    number: "DEMO-0001",
    token: "demo-track-0001",
    status: "awaiting_customer_contact",
    paymentStatus: "awaiting_customer_contact",
    first: "Giulia",
    last: "Ferretti",
    email: "giulia.ferretti@example.invalid",
    phone: "+39 333 000 0001",
    delivery: "pickup",
    method: "pm_bank_transfer",
    placedHoursAgo: 2,
    reservationHours: 24,
    lines: [
      {
        variant: "var_demo_cover16pro_clear",
        qty: 1,
        unit: 1990,
        name: "[DEMO] Cover trasparente — iPhone 16 Pro",
        sku: "DEMO-COV-16P-CLR",
      },
    ],
  },
  {
    id: "ord_demo_awaiting",
    number: "DEMO-0002",
    token: "demo-track-0002",
    status: "awaiting_payment",
    paymentStatus: "awaiting_payment",
    first: "Marco",
    last: "Bianchi",
    email: "marco.bianchi@example.invalid",
    phone: "+39 333 000 0002",
    delivery: "shipping",
    method: "pm_satispay",
    placedHoursAgo: 6,
    reservationHours: 2,
    lines: [
      {
        variant: "var_demo_cavo100_1m",
        qty: 2,
        unit: 1290,
        name: "[DEMO] Cavo USB-C 100W — 1 m",
        sku: "DEMO-CAB-100W-1M",
      },
      {
        variant: "var_demo_carica25_white",
        qty: 1,
        unit: 1590,
        name: "[DEMO] Caricatore USB-C 25W",
        sku: "DEMO-CHG-25W-WHT",
      },
    ],
  },
  {
    /*
     * The one the payments screen exists for: a customer says they have paid,
     * and a human has to check the bank before anything is dispatched.
     *
     * `proof_received` WITHOUT a payment_proofs row: the file is a photograph
     * of somebody's bank transfer and this fixture has none to offer. The
     * screen handles a claimed payment with no attachment — which is also what
     * a WhatsApp-only customer produces in real life.
     */
    id: "ord_demo_review",
    number: "DEMO-0003",
    token: "demo-track-0003",
    status: "payment_under_review",
    paymentStatus: "proof_received",
    first: "Sofia",
    last: "Ricci",
    email: "sofia.ricci@example.invalid",
    phone: "+39 333 000 0003",
    delivery: "pickup",
    method: "pm_bank_transfer",
    placedHoursAgo: 20,
    reservationHours: 24,
    reference: "TRN-DEMO-0003",
    lines: [
      {
        variant: "var_demo_powerbank_black",
        qty: 1,
        unit: 3490,
        name: "[DEMO] Power bank magnetico 5000 mAh",
        sku: "DEMO-PWR-5000-BLK",
      },
    ],
  },
  {
    /*
     * Expired on purpose.
     *
     * The reservation window has passed and the stock is still held, which is
     * exactly the state the sweeper exists to resolve. Without one, the
     * "Prenotazioni scadute" view and the sweeper's own screen are permanently
     * empty and nobody can tell whether they work.
     */
    id: "ord_demo_expired",
    number: "DEMO-0004",
    token: "demo-track-0004",
    status: "awaiting_payment",
    paymentStatus: "awaiting_payment",
    first: "Luca",
    last: "Moretti",
    email: "luca.moretti@example.invalid",
    phone: "+39 333 000 0004",
    delivery: "pickup",
    method: "pm_satispay",
    placedHoursAgo: 30,
    reservationHours: -4,
    lines: [
      {
        variant: "var_demo_cover16pro_black",
        qty: 1,
        unit: 1990,
        name: "[DEMO] Cover trasparente — iPhone 16 Pro",
        sku: "DEMO-COV-16P-BLK",
      },
    ],
  },
];

for (const order of ORDERS) {
  const placedAt = NOW - order.placedHoursAgo * HOUR;
  const expiresAt = placedAt + order.reservationHours * HOUR;

  const itemSubtotal = order.lines.reduce((sum, l) => sum + l.unit * l.qty, 0);
  // VAT-inclusive pricing, as the storefront uses: the grand total IS the sum
  // of the lines. Inventing a separate tax line would misstate what the
  // customer was shown.
  const grandTotal = itemSubtotal;

  sql(`INSERT INTO orders (
         id, order_number, tracking_token, status,
         customer_first_name, customer_last_name, customer_email, customer_phone,
         delivery_method, payment_method_id, item_subtotal, discount_total,
         shipping_total, tax_total, grand_total, currency,
         reservation_expires_at, placed_at, created_at, updated_at
       ) VALUES (
         '${order.id}', '${order.number}', '${order.token}', '${order.status}',
         '${esc(order.first)}', '${esc(order.last)}', '${esc(order.email)}', '${esc(order.phone)}',
         '${order.delivery}', '${order.method}', ${itemSubtotal}, 0,
         0, 0, ${grandTotal}, 'EUR',
         ${expiresAt}, ${placedAt}, ${placedAt}, ${placedAt}
       ) ON CONFLICT(id) DO NOTHING`);

  order.lines.forEach((line, index) => {
    sql(`INSERT INTO order_items (
           id, order_id, product_id, variant_id, product_name, variant_label, sku,
           quantity, unit_price, discount_amount, tax_amount, line_total, currency, created_at
         ) SELECT '${order.id}_item_${index}', '${order.id}', v.product_id, v.id,
                  '${esc(line.name)}', v.variant_label, '${esc(line.sku)}',
                  ${line.qty}, ${line.unit}, 0, 0, ${line.unit * line.qty}, 'EUR', ${placedAt}
             FROM product_variants v WHERE v.id = '${line.variant}'
           ON CONFLICT(id) DO NOTHING`);

    // The reservation, and the stock it holds. Both, or the inventory screen
    // shows a figure that does not match the orders beside it.
    sql(`INSERT INTO stock_reservations (
           id, order_id, variant_id, location_id, quantity, status, expires_at, created_at, updated_at
         ) VALUES (
           '${order.id}_res_${index}', '${order.id}', '${line.variant}', '${LOCATION}',
           ${line.qty}, 'active', ${expiresAt}, ${placedAt}, ${placedAt}
         ) ON CONFLICT(id) DO NOTHING`);

    sql(`UPDATE inventory_levels
            SET reserved = reserved + ${line.qty}, updated_at = ${placedAt}
          WHERE variant_id = '${line.variant}' AND location_id = '${LOCATION}'
            AND NOT EXISTS (
              SELECT 1 FROM stock_movements m WHERE m.id = '${order.id}_mv_${index}'
            )`);

    sql(`INSERT INTO stock_movements (
           id, variant_id, location_id, movement_type, quantity_delta,
           quantity_before, quantity_after, reference_type, reference_id, reason, created_at
         ) SELECT '${order.id}_mv_${index}', '${line.variant}', '${LOCATION}',
                  'pickup_reservation', 0, il.on_hand, il.on_hand,
                  'order', '${order.id}', 'reservation', ${placedAt}
             FROM inventory_levels il
            WHERE il.variant_id = '${line.variant}' AND il.location_id = '${LOCATION}'
           ON CONFLICT(id) DO NOTHING`);
  });

  sql(`INSERT INTO order_payments (
         id, order_id, payment_method_id, status, amount_expected, amount_received,
         transaction_reference, currency, created_at, updated_at
       ) VALUES (
         '${order.id}_pay', '${order.id}', '${order.method}', '${order.paymentStatus}',
         ${grandTotal}, NULL,
         ${order.reference ? `'${esc(order.reference)}'` : "NULL"},
         'EUR', ${placedAt}, ${placedAt}
       ) ON CONFLICT(id) DO NOTHING`);

  sql(`INSERT INTO order_status_history (id, order_id, from_status, to_status, actor, created_at)
       VALUES ('${order.id}_hist_0', '${order.id}', NULL, 'awaiting_customer_contact', 'customer', ${placedAt})
       ON CONFLICT(id) DO NOTHING`);

  if (order.status !== "awaiting_customer_contact") {
    sql(`INSERT INTO order_status_history (id, order_id, from_status, to_status, actor, created_at)
         VALUES ('${order.id}_hist_1', '${order.id}', 'awaiting_customer_contact', '${order.status}',
                 'staff', ${placedAt + HOUR})
         ON CONFLICT(id) DO NOTHING`);
  }

  sql(`INSERT INTO order_events (id, order_id, event_type, payload, customer_visible, created_at)
       VALUES ('${order.id}_ev_0', '${order.id}', 'order_placed',
               '{"orderNumber":"${order.number}"}', 1, ${placedAt})
       ON CONFLICT(id) DO NOTHING`);
}

/*
 * ── A product that is not ready ─────────────────────────────────────────────
 *
 * A draft with a variant and NO price.
 *
 * Every other demo product is complete, which meant three admin views —
 * "Bozze", "Senza prezzo", and the publication refusal on the product editor —
 * had nothing to show and could not be exercised at all. A fixture in which
 * everything is finished only tests the happy path, and the publication guard
 * is precisely the thing that must work: publishing a product with no price
 * puts a page on the live site that nobody can buy from.
 *
 * It is a realistic state, not a contrived one. Half-entered products are what
 * a catalogue looks like on any afternoon somebody is adding stock.
 */
sql(`INSERT INTO products (id, slug, brand_id, status, is_featured, created_at, updated_at)
     SELECT 'prod_demo_incomplete', 'demo-supporto-auto-magnetico', b.id, 'draft', 0, ${NOW}, ${NOW}
       FROM brands b WHERE b.slug = 'demo-generico'
     ON CONFLICT(id) DO NOTHING`);

sql(`INSERT INTO product_translations (id, product_id, locale, name, short_description)
     VALUES ('pt_demo_incomplete', 'prod_demo_incomplete', 'it',
             '[DEMO] Supporto auto magnetico', 'Bozza: prezzo e foto ancora da inserire.')
     ON CONFLICT(product_id, locale) DO NOTHING`);

sql(`INSERT INTO product_variants
       (id, product_id, sku, variant_label, is_default, active, sort_order, created_at, updated_at)
     VALUES ('var_demo_supporto', 'prod_demo_incomplete', 'DEMO-SUP-MAG-01', 'Nero',
             1, 1, 0, ${NOW}, ${NOW})
     ON CONFLICT(id) DO NOTHING`);

/*
 * Deliberately NO variant_prices row and NO inventory_levels row.
 *
 * Those absences are the fixture: "senza prezzo" and "non tracciato" are both
 * states the admin has to render honestly, and neither can be tested with a
 * catalogue where every product is finished.
 */

/*
 * `--print` writes the statements to stdout and applies nothing.
 *
 * The MariaDB browser suite needs the same catalogue in a MariaDB database,
 * and the only thing standing between here and there is that this script
 * speaks to `wrangler d1 execute`. Printing lets one caller
 * (scripts/hostinger/seed-mariadb.mjs) put the SAME statements through the
 * dialect translator instead — one definition of the demo catalogue, two
 * engines, rather than a second copy that drifts.
 */
if (args.includes("--print")) {
  process.stdout.write(statements.join(";\n"));
  process.exit(0);
}

console.log(
  `Seeding DEMO orders into ${DB}` +
    `${ENVIRONMENT ? ` (env ${ENVIRONMENT})` : ""} ${REMOTE ? "remote" : "local"} — ` +
    `${statements.length} statements`,
);

try {
  execFileSync(
    process.execPath,
    [
      "node_modules/wrangler/bin/wrangler.js",
      "d1",
      "execute",
      DB,
      REMOTE ? "--remote" : "--local",
      ...(ENVIRONMENT ? ["--env", ENVIRONMENT] : []),
      ...(PERSIST_TO ? ["--persist-to", PERSIST_TO] : []),
      "--command",
      statements.join(";\n"),
    ],
    { stdio: "inherit" },
  );
} catch (error) {
  console.error("\nDemo order seed FAILED.");
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}

console.log(`
Four DEMO orders seeded, each holding real stock.

NOT created, deliberately:
  - any paid order          (verification is a human act against a real bank)
  - any verified payment    (a seeded one would make the payments screen lie)
  - any payment proof file  (it is a photograph of somebody's bank transfer)

One order's reservation is already expired, so the sweeper and the
"Prenotazioni scadute" view have something real to act on.
`);
