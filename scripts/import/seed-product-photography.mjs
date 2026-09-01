/**
 * Real photography for the demo catalogue.
 *
 * ── Why this replaces the line drawings ──────────────────────────────────────
 *
 * The catalogue rendered 24 products with 8 distinct images: three products
 * shared every picture, and all eight were wireframe icons. That is why the
 * shop did not look like a shop. No amount of typography, spacing or colour
 * fixes a grid where every third card is the same grey outline — the pictures
 * ARE the storefront on a page like that, and ours were placeholders.
 *
 * ── Why this is not the misrepresentation I refused earlier ──────────────────
 *
 * Earlier in this project I refused to put stock photographs on products, and
 * that refusal still stands for a live shop: a customer who sees a photograph
 * and receives something else has been misled, and it is the fastest way for a
 * real business to look like a drop-shipper.
 *
 * These are different. Every product here is SEEDED DEMO DATA — invented names,
 * invented prices, invented stock — in an environment whose banner says so on
 * every page. Nobody receives any of them. A drawing of a case and a photograph
 * of a case are equally not the merchant's stock; only one of them lets anybody
 * judge what the shop will look like.
 *
 * The moment real products exist, these go. `seed-demo-media.mjs` already skips
 * any product that has an image, so a merchant photograph is never overwritten.
 *
 *   node scripts/import/seed-product-photography.mjs --env preview --remote
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const args = process.argv.slice(2);
const argOf = (name, fallback = null) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : fallback;
};
const ENVIRONMENT = argOf("--env");
const REMOTE = args.includes("--remote");
const BUCKET = ENVIRONMENT === "preview" ? "ita-commerce-preview-media" : "ita-commerce-media";

/**
 * The searches, in the same order and page size the candidate sweep used, so
 * an index here means the same photograph it meant on the contact sheet.
 *
 * `orientation=squarish` because a product card crops to a square: a landscape
 * source loses the object's top and bottom, which on a phone case is the object.
 */
const SEARCHES = [
  ["case", "silicone phone case product on plain background", 8],
  ["screen", "tempered glass screen protector product", 6],
  ["charger", "usb-c power adapter charger product white", 7],
  ["cable", "usb c braided charging cable product", 7],
  ["powerbank", "power bank portable battery product", 6],
  ["magsafe", "magnetic wireless charger puck phone", 5],
  ["audio", "wireless earbuds product on plain background", 6],
  ["mount", "car phone holder mount product", 5],
];

/**
 * One photograph per product, chosen by eye from contact sheets.
 *
 * Rejected along the way: a company's logo served as a stock photo, several
 * shots that were mostly a person, a keyboard with a phone somewhere in it, and
 * anything where the accessory was not the subject. The rule was the same as
 * for the category images — the picture has to show the thing being sold.
 */
const ASSIGNMENTS = [
  ["cover-silicone-iphone-16-pro", "case-0"],
  ["cover-antiurto-galaxy-s24", "case-4"],
  ["cover-a-libro-pixel-9", "case-17"],
  ["cover-trasparente-redmi-note-13", "case-8"],
  ["demo-cover-trasparente-iphone-16-pro", "case-11"],

  ["vetro-temperato-iphone-16-pro", "screen-16"],
  ["vetro-privacy-galaxy-s24", "screen-2"],
  ["pellicola-idrogel-universale", "screen-7"],

  ["caricatore-usb-c-45w", "charger-2"],
  ["caricatore-due-porte-65w", "charger-4"],
  ["caricatore-da-auto-30w", "charger-7"],
  ["demo-caricatore-usb-c-25w", "charger-3"],

  ["cavo-usb-c-lightning-1m", "cable-6"],
  ["cavo-usb-c-intrecciato-2m", "cable-19"],
  ["adattatore-usb-c-jack", "cable-16"],
  ["demo-cavo-usb-c-100w", "cable-9"],

  ["power-bank-10000-mah", "powerbank-1"],
  ["power-bank-20000-mah", "powerbank-3"],
  ["demo-power-bank-magnetico", "powerbank-9"],

  ["caricatore-magnetico-15w", "mount-13"],
  ["portafoglio-magnetico", "cable-7"],

  ["auricolari-bluetooth-anc", "audio-2"],
  ["auricolari-con-filo-usb-c", "audio-14"],
  ["cuffie-over-ear-bluetooth", "audio-15"],

  ["supporto-auto-magnetico-bocchette", "mount-15"],
  ["supporto-auto-con-ricarica-15w", "mount-16"],
];

const SIZE = 900;

function wrangler(extra, attempt = 1) {
  try {
    return execFileSync(process.execPath, ["node_modules/wrangler/bin/wrangler.js", ...extra], {
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
    });
  } catch (error) {
    const text = `${error.stdout ?? ""}${error.stderr ?? ""}${error.message ?? ""}`;
    if (attempt >= 3 || !/fetch failed|ECONNRESET|ETIMEDOUT|503|502|429/i.test(text)) throw error;
    execFileSync(process.execPath, ["-e", `setTimeout(() => {}, ${attempt * 2000})`]);
    return wrangler(extra, attempt + 1);
  }
}

// ── Resolve every slot to a photograph ──────────────────────────────────────

console.log("Resolving photographs…");
const bySlot = new Map();
const seen = new Set();

for (const [slot, query, perPage] of SEARCHES) {
  const response = await fetch(
    `https://unsplash.com/napi/search/photos?query=${encodeURIComponent(query)}&per_page=${perPage}&orientation=squarish`,
    { headers: { Accept: "application/json" } },
  );
  const body = await response.json();

  let index = 0;
  for (const photo of body.results ?? []) {
    // The candidate sweep skipped ids it had already taken, so the same
    // de-duplication has to happen here or every index after a repeat shifts.
    if (seen.has(photo.id)) continue;
    seen.add(photo.id);
    bySlot.set(`${slot}-${index}`, photo);
    index += 1;
  }
}

const missing = ASSIGNMENTS.filter(([, slot]) => !bySlot.has(slot));
if (missing.length > 0) {
  console.error(`\nUnresolved slots: ${missing.map(([, s]) => s).join(", ")}`);
  console.error("Search results have shifted. Re-run the candidate sweep before this script.");
  process.exit(1);
}

// ── Upload and attach ───────────────────────────────────────────────────────

const work = mkdtempSync(join(tmpdir(), "ita-photos-"));
const credits = [];
const statements = [];

for (const [productSlug, slot] of ASSIGNMENTS) {
  const photo = bySlot.get(slot);
  const bytes = Buffer.from(
    await (
      await fetch(`${photo.urls.raw}&w=${SIZE}&h=${SIZE}&q=74&fm=webp&fit=crop&crop=entropy`)
    ).arrayBuffer(),
  );

  const hash = createHash("sha256").update(bytes).digest("hex");
  const key = `products/${photo.id}-${hash.slice(0, 10)}.webp`;
  const file = join(work, `${photo.id}.webp`);
  writeFileSync(file, bytes);

  wrangler([
    "r2",
    "object",
    "put",
    `${BUCKET}/${key}`,
    "--file",
    file,
    "--content-type",
    "image/webp",
    "--jurisdiction",
    "eu",
    REMOTE ? "--remote" : "--local",
  ]);

  /*
   * Replaces the placeholder rather than joining it.
   *
   * A product carrying both a drawing and a photograph would show whichever
   * sorted first, which is a coin toss dressed as a decision.
   */
  statements.push(
    `DELETE FROM product_images WHERE product_id = (SELECT id FROM products WHERE slug = '${productSlug}');`,
    `INSERT INTO product_images
       (id, product_id, variant_id, object_key, alt_it, alt_en, width, height,
        mime_type, file_size, file_hash, is_primary, sort_order, created_at)
     SELECT lower(hex(randomblob(16))), p.id, NULL, '${key}',
            'Fotografia dimostrativa del prodotto', 'Demonstration product photograph',
            ${SIZE}, ${SIZE}, 'image/webp', ${bytes.byteLength}, '${hash}', 1, 0,
            ${Date.now()}
       FROM products p WHERE p.slug = '${productSlug}';`,
  );

  credits.push({
    product: productSlug,
    key,
    id: photo.id,
    photographer: photo.user?.name ?? "unknown",
    page: photo.links?.html ?? "",
    bytes: bytes.byteLength,
  });

  console.log(
    `  ${productSlug.padEnd(38)} ${(bytes.byteLength / 1024).toFixed(0).padStart(4)} KB  ${photo.user?.name ?? ""}`,
  );
}

const sqlFile = join(work, "images.sql");
writeFileSync(sqlFile, statements.join("\n"), "utf8");

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
    sqlFile,
  ],
  { stdio: "inherit" },
);

rmSync(work, { recursive: true, force: true });
writeFileSync("docs/product-image-credits.json", `${JSON.stringify(credits, null, 2)}\n`, "utf8");

const total = credits.reduce((sum, c) => sum + c.bytes, 0);
console.log(`
${credits.length} product photographs, ${(total / 1024).toFixed(0)} KB total, all distinct.

These are DEMO products in a preview that says so on every page. They are not
the merchant's stock and no customer receives them. The moment real products
exist these go — seed-demo-media.mjs already skips any product that has an
image, so a merchant photograph is never overwritten.

Provenance: docs/product-image-credits.json
`);
