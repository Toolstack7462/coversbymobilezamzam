/**
 * Demo catalogue for a PREVIEW environment.
 *
 * ── Everything here is fake, and says so ─────────────────────────────────────
 *
 * Every product name begins with `[DEMO]`. That prefix is not decoration: a
 * preview is a working copy of a real shop on a real HTTPS address, and anyone
 * sent the link — a supplier, an accountant, a friend — has no other way to
 * tell it apart from the live catalogue. A price they act on is a price that
 * was invented here.
 *
 * ── What this deliberately does NOT create ───────────────────────────────────
 *
 * No reviews or ratings: a rating is a claim about what real customers thought,
 * and inventing one is inventing an endorsement. No business identity, phone
 * number, email or bank detail — those stay empty so the storefront keeps
 * hiding the features that depend on them, which is exactly the behaviour worth
 * testing. No verified payment: `verified` means a human checked a real bank
 * account (invariant 6), and a seeded one would be a lie told to the one screen
 * whose entire job is to be trustworthy.
 *
 * ── Idempotent ───────────────────────────────────────────────────────────────
 *
 * Every statement is INSERT ... ON CONFLICT DO NOTHING against a fixed id, so
 * running it twice changes nothing. A seed that duplicates on a second run is a
 * seed nobody dares re-run.
 *
 *   node scripts/import/seed-demo.mjs --db DB --env preview --remote
 */
import { execFileSync } from "node:child_process";

const args = process.argv.slice(2);
const dbIndex = args.indexOf("--db");
const DB = dbIndex >= 0 ? args[dbIndex + 1] : "DB";
const envIndex = args.indexOf("--env");
const ENVIRONMENT = envIndex >= 0 ? args[envIndex + 1] : null;
const REMOTE = args.includes("--remote");

// A fixed instant, so re-running produces identical rows rather than a new
// timestamp that makes every record look freshly edited.
const NOW = 1_756_000_000_000;

const statements = [];
const sql = (text) => statements.push(text.trim());
const esc = (value) => String(value).replace(/'/g, "''");

// ── Device hierarchy ────────────────────────────────────────────────────────
// Two manufacturers, because a compatibility matrix with one brand cannot show
// the thing that matters: an accessory that fits one phone and not another.

const deviceBrands = [
  ["dbrand_demo_apple", "apple-demo", "Apple"],
  ["dbrand_demo_samsung", "samsung-demo", "Samsung"],
];

for (const [id, handle, name] of deviceBrands) {
  sql(`INSERT INTO device_brands (id, handle, name, sort_order, active, created_at, updated_at)
       VALUES ('${id}', '${handle}', '${esc(name)}', 0, 1, ${NOW}, ${NOW})
       ON CONFLICT(id) DO NOTHING`);
}

const deviceFamilies = [
  ["dfam_demo_iphone16", "dbrand_demo_apple", "iphone-16-demo", "iPhone 16", 2024],
  ["dfam_demo_iphone15", "dbrand_demo_apple", "iphone-15-demo", "iPhone 15", 2023],
  ["dfam_demo_galaxy_s24", "dbrand_demo_samsung", "galaxy-s24-demo", "Galaxy S24", 2024],
];

for (const [id, brand, handle, name, year] of deviceFamilies) {
  sql(`INSERT INTO device_families
         (id, device_brand_id, handle, name, release_year, sort_order, active, created_at, updated_at)
       VALUES ('${id}', '${brand}', '${handle}', '${esc(name)}', ${year}, 0, 1, ${NOW}, ${NOW})
       ON CONFLICT(id) DO NOTHING`);
}

const deviceModels = [
  [
    "dmodel_demo_16pro",
    "dbrand_demo_apple",
    "dfam_demo_iphone16",
    "iphone-16-pro-demo",
    "iPhone 16 Pro",
    2024,
    "USB-C",
  ],
  [
    "dmodel_demo_16promax",
    "dbrand_demo_apple",
    "dfam_demo_iphone16",
    "iphone-16-pro-max-demo",
    "iPhone 16 Pro Max",
    2024,
    "USB-C",
  ],
  [
    "dmodel_demo_15",
    "dbrand_demo_apple",
    "dfam_demo_iphone15",
    "iphone-15-demo-model",
    "iPhone 15",
    2023,
    "USB-C",
  ],
  [
    "dmodel_demo_s24",
    "dbrand_demo_samsung",
    "dfam_demo_galaxy_s24",
    "galaxy-s24-demo-model",
    "Galaxy S24",
    2024,
    "USB-C",
  ],
  [
    "dmodel_demo_s24ultra",
    "dbrand_demo_samsung",
    "dfam_demo_galaxy_s24",
    "galaxy-s24-ultra-demo",
    "Galaxy S24 Ultra",
    2024,
    "USB-C",
  ],
];

for (const [id, brand, family, handle, name, year, connector] of deviceModels) {
  sql(`INSERT INTO device_models
         (id, device_brand_id, device_family_id, handle, name, release_year, connector,
          is_popular, sort_order, active, created_at, updated_at)
       VALUES ('${id}', '${brand}', '${family}', '${handle}', '${esc(name)}', ${year},
               '${connector}', 0, 0, 1, ${NOW}, ${NOW})
       ON CONFLICT(id) DO NOTHING`);
}

// ── Shop's own taxonomy ─────────────────────────────────────────────────────

sql(`INSERT INTO brands (id, slug, name, sort_order, created_at, updated_at)
     VALUES ('brand_demo_generico', 'demo-generico', '[DEMO] Marchio generico', 0, ${NOW}, ${NOW})
     ON CONFLICT(id) DO NOTHING`);

const categories = [
  ["cat_demo_cover", "demo-cover", "[DEMO] Cover e custodie", "case"],
  ["cat_demo_cavi", "demo-cavi", "[DEMO] Cavi", "cable"],
  ["cat_demo_carica", "demo-caricabatterie", "[DEMO] Caricabatterie", "charger"],
  ["cat_demo_power", "demo-powerbank", "[DEMO] Power bank", "powerbank"],
];

for (const [id, slug, name, type] of categories) {
  sql(`INSERT INTO categories
         (id, slug, parent_id, path, depth, accessory_type, sort_order, visible, created_at, updated_at)
       VALUES ('${id}', '${slug}', NULL, '${slug}', 0, '${type}', 0, 1, ${NOW}, ${NOW})
       ON CONFLICT(id) DO NOTHING`);
  sql(`INSERT INTO category_translations (id, category_id, locale, name)
       VALUES ('ctr_${id}', '${id}', 'it', '${esc(name)}')
       ON CONFLICT(category_id, locale) DO NOTHING`);
}

/*
 * ── Products ────────────────────────────────────────────────────────────────
 *
 * Stock levels are chosen to exercise every availability state the storefront
 * can render, because "out of stock" and "two left" are different pages and
 * both need to be seen before launch:
 *
 *   healthy   comfortably above the reorder threshold
 *   low       at or below it, so the low-stock warning shows
 *   zero      unbuyable, so the sold-out path shows
 */
const products = [
  {
    id: "prod_demo_cover16pro",
    slug: "demo-cover-trasparente-iphone-16-pro",
    name: "[DEMO] Cover trasparente — iPhone 16 Pro",
    description: "Prodotto dimostrativo. Cover trasparente antiurto, bordi rialzati.",
    category: "cat_demo_cover",
    variants: [
      {
        id: "var_demo_cover16pro_clear",
        sku: "DEMO-COV-16P-CLR",
        label: "Trasparente",
        price: 1990,
        stock: 24,
        threshold: 5,
      },
      {
        id: "var_demo_cover16pro_black",
        sku: "DEMO-COV-16P-BLK",
        label: "Nero opaco",
        price: 1990,
        stock: 3,
        threshold: 5,
      },
      {
        id: "var_demo_cover16pro_blue",
        sku: "DEMO-COV-16P-BLU",
        label: "Blu",
        price: 2190,
        stock: 0,
        threshold: 5,
      },
    ],
    compatibility: [
      ["dmodel_demo_16pro", "exact_fit", 1],
      ["dmodel_demo_16promax", "incompatible", 0],
      ["dmodel_demo_15", "incompatible", 0],
    ],
  },
  {
    id: "prod_demo_carica25",
    slug: "demo-caricatore-usb-c-25w",
    name: "[DEMO] Caricatore USB-C 25W",
    description: "Prodotto dimostrativo. Alimentatore da rete con ricarica rapida.",
    category: "cat_demo_carica",
    variants: [
      {
        id: "var_demo_carica25_white",
        sku: "DEMO-CHG-25W-WHT",
        label: "Bianco",
        price: 1590,
        stock: 40,
        threshold: 8,
      },
    ],
    compatibility: [
      // Universal never becomes exact_fit, whatever else is recorded.
      ["dmodel_demo_16pro", "universal", 1],
      ["dmodel_demo_s24", "universal", 1],
    ],
  },
  {
    id: "prod_demo_cavo100",
    slug: "demo-cavo-usb-c-100w",
    name: "[DEMO] Cavo USB-C 100W — 1 m",
    description: "Prodotto dimostrativo. Cavo intrecciato per ricarica e dati.",
    category: "cat_demo_cavi",
    variants: [
      {
        id: "var_demo_cavo100_1m",
        sku: "DEMO-CAB-100W-1M",
        label: "1 metro",
        price: 1290,
        stock: 60,
        threshold: 10,
      },
      {
        id: "var_demo_cavo100_2m",
        sku: "DEMO-CAB-100W-2M",
        label: "2 metri",
        price: 1690,
        stock: 12,
        threshold: 10,
      },
    ],
    compatibility: [
      ["dmodel_demo_16pro", "compatible", 1],
      ["dmodel_demo_s24ultra", "compatible", 0],
      // The state a customer sees when nobody has checked yet.
      ["dmodel_demo_15", "unverified", 0],
    ],
  },
  {
    id: "prod_demo_powerbank",
    slug: "demo-power-bank-magnetico",
    name: "[DEMO] Power bank magnetico 5000 mAh",
    description: "Prodotto dimostrativo. Batteria magnetica per ricarica senza cavo.",
    category: "cat_demo_power",
    variants: [
      {
        id: "var_demo_powerbank_black",
        sku: "DEMO-PWR-5000-BLK",
        label: "Nero",
        price: 3490,
        stock: 7,
        threshold: 4,
      },
    ],
    compatibility: [
      ["dmodel_demo_16pro", "exact_fit", 1],
      // The case that needs saying out loud rather than being left unknown.
      ["dmodel_demo_s24", "adapter_required", 0],
      // Recorded but NOT verified: the storefront must show this differently
      // from a checked claim, and the setup centre must count it.
      ["dmodel_demo_16promax", "exact_fit", 0],
    ],
  },
];

for (const product of products) {
  sql(`INSERT INTO products
         (id, slug, status, brand_id, primary_category_id, published_at, created_at, updated_at)
       VALUES ('${product.id}', '${product.slug}', 'active', 'brand_demo_generico',
               '${product.category}', ${NOW}, ${NOW}, ${NOW})
       ON CONFLICT(id) DO NOTHING`);

  sql(`INSERT INTO product_translations (id, product_id, locale, name, short_description)
       VALUES ('ptr_${product.id}', '${product.id}', 'it', '${esc(product.name)}',
               '${esc(product.description)}')
       ON CONFLICT(product_id, locale) DO NOTHING`);

  product.variants.forEach((variant, index) => {
    sql(`INSERT INTO product_variants
           (id, product_id, sku, variant_label, is_default, active, sort_order, created_at, updated_at)
         VALUES ('${variant.id}', '${product.id}', '${variant.sku}', '${esc(variant.label)}',
                 ${index === 0 ? 1 : 0}, 1, ${index}, ${NOW}, ${NOW})
         ON CONFLICT(id) DO NOTHING`);

    sql(`INSERT INTO variant_prices
           (id, variant_id, price_list_id, amount, currency, created_at, updated_at)
         SELECT 'vp_${variant.id}', '${variant.id}', pl.id, ${variant.price}, 'EUR', ${NOW}, ${NOW}
           FROM price_lists pl WHERE pl.is_default = 1
         ON CONFLICT(id) DO NOTHING`);

    // An opening history row, so a first discount could be evidenced the same
    // way a real one would (D.Lgs. 84/2022).
    sql(`INSERT INTO price_history
           (id, variant_id, price_list_id, old_amount, new_amount, currency, channel,
            effective_from, reason, created_at)
         SELECT 'ph_${variant.id}', '${variant.id}', pl.id, NULL, ${variant.price}, 'EUR', 'online',
                ${NOW}, 'demo seed', ${NOW}
           FROM price_lists pl WHERE pl.is_default = 1
         ON CONFLICT(id) DO NOTHING`);

    sql(`INSERT INTO inventory_levels
           (id, variant_id, location_id, on_hand, reserved, reorder_threshold, created_at, updated_at)
         SELECT 'il_${variant.id}', '${variant.id}', loc.id, ${variant.stock}, 0,
                ${variant.threshold}, ${NOW}, ${NOW}
           FROM inventory_locations loc ORDER BY loc.created_at LIMIT 1
         ON CONFLICT(id) DO NOTHING`);
  });

  product.compatibility.forEach(([model, level, verified], index) => {
    sql(`INSERT INTO product_compatibility
           (id, product_id, variant_id, device_model_id, compatibility_level, verified,
            verification_source, verified_at, created_at, updated_at)
         VALUES ('pc_${product.id}_${index}', '${product.id}', NULL, '${model}', '${level}',
                 ${verified}, ${verified ? "'demo seed'" : "NULL"},
                 ${verified ? NOW : "NULL"}, ${NOW}, ${NOW})
         ON CONFLICT(id) DO NOTHING`);
  });
}

// ── Apply ───────────────────────────────────────────────────────────────────

console.log(
  `Seeding DEMO catalogue into ${DB}` +
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
      "--command",
      statements.join(";\n"),
    ],
    { stdio: "inherit" },
  );
} catch (error) {
  console.error("\nDemo seed FAILED.");
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}

console.log(`
Demo catalogue seeded. Every product name begins with [DEMO].

NOT created, deliberately:
  - reviews or ratings   (a rating is a claim about real customers)
  - business identity    (so the storefront keeps hiding what depends on it)
  - contact details      (so the WhatsApp button stays correctly absent)
  - bank or payment data (no payment method is enabled)
  - any verified payment (only a human checking a real account may do that)
`);
