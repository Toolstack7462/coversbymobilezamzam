/**
 * Give the demo catalogue its placeholder artwork, through the real pipeline.
 *
 * Rasterises the line illustrations to PNG, uploads them to the R2 media
 * bucket, and writes `product_images` rows pointing at them — the same path a
 * merchant's own photograph takes. Nothing is faked into the database: width,
 * height, byte size, MIME type and SHA-256 are read from the file that was
 * actually uploaded.
 *
 * That matters beyond appearances. Until this ran, R2 delivery and the
 * `/media/*` route had never served a single byte in the deployed preview, so
 * "images work" was an assumption. Now it is either visibly true or visibly not.
 *
 * SVG is rasterised rather than uploaded because `app/domain/media/image.ts`
 * refuses SVG on purpose — an SVG is a document that can carry script, and a
 * media bucket that accepts one is an XSS vector served from your own origin.
 *
 *   node scripts/import/seed-demo-media.mjs --env preview --remote
 */
import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { chromium } from "playwright";

import { ARTWORK, svgFor } from "./demo-artwork.mjs";

const args = process.argv.slice(2);
const argOf = (name, fallback = null) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : fallback;
};

const ENVIRONMENT = argOf("--env");
const REMOTE = args.includes("--remote");
const SIZE = 1000;

/** Which illustration belongs to which demo product. */
const ASSIGNMENTS = [
  ["prod_demo_cover16pro", "case"],
  ["prod_demo_carica25", "charger"],
  ["prod_demo_cavo100", "cable"],
  ["prod_demo_powerbank", "powerbank"],
];

const BUCKET = ENVIRONMENT === "preview" ? "ita-commerce-preview-media" : "ita-commerce-media";

function wrangler(extra, { json = false } = {}) {
  const out = execFileSync(process.execPath, ["node_modules/wrangler/bin/wrangler.js", ...extra], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  return json ? (JSON.parse(out.slice(out.indexOf("[")))[0]?.results ?? []) : out;
}

const d1 = (sql) =>
  wrangler(
    [
      "d1",
      "execute",
      "DB",
      ...(ENVIRONMENT ? ["--env", ENVIRONMENT] : []),
      REMOTE ? "--remote" : "--local",
      "--json",
      "--command",
      sql,
    ],
    { json: true },
  );

// ── 1. Rasterise ────────────────────────────────────────────────────────────

const work = mkdtempSync(join(tmpdir(), "ita-artwork-"));
console.log(`Rasterising ${ASSIGNMENTS.length} illustrations at ${SIZE}×${SIZE}…`);

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: SIZE, height: SIZE } });
const files = [];

for (const [productId, artKey] of ASSIGNMENTS) {
  const svg = svgFor(artKey, { size: SIZE });
  const svgPath = join(work, `${artKey}.svg`);
  writeFileSync(svgPath, svg, "utf8");

  // file:// so nothing is fetched over the network, and the SVG never touches
  // a server.
  // pathToFileURL rather than string surgery: a Windows path is not a URL,
  // and hand-escaping backslashes is how this line broke the first time.
  await page.goto(pathToFileURL(svgPath).href);
  const pngPath = join(work, `${artKey}.png`);
  await page.screenshot({ path: pngPath, omitBackground: false });

  const bytes = readFileSync(pngPath);
  files.push({
    productId,
    artKey,
    pngPath,
    size: bytes.byteLength,
    // Content-addressed: the same artwork uploaded twice keeps one key.
    hash: createHash("sha256").update(bytes).digest("hex"),
  });
  console.log(`  ${artKey.padEnd(11)} ${(bytes.byteLength / 1024).toFixed(1)} KB`);
}

await browser.close();

// ── 2. Upload ───────────────────────────────────────────────────────────────

console.log(`\nUploading to R2 bucket ${BUCKET}…`);

for (const file of files) {
  file.key = `demo/${file.artKey}-${file.hash.slice(0, 12)}.png`;
  wrangler([
    "r2",
    "object",
    "put",
    `${BUCKET}/${file.key}`,
    "--file",
    file.pngPath,
    "--content-type",
    "image/png",
    "--jurisdiction",
    "eu",
    REMOTE ? "--remote" : "--local",
  ]);
  console.log(`  ${file.key}`);
}

// ── 3. Record them ──────────────────────────────────────────────────────────

console.log("\nWriting product_images rows…");

for (const file of files) {
  const art = ARTWORK[file.artKey];
  // Idempotent: re-running replaces the row rather than adding a second
  // primary image to the same product.
  d1(`DELETE FROM product_images WHERE product_id = '${file.productId}'`);
  d1(
    `INSERT INTO product_images
       (id, product_id, variant_id, object_key, alt_it, alt_en,
        width, height, mime_type, file_size, file_hash, is_primary, sort_order, created_at)
     VALUES
       ('img_${randomUUID().replace(/-/g, "").slice(0, 20)}', '${file.productId}', NULL,
        '${file.key}', '${art.it.replace(/'/g, "''")}', '${art.en.replace(/'/g, "''")}',
        ${SIZE}, ${SIZE}, 'image/png', ${file.size}, '${file.hash}', 1, 0, ${Date.now()})`,
  );
  console.log(`  ${file.productId} → ${file.key}`);
}

rmSync(work, { recursive: true, force: true });

const count = d1("SELECT COUNT(*) AS n FROM product_images")[0]?.n;
console.log(`
Done. ${count} product image(s) recorded.

These are PLACEHOLDER ILLUSTRATIONS, and the alt text says so in both languages.
Replace them with the merchant's own photographs before the shop is shown to a
customer as anything other than a preview.
`);
