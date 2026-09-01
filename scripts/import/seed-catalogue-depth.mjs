/**
 * Stock for every category, and phones for every brand the finder offers.
 *
 * ── What this fixes ──────────────────────────────────────────────────────────
 *
 * The catalogue held four products, one per category, and four of the eight
 * categories had none at all. The device finder listed eight brands, and six of
 * them had zero models behind them — the same dead-entry-point defect as the
 * category navigation, one screen along: an entry point that promises a shop
 * that can help and delivers an empty page.
 *
 * ── What is real here and what is not ────────────────────────────────────────
 *
 * The DEVICE MODELS are real phones. They are facts about the world, not claims
 * about this business, so recording them is safe and makes the compatibility
 * system — the shop's whole differentiator — mean something.
 *
 * The PRODUCTS, prices and stock levels are invented for the preview, which is
 * exactly what the preview banner on every page says. They are not presented as
 * a real inventory, and no merchant claim is attached to any of them.
 *
 * Stock levels are chosen to exercise every availability state the storefront
 * can render, because "disponibile", "ultimi pezzi" and "esaurito" are three
 * different pages and all three need to be seen before launch.
 *
 * Compatibility follows the resolver's own rules: a case is exact_fit for the
 * model it was moulded for and incompatible with the rest; a cable or charger
 * is universal and NEVER upgrades to exact_fit; a few rows are deliberately
 * left unverified, because "nobody has checked this yet" is a state the
 * storefront must be able to show honestly.
 *
 *   node scripts/import/seed-catalogue-depth.mjs --env preview --remote
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const args = process.argv.slice(2);
const ENVIRONMENT = args.indexOf("--env") >= 0 ? args[args.indexOf("--env") + 1] : null;
const REMOTE = args.includes("--remote");

const NOW = Date.now();
const esc = (v) => String(v).replace(/'/g, "''");

// ── Devices ─────────────────────────────────────────────────────────────────

/**
 * Real phones, grouped by brand. Brands that do not exist yet are created.
 *
 * `apple-demo` and `samsung-demo` already have families and models under those
 * handles; these ADD to them rather than replacing them, so nothing already
 * linked to a product loses its link. The handles look odd and are left alone
 * deliberately — renaming them would break every compatibility row that points
 * at their models, to fix nothing a customer can see.
 */
const DEVICES = [
  {
    brand: "apple-demo",
    brandName: "Apple",
    families: [
      { handle: "iphone-16", name: "iPhone 16", models: [["iphone-16", "iPhone 16"]] },
      {
        handle: "iphone-14",
        name: "iPhone 14",
        models: [
          ["iphone-14", "iPhone 14"],
          ["iphone-14-pro", "iPhone 14 Pro"],
        ],
      },
    ],
  },
  {
    brand: "samsung-demo",
    brandName: "Samsung",
    families: [
      {
        handle: "galaxy-a",
        name: "Galaxy A",
        models: [
          ["galaxy-a55", "Galaxy A55"],
          ["galaxy-a35", "Galaxy A35"],
        ],
      },
    ],
  },
  {
    brand: "xiaomi",
    brandName: "Xiaomi",
    families: [
      {
        handle: "redmi-note",
        name: "Redmi Note",
        models: [
          ["redmi-note-13", "Redmi Note 13"],
          ["redmi-note-13-pro", "Redmi Note 13 Pro"],
        ],
      },
      { handle: "xiaomi-14", name: "Xiaomi 14", models: [["xiaomi-14", "Xiaomi 14"]] },
    ],
  },
  {
    brand: "google",
    brandName: "Google",
    families: [
      {
        handle: "pixel",
        name: "Pixel",
        models: [
          ["pixel-8", "Pixel 8"],
          ["pixel-8-pro", "Pixel 8 Pro"],
          ["pixel-9", "Pixel 9"],
        ],
      },
    ],
  },
  {
    brand: "oppo",
    brandName: "OPPO",
    families: [
      {
        handle: "reno",
        name: "Reno",
        models: [
          ["oppo-reno-11", "Reno 11"],
          ["oppo-reno-12", "Reno 12"],
        ],
      },
    ],
  },
  {
    brand: "oneplus",
    brandName: "OnePlus",
    families: [
      {
        handle: "oneplus-flagship",
        name: "OnePlus",
        models: [
          ["oneplus-12", "OnePlus 12"],
          ["oneplus-nord-4", "Nord 4"],
        ],
      },
    ],
  },
  {
    brand: "huawei",
    brandName: "Huawei",
    families: [
      {
        handle: "huawei-nova",
        name: "Nova",
        models: [["huawei-nova-12", "Nova 12"]],
      },
    ],
  },
  {
    brand: "motorola",
    brandName: "Motorola",
    families: [
      {
        handle: "moto-g",
        name: "Moto G",
        models: [
          ["moto-g54", "Moto G54"],
          ["moto-g84", "Moto G84"],
        ],
      },
      {
        handle: "moto-edge",
        name: "Edge",
        models: [["moto-edge-50", "Edge 50"]],
      },
    ],
  },
  {
    brand: "honor",
    brandName: "Honor",
    families: [
      {
        handle: "honor-magic",
        name: "Magic",
        models: [["honor-magic-6-lite", "Magic 6 Lite"]],
      },
      {
        handle: "honor-x",
        name: "Honor X",
        models: [
          ["honor-x8b", "X8b"],
          ["honor-x7b", "X7b"],
        ],
      },
    ],
  },
  {
    brand: "realme",
    brandName: "realme",
    families: [
      {
        handle: "realme-number",
        name: "realme",
        models: [
          ["realme-12-pro", "12 Pro"],
          ["realme-11", "11"],
        ],
      },
    ],
  },
  {
    brand: "nothing",
    brandName: "Nothing",
    families: [
      {
        handle: "nothing-phone",
        name: "Phone",
        models: [
          ["nothing-phone-2a", "Phone (2a)"],
          ["nothing-phone-2", "Phone (2)"],
        ],
      },
    ],
  },
  {
    brand: "sony",
    brandName: "Sony",
    families: [
      {
        handle: "xperia",
        name: "Xperia",
        models: [
          ["xperia-1-vi", "Xperia 1 VI"],
          ["xperia-10-vi", "Xperia 10 VI"],
        ],
      },
    ],
  },
  {
    brand: "vivo",
    brandName: "vivo",
    families: [
      {
        handle: "vivo-y",
        name: "vivo Y",
        models: [["vivo-y36", "Y36"]],
      },
    ],
  },
  {
    brand: "asus",
    brandName: "ASUS",
    families: [
      {
        handle: "zenfone",
        name: "Zenfone",
        models: [["zenfone-11-ultra", "Zenfone 11 Ultra"]],
      },
    ],
  },
  {
    brand: "tcl",
    brandName: "TCL",
    families: [
      {
        handle: "tcl-40",
        name: "TCL 40",
        models: [["tcl-40-se", "40 SE"]],
      },
    ],
  },
];

/**
 * Release year and charging connector for every model above.
 *
 * Both are real facts about the phone, and the connector is the one that earns
 * its place: it is why the Lightning cable in this catalogue is `incompatible`
 * with an iPhone 16 Pro and `compatible` with an iPhone 14. Without it that
 * distinction would be a hardcoded opinion.
 *
 * Every model must appear here. A missing entry throws rather than defaulting
 * to USB-C — a wrong connector silently recommends the wrong cable, which is
 * precisely the mistake this shop exists to prevent.
 */
const MODEL_FACTS = {
  "iphone-16": [2024, "USB-C"],
  "iphone-14": [2022, "Lightning"],
  "iphone-14-pro": [2022, "Lightning"],
  "galaxy-a55": [2024, "USB-C"],
  "galaxy-a35": [2024, "USB-C"],
  "redmi-note-13": [2024, "USB-C"],
  "redmi-note-13-pro": [2024, "USB-C"],
  "xiaomi-14": [2024, "USB-C"],
  "pixel-8": [2023, "USB-C"],
  "pixel-8-pro": [2023, "USB-C"],
  "pixel-9": [2024, "USB-C"],
  "oppo-reno-11": [2024, "USB-C"],
  "oppo-reno-12": [2024, "USB-C"],
  "oneplus-12": [2024, "USB-C"],
  "oneplus-nord-4": [2024, "USB-C"],
  "huawei-nova-12": [2024, "USB-C"],
  "moto-g54": [2023, "USB-C"],
  "moto-g84": [2023, "USB-C"],
  "moto-edge-50": [2024, "USB-C"],
  "honor-magic-6-lite": [2024, "USB-C"],
  "honor-x8b": [2024, "USB-C"],
  "honor-x7b": [2023, "USB-C"],
  "realme-12-pro": [2024, "USB-C"],
  "realme-11": [2023, "USB-C"],
  "nothing-phone-2a": [2024, "USB-C"],
  "nothing-phone-2": [2023, "USB-C"],
  "xperia-1-vi": [2024, "USB-C"],
  "xperia-10-vi": [2024, "USB-C"],
  "vivo-y36": [2023, "USB-C"],
  "zenfone-11-ultra": [2024, "USB-C"],
  "tcl-40-se": [2023, "USB-C"],
};

// ── Categories ──────────────────────────────────────────────────────────────

/**
 * The accessory type each category holds.
 *
 * Four of these were created without one, which the product detail page uses to
 * decide which specification block to render. A product in a category with no
 * accessory type renders no specifications at all — silently.
 */
const CATEGORY_TYPES = {
  cover: "case",
  "protezione-schermo": "screen_protector",
  caricatori: "charger",
  cavi: "cable",
  "power-bank": "powerbank",
  magsafe: "magsafe",
  audio: "audio",
  "supporti-auto": "car_mount",
};

// ── Products ────────────────────────────────────────────────────────────────

const products = [
  // ── Cover ─────────────────────────────────────────────────────────────────
  {
    slug: "cover-silicone-iphone-16-pro",
    category: "cover",
    name: "Cover in silicone — iPhone 16 Pro",
    description: "Silicone morbido con interno in microfibra. Bordi rialzati su schermo e camere.",
    variants: [
      ["Nero", "COV-SIL-16P-BLK", 2490, 18, 5],
      ["Blu notte", "COV-SIL-16P-BLU", 2490, 4, 5],
      ["Sabbia", "COV-SIL-16P-SND", 2490, 0, 5],
    ],
    compatibility: [
      ["dmodel_demo_16pro", "exact_fit", 1],
      ["dmodel_demo_16promax", "incompatible", 1],
    ],
  },
  {
    slug: "cover-antiurto-galaxy-s24",
    category: "cover",
    name: "Cover antiurto — Galaxy S24",
    description: "Doppio strato, angoli rinforzati. Testata per cadute da un metro e mezzo.",
    variants: [
      ["Nero", "COV-RUG-S24-BLK", 2990, 11, 4],
      ["Trasparente", "COV-RUG-S24-CLR", 2990, 6, 4],
    ],
    compatibility: [
      ["dmodel_demo_s24", "exact_fit", 1],
      ["dmodel_demo_s24ultra", "incompatible", 1],
    ],
  },
  {
    slug: "cover-a-libro-pixel-9",
    category: "cover",
    name: "Cover a libro — Pixel 9",
    description: "Chiusura magnetica, tasca per una carta. Si apre a leggio per guardare video.",
    variants: [["Marrone", "COV-BOK-PX9-BRN", 3290, 9, 3]],
    compatibility: [["dmodel_pixel_9", "exact_fit", 1]],
  },
  {
    slug: "cover-trasparente-redmi-note-13",
    category: "cover",
    name: "Cover trasparente — Redmi Note 13",
    description: "Policarbonato rigido trattato contro l'ingiallimento. Resta trasparente.",
    variants: [["Trasparente", "COV-CLR-RN13", 1490, 22, 6]],
    compatibility: [["dmodel_redmi_note_13", "exact_fit", 1]],
  },

  // ── Protezione schermo ────────────────────────────────────────────────────
  {
    slug: "vetro-temperato-iphone-16-pro",
    category: "protezione-schermo",
    name: "Vetro temperato — iPhone 16 Pro",
    description: "Durezza 9H, bordi neri, applicatore incluso. Montaggio gratuito in negozio.",
    variants: [
      ["Singolo", "SCR-GLS-16P-1", 1290, 35, 8],
      ["Confezione da due", "SCR-GLS-16P-2", 1990, 14, 8],
    ],
    compatibility: [
      ["dmodel_demo_16pro", "exact_fit", 1],
      // Same family, different cut-outs. Saying so is the point of the system.
      ["dmodel_demo_16promax", "incompatible", 1],
    ],
  },
  {
    slug: "vetro-privacy-galaxy-s24",
    category: "protezione-schermo",
    name: "Vetro privacy — Galaxy S24",
    description:
      "Filtro a 28 gradi: lo schermo è leggibile solo di fronte. Compatibile con la cover.",
    variants: [["Singolo", "SCR-PRV-S24", 1990, 8, 4]],
    compatibility: [["dmodel_demo_s24", "exact_fit", 1]],
  },
  {
    slug: "pellicola-idrogel-universale",
    category: "protezione-schermo",
    name: "Pellicola in idrogel — tagliata su misura",
    description: "Tagliata al momento sul tuo modello. Copre anche i bordi curvi.",
    variants: [["Su misura", "SCR-HYD-CUT", 990, 120, 20]],
    compatibility: [
      ["dmodel_demo_16pro", "universal", 1],
      ["dmodel_demo_s24ultra", "universal", 1],
      ["dmodel_pixel_9", "universal", 1],
    ],
  },

  // ── Caricatori ────────────────────────────────────────────────────────────
  {
    slug: "caricatore-usb-c-45w",
    category: "caricatori",
    name: "Caricatore USB-C 45W",
    description: "Power Delivery. Ricarica un telefono alla massima velocità o un tablet.",
    variants: [
      ["Bianco", "CHG-45W-WHT", 2490, 26, 6],
      ["Nero", "CHG-45W-BLK", 2490, 3, 6],
    ],
    compatibility: [
      ["dmodel_demo_16pro", "universal", 1],
      ["dmodel_demo_s24", "universal", 1],
      ["dmodel_pixel_9", "universal", 1],
    ],
  },
  {
    slug: "caricatore-due-porte-65w",
    category: "caricatori",
    name: "Caricatore da tavolo 65W — due porte",
    description: "Due USB-C. A porte piene divide la potenza; da sola una porta arriva a 65W.",
    variants: [["Bianco", "CHG-65W-2C", 3990, 12, 4]],
    compatibility: [
      ["dmodel_demo_16pro", "universal", 1],
      ["dmodel_oneplus_12", "universal", 1],
    ],
  },
  {
    slug: "caricatore-da-auto-30w",
    category: "caricatori",
    name: "Caricatore da auto 30W",
    description: "Presa accendisigari, USB-C e USB-A. Ricarica due telefoni insieme.",
    variants: [["Nero", "CHG-CAR-30W", 1790, 17, 5]],
    compatibility: [
      ["dmodel_demo_16pro", "universal", 1],
      ["dmodel_moto_g54", "universal", 0],
    ],
  },

  // ── Cavi ──────────────────────────────────────────────────────────────────
  {
    slug: "cavo-usb-c-lightning-1m",
    category: "cavi",
    name: "Cavo USB-C a Lightning — 1 m",
    description: "Certificato MFi. Per iPhone fino alla serie 14.",
    variants: [["1 metro", "CAB-CL-1M", 1690, 19, 6]],
    compatibility: [
      ["dmodel_demo_15", "compatible", 1],
      ["dmodel_iphone_14", "compatible", 1],
      // USB-C phone, Lightning cable. The mismatch is the useful answer.
      ["dmodel_demo_16pro", "incompatible", 1],
    ],
  },
  {
    slug: "cavo-usb-c-intrecciato-2m",
    category: "cavi",
    name: "Cavo USB-C intrecciato — 2 m",
    description: "240W e dati a 480 Mbit/s. Guaina in nylon, connettori in alluminio.",
    variants: [
      ["2 metri — nero", "CAB-CC-2M-BLK", 1890, 31, 8],
      ["2 metri — grigio", "CAB-CC-2M-GRY", 1890, 5, 8],
    ],
    compatibility: [
      ["dmodel_demo_16pro", "universal", 1],
      ["dmodel_demo_s24", "universal", 1],
      ["dmodel_pixel_8", "universal", 0],
    ],
  },
  {
    slug: "adattatore-usb-c-jack",
    category: "cavi",
    name: "Adattatore USB-C a jack 3,5 mm",
    description: "Con DAC integrato. Per usare le cuffie con filo su un telefono senza jack.",
    variants: [["Bianco", "CAB-ADP-JACK", 1290, 0, 5]],
    compatibility: [
      ["dmodel_demo_16pro", "adapter_required", 1],
      ["dmodel_demo_s24", "adapter_required", 1],
    ],
  },

  // ── Power bank ────────────────────────────────────────────────────────────
  {
    slug: "power-bank-10000-mah",
    category: "power-bank",
    name: "Power bank 10.000 mAh — 22,5W",
    description: "Due ricariche complete per la maggior parte dei telefoni. Display di carica.",
    variants: [
      ["Nero", "PWR-10K-BLK", 2990, 15, 5],
      ["Bianco", "PWR-10K-WHT", 2990, 2, 5],
    ],
    compatibility: [
      ["dmodel_demo_16pro", "universal", 1],
      ["dmodel_demo_s24", "universal", 1],
    ],
  },
  {
    slug: "power-bank-20000-mah",
    category: "power-bank",
    name: "Power bank 20.000 mAh — 65W",
    description: "Ricarica anche un portatile. Ammesso in cabina: sotto i 100 Wh.",
    variants: [["Grigio", "PWR-20K-GRY", 5490, 6, 3]],
    compatibility: [
      ["dmodel_demo_16pro", "universal", 1],
      ["dmodel_oneplus_12", "universal", 0],
    ],
  },

  // ── MagSafe ───────────────────────────────────────────────────────────────
  {
    slug: "caricatore-magnetico-15w",
    category: "magsafe",
    name: "Caricatore magnetico 15W",
    description: "Si aggancia da solo e ricarica senza cavo. Cavo da un metro incluso.",
    variants: [["Bianco", "MAG-CHG-15W", 3490, 13, 4]],
    compatibility: [
      ["dmodel_demo_16pro", "exact_fit", 1],
      ["dmodel_demo_16promax", "exact_fit", 1],
      // Android with no magnets: it works with a ring, and we say which.
      ["dmodel_demo_s24", "adapter_required", 1],
    ],
  },
  {
    slug: "portafoglio-magnetico",
    category: "magsafe",
    name: "Portafoglio magnetico",
    description: "Tiene tre carte. Si stacca per pagare senza togliere la cover.",
    variants: [
      ["Nero", "MAG-WAL-BLK", 2290, 10, 4],
      ["Cuoio", "MAG-WAL-TAN", 2290, 0, 4],
    ],
    compatibility: [
      ["dmodel_demo_16pro", "exact_fit", 1],
      ["dmodel_demo_15", "exact_fit", 0],
    ],
  },

  // ── Audio ─────────────────────────────────────────────────────────────────
  {
    slug: "auricolari-bluetooth-anc",
    category: "audio",
    name: "Auricolari Bluetooth con cancellazione del rumore",
    description: "Sei ore per carica, ventiquattro con la custodia. Tre misure di gommini.",
    variants: [
      ["Nero", "AUD-TWS-ANC-BLK", 5990, 8, 3],
      ["Bianco", "AUD-TWS-ANC-WHT", 5990, 4, 3],
    ],
    compatibility: [
      ["dmodel_demo_16pro", "universal", 1],
      ["dmodel_demo_s24", "universal", 1],
    ],
  },
  {
    slug: "auricolari-con-filo-usb-c",
    category: "audio",
    name: "Auricolari con filo USB-C",
    description: "Nessuna batteria da ricaricare, nessun abbinamento. Microfono sul cavo.",
    variants: [["Bianco", "AUD-WIR-USBC", 1490, 28, 8]],
    compatibility: [
      ["dmodel_demo_16pro", "compatible", 1],
      ["dmodel_demo_s24", "compatible", 1],
      ["dmodel_demo_15", "incompatible", 1],
    ],
  },
  {
    slug: "cuffie-over-ear-bluetooth",
    category: "audio",
    name: "Cuffie over-ear Bluetooth",
    description:
      "Trenta ore di autonomia. Si piegano, e funzionano anche col cavo se la batteria finisce.",
    variants: [["Grigio", "AUD-OVR-GRY", 7990, 5, 2]],
    compatibility: [["dmodel_demo_16pro", "universal", 1]],
  },

  // ── Supporti auto ─────────────────────────────────────────────────────────
  {
    slug: "supporto-auto-magnetico-bocchette",
    category: "supporti-auto",
    name: "Supporto auto magnetico da bocchetta",
    description:
      "Si attacca alla bocchetta dell'aria. Placca adesiva inclusa per telefoni senza magneti.",
    variants: [["Nero", "MNT-MAG-VENT", 1990, 21, 6]],
    compatibility: [
      ["dmodel_demo_16pro", "exact_fit", 1],
      ["dmodel_demo_s24", "adapter_required", 1],
    ],
  },
  {
    slug: "supporto-auto-con-ricarica-15w",
    category: "supporti-auto",
    name: "Supporto auto con ricarica 15W",
    description:
      "Bracci a chiusura automatica e ricarica senza fili. Alimentatore da auto incluso.",
    variants: [["Nero", "MNT-CHG-15W", 3990, 7, 3]],
    compatibility: [
      ["dmodel_demo_16pro", "universal", 1],
      ["dmodel_demo_s24ultra", "universal", 0],
    ],
  },
];

// ── Build ───────────────────────────────────────────────────────────────────

const sql = [];
const modelId = (handle) => `dmodel_${handle.replace(/-/g, "_")}`;

DEVICES.forEach((brand, brandIndex) => {
  /*
   * The brand row, if it is not already there.
   *
   * `sort_order` is the position in this list, so the finder's brand rail is
   * ordered by how likely a customer in Sulmona is to be holding one rather
   * than alphabetically — which would put ASUS above Apple.
   */
  sql.push(
    `INSERT INTO device_brands (id, handle, name, sort_order, active, created_at, updated_at)
     VALUES ('dbrand_${brand.brand.replace(/-/g, "_")}', '${brand.brand}', '${esc(brand.brandName)}',
             ${brandIndex}, 1, ${NOW}, ${NOW})
     ON CONFLICT(handle) DO NOTHING;`,
  );

  for (const family of brand.families) {
    const familyId = `dfam_${family.handle.replace(/-/g, "_")}`;
    sql.push(
      `INSERT INTO device_families (id, device_brand_id, handle, name, sort_order, active, created_at, updated_at)
       SELECT '${familyId}', b.id, '${family.handle}', '${esc(family.name)}', 0, 1, ${NOW}, ${NOW}
         FROM device_brands b WHERE b.handle = '${brand.brand}'
       ON CONFLICT(handle) DO NOTHING;`,
    );
    family.models.forEach(([handle, name], index) => {
      const facts = MODEL_FACTS[handle];
      if (!facts) throw new Error(`No release year or connector recorded for "${handle}".`);
      const [year, connector] = facts;

      // The brand id is taken from the brand row rather than assumed, so this
      // works whether the brand was created a moment ago or years ago under a
      // handle that no longer matches its id.
      sql.push(
        `INSERT INTO device_models
           (id, device_brand_id, device_family_id, handle, name, release_year, connector,
            is_popular, sort_order, active, created_at, updated_at)
         SELECT '${modelId(handle)}', b.id, '${familyId}', '${handle}', '${esc(name)}',
                ${year}, '${connector}', 0, ${index}, 1, ${NOW}, ${NOW}
           FROM device_brands b WHERE b.handle = '${brand.brand}'
         ON CONFLICT(handle) DO NOTHING;`,
      );
    });
  }
});

for (const [slug, type] of Object.entries(CATEGORY_TYPES)) {
  sql.push(
    `UPDATE categories SET accessory_type = '${type}', updated_at = ${NOW} WHERE slug = '${slug}';`,
  );
}

for (const product of products) {
  const id = `prod_${product.slug.replace(/-/g, "_")}`;

  sql.push(
    `INSERT INTO products
       (id, slug, status, brand_id, primary_category_id, accessory_type, published_at, created_at, updated_at)
     SELECT '${id}', '${product.slug}', 'active', 'brand_demo_generico', c.id, c.accessory_type,
            ${NOW}, ${NOW}, ${NOW}
       FROM categories c WHERE c.slug = '${product.category}'
     ON CONFLICT(id) DO NOTHING;`,
  );

  sql.push(
    `INSERT INTO product_translations (id, product_id, locale, name, short_description)
     VALUES ('ptr_${id}', '${id}', 'it', '${esc(product.name)}', '${esc(product.description)}')
     ON CONFLICT(product_id, locale) DO NOTHING;`,
  );

  product.variants.forEach(([label, sku, price, stock, threshold], index) => {
    const vid = `var_${sku.toLowerCase().replace(/-/g, "_")}`;
    sql.push(
      `INSERT INTO product_variants
         (id, product_id, sku, variant_label, is_default, active, sort_order, created_at, updated_at)
       VALUES ('${vid}', '${id}', '${sku}', '${esc(label)}', ${index === 0 ? 1 : 0}, 1, ${index}, ${NOW}, ${NOW})
       ON CONFLICT(id) DO NOTHING;`,
      `INSERT INTO variant_prices (id, variant_id, price_list_id, amount, currency, created_at, updated_at)
       SELECT 'vp_${vid}', '${vid}', pl.id, ${price}, 'EUR', ${NOW}, ${NOW}
         FROM price_lists pl WHERE pl.is_default = 1
       ON CONFLICT(id) DO NOTHING;`,
      // An opening history row, so a later discount can be evidenced the way
      // D.Lgs. 84/2022 requires rather than retrofitted.
      `INSERT INTO price_history
         (id, variant_id, price_list_id, old_amount, new_amount, currency, channel, effective_from, reason, created_at)
       SELECT 'ph_${vid}', '${vid}', pl.id, NULL, ${price}, 'EUR', 'online', ${NOW}, 'catalogue seed', ${NOW}
         FROM price_lists pl WHERE pl.is_default = 1
       ON CONFLICT(id) DO NOTHING;`,
      `INSERT INTO inventory_levels
         (id, variant_id, location_id, on_hand, reserved, reorder_threshold, created_at, updated_at)
       SELECT 'il_${vid}', '${vid}', loc.id, ${stock}, 0, ${threshold}, ${NOW}, ${NOW}
         FROM inventory_locations loc ORDER BY loc.created_at LIMIT 1
       ON CONFLICT(id) DO NOTHING;`,
    );
  });

  product.compatibility.forEach(([model, level, verified], index) => {
    // A row is written only if the model exists, so a typo in a model id
    // silently drops one claim instead of failing the whole import.
    sql.push(
      `INSERT INTO product_compatibility
         (id, product_id, variant_id, device_model_id, compatibility_level, verified,
          verification_source, verified_at, created_at, updated_at)
       SELECT 'pc_${id}_${index}', '${id}', NULL, m.id, '${level}', ${verified},
              ${verified ? "'catalogue seed'" : "NULL"}, ${verified ? NOW : "NULL"}, ${NOW}, ${NOW}
         FROM device_models m WHERE m.id = '${model}'
       ON CONFLICT(id) DO NOTHING;`,
    );
  });
}

const work = mkdtempSync(join(tmpdir(), "ita-catalogue-"));
const file = join(work, "catalogue.sql");
writeFileSync(file, sql.join("\n"), "utf8");

execFileSync(
  process.execPath,
  [
    "node_modules/wrangler/bin/wrangler.js",
    "d1",
    "execute",
    "DB",
    ...(ENVIRONMENT ? ["--env", ENVIRONMENT] : []),
    REMOTE ? "--remote" : "--local",
    "--file",
    file,
  ],
  { stdio: "inherit" },
);

rmSync(work, { recursive: true, force: true });

const models = DEVICES.reduce((n, b) => n + b.families.reduce((m, f) => m + f.models.length, 0), 0);
const variants = products.reduce((n, p) => n + p.variants.length, 0);

console.log(`
${products.length} products (${variants} variants) across ${new Set(products.map((p) => p.category)).size} categories.
${DEVICES.length} brands and ${models} models, so every brand in the finder leads somewhere.

Prices and stock are invented for the preview, which is what the banner on
every page says. The device models are real phones — facts about the world,
not claims about this business.

Next: node scripts/import/seed-demo-media.mjs --env ${ENVIRONMENT ?? "…"} --remote
`);
