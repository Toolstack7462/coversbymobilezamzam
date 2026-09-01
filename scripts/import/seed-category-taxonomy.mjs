/**
 * Aligns the catalogue's categories with the navigation, and gives each one an
 * editorial introduction.
 *
 * ── The bug this fixes ───────────────────────────────────────────────────────
 *
 * The header rail listed eight categories with hardcoded slugs — `cover`,
 * `protezione-schermo`, `caricatori` and so on — while the catalogue held four,
 * slugged `demo-cover`, `demo-cavi`, `demo-caricabatterie`, `demo-powerbank`.
 * Nothing matched. **Every category link in the primary navigation led to a
 * page with zero products**, and the newly built footer inherited the same
 * eight broken links.
 *
 * The slugs are aligned here, and the four missing categories are created, so
 * the taxonomy is one thing that exists in one place. The header and footer are
 * then driven from the database rather than a constant, which is what makes it
 * impossible for this to drift again.
 *
 * ── About the empty ones ─────────────────────────────────────────────────────
 *
 * Four of the eight have no products yet. They render a proper category page
 * with a name, an introduction and an honest "0 products" — which is a shop
 * that has not stocked a line yet, and reads as one. Before, the same click
 * produced the generic catalogue with a silently ignored filter, which reads as
 * broken software.
 *
 *   node scripts/import/seed-category-taxonomy.mjs --env preview --remote
 */
import { execFileSync } from "node:child_process";

const args = process.argv.slice(2);
const ENVIRONMENT = args.indexOf("--env") >= 0 ? args[args.indexOf("--env") + 1] : null;
const REMOTE = args.includes("--remote");

/**
 * The canonical taxonomy. Slugs are Italian because the URL is part of the
 * interface and the audience is Italian.
 *
 * The introductions are the shop's own voice: what the category is FOR, in one
 * sentence, without adjectives that could belong to any shop.
 */
const CATEGORIES = [
  {
    slug: "cover",
    from: "demo-cover",
    it: [
      "Cover e custodie",
      "Protezione pensata per il tuo modello esatto, non per una misura generica.",
    ],
    en: ["Cases", "Protection made for your exact model, not for a generic size."],
  },
  {
    slug: "protezione-schermo",
    it: [
      "Protezione schermo",
      "Pellicole e vetri temperati. Tagliati su misura e applicati in negozio, se preferisci.",
    ],
    en: [
      "Screen protection",
      "Films and tempered glass. Cut to measure and fitted in store, if you prefer.",
    ],
  },
  {
    slug: "caricatori",
    from: "demo-caricabatterie",
    it: [
      "Caricatori",
      "Ricarica alla potenza giusta per il tuo telefono, senza rovinarne la batteria.",
    ],
    en: ["Chargers", "Charge at the right wattage for your phone, without damaging the battery."],
  },
  {
    slug: "cavi",
    from: "demo-cavi",
    it: [
      "Cavi",
      "USB-C, Lightning e adattatori. La lunghezza e la potenza indicate su ogni prodotto.",
    ],
    en: ["Cables", "USB-C, Lightning and adapters. Length and wattage stated on every product."],
  },
  {
    slug: "power-bank",
    from: "demo-powerbank",
    it: ["Power bank", "Autonomia in tasca, per la giornata fuori o per il viaggio."],
    en: ["Power banks", "Power in your pocket, for a day out or a journey."],
  },
  {
    slug: "magsafe",
    it: ["MagSafe e magnetici", "Si attacca, si stacca, si ricarica. Senza cavi da cercare."],
    en: ["MagSafe and magnetic", "Attach, detach, charge. No cable to hunt for."],
  },
  {
    slug: "audio",
    it: ["Audio", "Auricolari e cuffie, con l'attacco giusto per il tuo telefono."],
    en: ["Audio", "Earphones and headphones, with the right connector for your phone."],
  },
  {
    slug: "supporti-auto",
    it: ["Supporti auto", "Il telefono dove serve guardarlo, fermo anche sul pavé."],
    en: ["Car mounts", "Your phone where you need to see it, steady even on cobbles."],
  },
];

const esc = (v) => String(v).replace(/'/g, "''");
const now = Date.now();

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

console.log("Aligning the category taxonomy…\n");

CATEGORIES.forEach((c, index) => {
  const id = `cat_${c.slug.replace(/-/g, "_")}`;

  if (c.from) {
    // Rename in place, so the products already attached stay attached.
    d1(
      `UPDATE categories SET slug = '${c.slug}', path = '${c.slug}', sort_order = ${index},
                             updated_at = ${now}
        WHERE slug = '${c.from}'`,
    );
    console.log(`  ${c.from.padEnd(22)} -> ${c.slug}`);
  } else {
    d1(
      `INSERT INTO categories (id, slug, parent_id, path, depth, sort_order, visible, created_at, updated_at)
       VALUES ('${id}', '${c.slug}', NULL, '${c.slug}', 0, ${index}, 1, ${now}, ${now})
       ON CONFLICT(slug) DO UPDATE SET sort_order = excluded.sort_order, updated_at = ${now}`,
    );
    console.log(`  ${"(new)".padEnd(22)} -> ${c.slug}`);
  }

  // Translations, keyed off whichever row now owns the slug.
  for (const [locale, [name, description]] of [
    ["it", c.it],
    ["en", c.en],
  ]) {
    d1(
      `INSERT INTO category_translations (id, category_id, locale, name, description)
       SELECT '${id}_${locale}', cat.id, '${locale}', '${esc(name)}', '${esc(description)}'
         FROM categories cat WHERE cat.slug = '${c.slug}'
       ON CONFLICT(category_id, locale)
       DO UPDATE SET name = excluded.name, description = excluded.description`,
    );
  }
});

console.log(`
${CATEGORIES.length} categories aligned with the navigation.

Four of them hold no products yet. They now render a real category page with a
name, an introduction and an honest count, instead of the generic catalogue with
a filter that matched nothing.
`);
