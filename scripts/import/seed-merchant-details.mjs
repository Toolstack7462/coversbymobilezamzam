/**
 * The merchant's real shop details, copied from their own Shopify theme.
 *
 * ── Why this exists ──────────────────────────────────────────────────────────
 *
 * Every one of these values was already configured by the merchant in
 * `config/settings_data.json` of their Shopify theme, and every one was empty
 * here. The storefront was not sparse because of design — the trust band showed
 * one of three items, the footer three columns, the product page's reassurance
 * one line, all because the gates behind them were correctly rendering nothing.
 *
 * Filling these changes more of the page than any amount of CSS.
 *
 * ── The name ─────────────────────────────────────────────────────────────────
 *
 * `store.name` is set to "Covers by Mobile", which is the value the merchant
 * configured in `store_name` and the name used in their own store-page copy:
 * "Covers by Mobile è il nostro negozio all'interno del Centro Commerciale Il
 * Nuovo Borgo a Sulmona."
 *
 * It is NOT "Covers by Mobile Zam Zam" — that string appears in the two GitHub
 * repository names and in no configured field in either project. If the trading
 * name does include it, this is one setting to change and nothing else.
 *
 * It is emphatically not "Italian Tech Atelier", which is this project's
 * internal name and which the storefront had been showing to customers.
 *
 *   node scripts/import/seed-merchant-details.mjs --env preview --remote
 */
import { execFileSync } from "node:child_process";

const args = process.argv.slice(2);
const ENVIRONMENT = args.indexOf("--env") >= 0 ? args[args.indexOf("--env") + 1] : null;
const REMOTE = args.includes("--remote");

/**
 * Source: config/settings_data.json in Toolstack7462/coversbymobiile.
 * Nothing here is invented; each value is quoted from that file.
 */
const DETAILS = [
  ["store.name", "Covers by Mobile"],
  ["store.hours_display", "Tutti i giorni 09:00–20:00"],
  ["store.hours_structured", "Mo-Su 09:00-20:00"],
  [
    "store.directions_url",
    "https://www.google.com/maps/dir/?api=1&destination=42.0614846%2C13.9200965",
  ],
  ["contact.phone", "+39 350 881 6173"],
  ["contact.whatsapp_number", "393508816173"],
  ["contact.email", "afridinaseer068@gmail.com"],
];

const d1 = (sql) =>
  execFileSync(
    process.execPath,
    [
      "node_modules/wrangler/bin/wrangler.js",
      "d1",
      "execute",
      "DB",
      ...(ENVIRONMENT ? ["--env", ENVIRONMENT] : []),
      REMOTE ? "--remote" : "--local",
      "--json",
      "--command",
      sql,
    ],
    { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 },
  );

console.log("Applying the merchant's configured details…\n");

for (const [key, value] of DETAILS) {
  // Escaped for SQL by doubling quotes; none of these contain one, but the
  // next value somebody adds might.
  const escaped = value.replace(/'/g, "''");
  d1(
    `UPDATE store_settings SET value = '${escaped}', updated_at = ${Date.now()} WHERE key = '${key}'`,
  );
  console.log(`  ${key.padEnd(28)} ${value}`);
}

console.log(`
Done. Sections gated on these will now render:

  - the trust band gains "collect in store" and "help in Italian";
  - the footer gains contact, hours and directions;
  - the product page's reassurance gains two of its three lines;
  - the store band takes the shop's real name instead of the city.

NOTE: contact.email is a personal Gmail address. It is the merchant's own
configured business address and is already public on their Shopify storefront,
so copying it changes nothing about its exposure — but a gmail.com address as
the contact for a shop asking for card details is a weaker trust signal than a
domain address, and is worth raising with them.
`);
