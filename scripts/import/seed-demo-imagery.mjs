/**
 * Licensed lifestyle imagery for the preview.
 *
 * Fetches a chosen set of Unsplash photographs, uploads them to the R2 media
 * bucket, and points the media SLOTS at them — the same slots the merchant
 * edits in the admin. Nothing here is referenced from code, so replacing any of
 * these is a settings change rather than a deploy.
 *
 * ── What these are and are not ───────────────────────────────────────────────
 *
 * Atmosphere: a hero composition, category moods, and the town the shop is in.
 * They are NOT product photographs. No image here is presented as a specific
 * item for sale — a stock photograph standing in for the actual case a customer
 * receives is a misrepresentation they discover after paying, and the fastest
 * way for a real shop to look like a drop-shipper.
 *
 * The store image is the town of Sulmona itself, not a shop interior. A
 * photograph of somebody else's premises under "come and see us" would be a
 * false statement about a real business, however good it looked.
 *
 * Every photograph below was fetched, opened and looked at before selection.
 * The rejects included an iOS home screen carrying a dozen other companies'
 * trademarks, a phone displaying the YouTube logo, a menswear boutique, a
 * cracked screen (on a shop that sells protection), and a case photographed
 * beside a skull ornament.
 *
 * The four added for the newly-stocked categories were chosen the same way, and
 * their Unsplash ids were confirmed by hashing the bytes of the file that was
 * opened against a fresh fetch — a search position is not a stable identifier,
 * and recording the id of the photograph NEXT to the approved one is a mistake
 * nobody would ever notice from the code.
 *
 * ── Licence ──────────────────────────────────────────────────────────────────
 *
 * Unsplash License: free to use, commercial use permitted, no permission
 * needed. Attribution is not required and is recorded anyway in
 * docs/image-credits.md — provenance costs nothing to keep and is impossible to
 * reconstruct later.
 *
 *   node scripts/import/seed-demo-imagery.mjs --env preview --remote
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const args = process.argv.slice(2);
const argOf = (n, d = null) => (args.indexOf(n) >= 0 ? args[args.indexOf(n) + 1] : d);
const ENVIRONMENT = argOf("--env");
const REMOTE = args.includes("--remote");
const BUCKET = ENVIRONMENT === "preview" ? "ita-commerce-preview-media" : "ita-commerce-media";

/**
 * The selection.
 *
 * `width` is the delivered size, and it is chosen from the slot's ACTUAL
 * display size at 2x density — not from "big is safer".
 *
 * Format alone did almost nothing here: switching JPEG to WebP took the hero
 * from 386KB to 368KB, because Unsplash's JPEG encoder is already good. The
 * saving is in dimensions. The hero occupies half of a 1440px page, so it is
 * displayed around 720px wide and 1440 covers it at 2x; 2000 was shipping
 * pixels no screen resolves.
 *
 * `quality` drops for the store image because it sits behind text at 30%
 * opacity, where compression artefacts are invisible by construction.
 */
const IMAGES = [
  {
    slot: "setting:media.hero_image",
    id: "54VhxmlxJiI",
    /*
     * 2000px, against 1440 for the previous hero.
     *
     * The fold used to be a half-width image beside the headline; it is now
     * full-bleed, so the delivered image has to cover a 1440px viewport and
     * more on a wide monitor. This is the one place on the storefront where
     * dimensions are driven by the layout rather than trimmed to the slot.
     */
    width: 2000,
    quality: 74,
    note:
      "A phone in a case with a magnetic ring, held up against a coastal sunset. " +
      "Product in a hand rather than a product shot, no third-party marks, and a " +
      "composition with room on the left for the headline.",
  },
  {
    slot: "setting:media.store_image",
    id: "WEer-k_jhE4",
    width: 1600,
    quality: 62,
    note: "Sulmona: the church steps, the confetti shop, the Abruzzo mountains. The actual town.",
  },
  {
    slot: "category:cover",
    id: "QM4RRxp29rE",
    width: 800,
    quality: 76,
    note: "Brown leather case on a wooden desk.",
  },
  {
    slot: "category:cavi",
    id: "b5NYQOMOcYw",
    width: 800,
    quality: 76,
    note: "Three white charging cables on light blue.",
  },
  {
    slot: "category:caricatori",
    id: "G_GaeDNyMe8",
    width: 800,
    quality: 76,
    note: "White power adapter on leather.",
  },
  {
    slot: "category:power-bank",
    id: "XvSiM0xsFuE",
    width: 800,
    quality: 76,
    note: "Blue power bank charging a phone, plain white ground.",
  },
  {
    slot: "category:protezione-schermo",
    id: "J7xrBW_oYJc",
    width: 800,
    quality: 76,
    note: "A clean, unmarked screen face-up under low light. No cracked glass on a shop that sells protection.",
  },
  {
    slot: "category:magsafe",
    id: "nsL8k1BC6Do",
    width: 800,
    quality: 76,
    note: "A magnetic pack meeting the back of a phone, plain ground. The attach IS the category.",
  },
  {
    slot: "category:audio",
    id: "Y7dlslcl-hI",
    width: 800,
    quality: 76,
    note: "Earbuds and open case on black. No logo, no brand mark.",
  },
  {
    slot: "category:supporti-auto",
    id: "7x5V13744KM",
    width: 800,
    quality: 76,
    note: "Phone held in a vent mount, navigation running, road ahead. Shows the job, not the object.",
  },
];

/**
 * Run wrangler, retrying a TRANSIENT failure.
 *
 * This script makes around thirty network calls in a row — a fetch to Unsplash,
 * an R2 upload and a D1 update per image — and a single blip anywhere in the
 * middle kills it:
 *
 *     { "error": { "text": "fetch failed" } }
 *
 * which is what happened on the first real run. That is not a bug in the work,
 * it is the network, and the cost of it is a half-applied run: some images
 * uploaded and wired, others not, and no way to tell which from the outside.
 *
 * Retried three times with a widening pause. Only for failures that look like
 * transport — a genuine error (bad bucket, SQL mistake, expired credentials)
 * still fails immediately, because retrying those just delays the message that
 * says what is actually wrong.
 */
function wrangler(extra, attempt = 1) {
  try {
    return execFileSync(process.execPath, ["node_modules/wrangler/bin/wrangler.js", ...extra], {
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
    });
  } catch (error) {
    const text = `${error.stdout ?? ""}${error.stderr ?? ""}${error.message ?? ""}`;
    const transient =
      /fetch failed|ECONNRESET|ETIMEDOUT|EAI_AGAIN|socket hang up|503|502|429/i.test(text);
    if (!transient || attempt >= 3) throw error;
    const pause = attempt * 2000;
    console.log(`    transient failure, retrying in ${pause / 1000}s (attempt ${attempt + 1}/3)`);
    execFileSync(process.execPath, ["-e", `setTimeout(() => {}, ${pause})`]);
    return wrangler(extra, attempt + 1);
  }
}

const d1 = (sql) =>
  wrangler([
    "d1",
    "execute",
    "DB",
    ...(ENVIRONMENT ? ["--env", ENVIRONMENT] : []),
    REMOTE ? "--remote" : "--local",
    "--json",
    "--command",
    sql,
  ]);

const work = mkdtempSync(join(tmpdir(), "ita-imagery-"));
const credits = [];

for (const image of IMAGES) {
  // The photo endpoint gives the canonical download URL plus the attribution
  // this script records.
  const meta = await (
    await fetch(`https://unsplash.com/napi/photos/${image.id}`, {
      headers: { Accept: "application/json" },
    })
  ).json();

  /*
   * WebP, not JPEG.
   *
   * The hero is the LCP element on desktop and was shipping 386KB of JPEG.
   * Nothing negotiates format here — `/media/*` serves the key it is asked
   * for — so the format has to be decided at upload. WebP is accepted by the
   * media validator, supported by every browser that can run this app, and
   * roughly 40% smaller at the same visual quality.
   */
  const url = `${meta.urls.raw}&w=${image.width}&q=${image.quality}&fm=webp&fit=crop`;
  const bytes = Buffer.from(await (await fetch(url)).arrayBuffer());
  const hash = createHash("sha256").update(bytes).digest("hex");
  const key = `lifestyle/${image.id}-${hash.slice(0, 10)}.webp`;
  const file = join(work, `${image.id}.webp`);
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

  if (image.slot.startsWith("setting:")) {
    const settingKey = image.slot.slice("setting:".length);
    d1(
      `UPDATE store_settings SET value = '${key}', updated_at = ${Date.now()} WHERE key = '${settingKey}'`,
    );
  } else {
    const slug = image.slot.slice("category:".length);
    d1(`UPDATE categories SET image_key = '${key}' WHERE slug = '${slug}'`);
  }

  credits.push({
    slot: image.slot,
    key,
    id: image.id,
    photographer: meta.user?.name ?? "unknown",
    profile: meta.user?.links?.html ?? "",
    page: meta.links?.html ?? "",
    description: meta.alt_description ?? meta.description ?? "",
    note: image.note,
    bytes: bytes.byteLength,
  });

  console.log(
    `  ${image.slot.padEnd(32)} ${(bytes.byteLength / 1024).toFixed(0).padStart(4)} KB  ${credits.at(-1).photographer}`,
  );
}

rmSync(work, { recursive: true, force: true });
writeFileSync("docs/image-credits.json", `${JSON.stringify(credits, null, 2)}\n`, "utf8");

console.log(`
${credits.length} images uploaded and wired to their slots.
Provenance written to docs/image-credits.json.

These are ATMOSPHERE, not product photography. Replacing any of them is an
admin settings change — no image on this storefront is referenced from code.
`);
