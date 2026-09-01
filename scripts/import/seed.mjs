/**
 * Seeds the STRUCTURE a new installation needs: settings keys, roles,
 * permissions, an inventory location, a price list, and the payment methods.
 *
 * It seeds NO merchant information. Every setting is created EMPTY, and every
 * payment method is created DISABLED. The storefront then hides each dependent
 * feature until a human fills it in (invariant 12).
 *
 * The one exception is the shop's street address and coordinates, which this
 * project's brief states directly. Everything else — brand name, shop name,
 * legal name, P.IVA, phone, WhatsApp, email, opening hours — is unknown, and
 * inventing a plausible value would be worse than leaving it blank.
 *
 * Idempotent: safe to run repeatedly.
 */
import { execFileSync } from "node:child_process";

const args = process.argv.slice(2);
const dbIndex = args.indexOf("--db");
const DB = dbIndex >= 0 ? args[dbIndex + 1] : "ita-commerce";
const REMOTE = args.includes("--remote");

/**
 * An alternate local D1 directory, so a throwaway database — the browser-test
 * one — can be seeded without touching the developer's own local data.
 */
const persistIndex = args.indexOf("--persist-to");
const PERSIST_TO = persistIndex >= 0 ? args[persistIndex + 1] : null;

/**
 * The Wrangler environment whose configuration names the database.
 *
 * Needed because a database defined only inside `env.preview` is invisible to a
 * top-level lookup: Wrangler reports "Couldn't find a D1 DB with the name or
 * binding" and gives no hint that an environment was the missing part.
 */
const envIndex = args.indexOf("--env");
const ENVIRONMENT = envIndex >= 0 ? args[envIndex + 1] : null;

if (REMOTE && PERSIST_TO) {
  console.error("--persist-to is a local-only option; it cannot be combined with --remote.");
  process.exit(1);
}

const now = Date.now();
const statements = [];
const sql = (text) => statements.push(text);
const esc = (value) => String(value).replace(/'/g, "''");

// ── Settings ─────────────────────────────────────────────────────────────────

/** [key, category, gatesFeature, value] — value is "" unless genuinely known. */
const SETTINGS = [
  // Known from the brief. These are the ONLY non-empty values seeded.
  /*
   * Media slots.
   *
   * Each holds an R2 object key, or "" — and every one of them renders nothing
   * until it is filled, so the typographic design stands on its own until real
   * photography exists rather than showing a broken frame.
   *
   * They are ordinary settings on purpose: the admin settings screen reads and
   * writes every row in this table generically, so changing the hero image is a
   * field in an admin form, never a deploy.
   */
  ["media.hero_image", "media", 0, ""],
  ["media.store_image", "media", 0, ""],

  ["store.street", "store", 1, "Viale della Repubblica 8a, Centro Il Nuovo Borgo, negozio 6"],
  ["store.postcode", "store", 1, "67039"],
  ["store.city", "store", 1, "Sulmona"],
  ["store.province", "store", 0, "AQ"],
  ["store.country", "store", 0, "IT"],
  ["store.latitude", "store", 1, "42.0614846"],
  ["store.longitude", "store", 1, "13.9200965"],

  // Unknown. Deliberately empty — see the header comment.
  ["business.brand_name", "business", 1, ""],
  ["business.legal_name", "business", 1, ""],
  ["business.vat_number", "business", 1, ""],
  ["business.rea_number", "business", 1, ""],
  ["business.share_capital", "business", 0, ""],
  ["store.name", "store", 1, ""],
  ["store.hours_display", "store", 1, ""],
  ["store.hours_structured", "store", 1, ""],
  ["store.directions_url", "store", 0, ""],
  ["store.parking_info", "store", 0, ""],
  ["store.accessibility_info", "store", 0, ""],
  ["contact.phone", "contact", 1, ""],
  ["contact.email", "contact", 1, ""],
  ["contact.whatsapp_number", "contact", 1, ""],
  ["contact.return_address", "contact", 1, ""],
  ["pickup.enabled", "fulfilment", 1, "false"],
  ["pickup.preparation_time", "fulfilment", 1, ""],
  ["pickup.instructions", "fulfilment", 0, ""],
  ["shipping.enabled", "fulfilment", 1, "false"],
  ["shipping.free_threshold", "fulfilment", 1, ""],
  ["tax.vat_basis_points", "tax", 0, "2200"],
];

for (const [key, category, gates, value] of SETTINGS) {
  sql(`INSERT INTO store_settings (id, key, value, value_type, category, gates_feature, is_sensitive, created_at, updated_at)
       VALUES ('set_${key.replace(/\W/g, "_")}', '${esc(key)}', '${esc(value)}', 'string', '${category}', ${gates}, 0, ${now}, ${now})
       ON CONFLICT(key) DO NOTHING`);
}

// ── Permissions and roles ────────────────────────────────────────────────────

const PERMISSIONS = [
  "product.read",
  "product.write",
  "product.archive",
  "price.read",
  "price.write",
  "price.cost.read",
  "inventory.read",
  "inventory.adjust",
  "inventory.transfer",
  "order.read",
  "order.write",
  "order.cancel",
  "order.refund",
  "payment.read",
  "payment.verify",
  "payment.settings",
  "content.read",
  "content.write",
  "content.publish",
  "customer.read",
  "customer.write",
  "staff.read",
  "staff.write",
  "staff.roles",
  "settings.read",
  "settings.write",
  "audit.read",
  "import.run",
  "export.run",
];

for (const code of PERMISSIONS) {
  sql(`INSERT INTO permissions (id, code, description, category)
       VALUES ('perm_${code.replace(/\W/g, "_")}', '${code}', '${code}', '${code.split(".")[0]}')
       ON CONFLICT(code) DO NOTHING`);
}

/**
 * Default roles. Two separations are deliberate and must survive any edit:
 * nobody but super_admin holds both payment.verify and payment.settings, and
 * order managers cannot verify payments.
 */
const ROLES = [
  ["super_admin", "Amministratore", "Super admin", PERMISSIONS],
  [
    "catalogue_manager",
    "Responsabile catalogo",
    "Catalogue manager",
    [
      "product.read",
      "product.write",
      "product.archive",
      "price.read",
      "inventory.read",
      "content.read",
      "content.write",
      "import.run",
      "export.run",
    ],
  ],
  [
    "price_manager",
    "Responsabile prezzi",
    "Price manager",
    ["product.read", "price.read", "price.write", "price.cost.read", "export.run"],
  ],
  [
    "inventory_manager",
    "Responsabile magazzino",
    "Inventory manager",
    [
      "product.read",
      "inventory.read",
      "inventory.adjust",
      "inventory.transfer",
      "order.read",
      "import.run",
      "export.run",
    ],
  ],
  [
    "order_manager",
    "Responsabile ordini",
    "Order manager",
    [
      "product.read",
      "inventory.read",
      "order.read",
      "order.write",
      "order.cancel",
      "order.refund",
      "payment.read",
      "customer.read",
      "customer.write",
      "export.run",
    ],
  ],
  [
    "payment_verifier",
    "Verifica pagamenti",
    "Payment verifier",
    ["order.read", "payment.read", "payment.verify", "customer.read"],
  ],
  [
    "store_staff",
    "Personale negozio",
    "Store staff",
    ["product.read", "inventory.read", "order.read", "order.write", "customer.read"],
  ],
];

ROLES.forEach(([code, nameIt, nameEn, perms], index) => {
  sql(`INSERT INTO roles (id, code, name_it, name_en, is_system, sort_order, created_at, updated_at)
       VALUES ('role_${code}', '${code}', '${esc(nameIt)}', '${esc(nameEn)}', 1, ${index}, ${now}, ${now})
       ON CONFLICT(code) DO NOTHING`);
  for (const perm of perms) {
    const permId = `perm_${perm.replace(/\W/g, "_")}`;
    sql(`INSERT INTO role_permissions (id, role_id, permission_id)
         VALUES ('rp_${code}_${perm.replace(/\W/g, "_")}', 'role_${code}', '${permId}')
         ON CONFLICT(role_id, permission_id) DO NOTHING`);
  }
});

// ── Location and price list ──────────────────────────────────────────────────

// ONE shared location by default. Two independent counters over one shelf means
// selling the same case twice.
sql(`INSERT INTO inventory_locations (id, code, name, location_type, sellable_online, sellable_in_store, active, sort_order, created_at, updated_at)
     VALUES ('loc_shop', 'shop', 'Negozio Sulmona', 'shop', 1, 1, 1, 0, ${now}, ${now})
     ON CONFLICT(code) DO NOTHING`);

sql(`INSERT INTO price_lists (id, code, name, channel, is_default, active, created_at, updated_at)
     VALUES ('pl_online', 'online', 'Prezzi online', 'online', 1, 1, ${now}, ${now})
     ON CONFLICT(code) DO NOTHING`);

sql(`INSERT INTO price_lists (id, code, name, channel, is_default, active, created_at, updated_at)
     VALUES ('pl_store', 'in_store', 'Prezzi negozio', 'in_store', 0, 1, ${now}, ${now})
     ON CONFLICT(code) DO NOTHING`);

// ── Payment methods: ALL DISABLED ────────────────────────────────────────────

const METHODS = [
  ["bank_transfer", "bank_transfer", "Bonifico bancario", "Bank transfer", 1440],
  ["instant_transfer", "instant_bank_transfer", "Bonifico istantaneo", "Instant transfer", 120],
  ["satispay", "satispay", "Satispay", "Satispay", 120],
  ["bancomat_pay", "bancomat_pay", "BANCOMAT Pay", "BANCOMAT Pay", 120],
  ["pay_at_pickup", "pay_at_pickup", "Pagamento al ritiro", "Pay at pickup", 1440],
];

METHODS.forEach(([code, type, nameIt, nameEn, minutes], index) => {
  // active = 0, always. A method is advertised only once its merchant data
  // exists; a half-configured one sends money to the wrong place.
  sql(`INSERT INTO payment_methods (id, code, method_type, name_it, name_en, active, sort_order,
        reservation_minutes, eligible_for_shipping, eligible_for_pickup, created_at, updated_at)
       VALUES ('pm_${code}', '${code}', '${type}', '${esc(nameIt)}', '${esc(nameEn)}', 0, ${index},
        ${minutes}, ${type === "pay_at_pickup" ? 0 : 1}, 1, ${now}, ${now})
       ON CONFLICT(code) DO NOTHING`);
});

// ── Apply ────────────────────────────────────────────────────────────────────

console.log(
  `Seeding ${DB} (${REMOTE ? "remote" : "local"}${ENVIRONMENT ? `, env ${ENVIRONMENT}` : ""}` +
    `${PERSIST_TO ? ` in ${PERSIST_TO}` : ""}) — ` +
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
  console.error("\nSeed FAILED.");
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}

console.log(`
Seeded structure only. NO merchant information was invented.

  - Every setting except the shop address is EMPTY.
  - Every payment method is DISABLED.
  - Pickup and shipping are OFF.

The storefront hides each dependent feature until a human fills it in.
See docs/launch-checklist.md for what the merchant still has to supply.
`);
