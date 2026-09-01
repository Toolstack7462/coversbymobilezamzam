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
 * `width` is the delivered size: a hero is seen large, a category tile is
 * ~11rem tall and would waste bandwidth at hero resolution.
 */
const IMAGES = [
  {
    slot: "setting:media.hero_image",
    id: "YjDYlIK9BGA",
    width: 2000,
    note: "Green textured case on tan leather, side light. Warm, tactile, modern device.",
  },
  {
    slot: "setting:media.store_image",
    id: "WEer-k_jhE4",
    width: 2000,
    note: "Sulmona: the church steps, the confetti shop, the Abruzzo mountains. The actual town.",
  },
  {
    slot: "category:demo-cover",
    id: "QM4RRxp29rE",
    width: 1200,
    note: "Brown leather case on a wooden desk.",
  },
  {
    slot: "category:demo-cavi",
    id: "b5NYQOMOcYw",
    width: 1200,
    note: "Three white charging cables on light blue.",
  },
  {
    slot: "category:demo-caricabatterie",
    id: "G_GaeDNyMe8",
    width: 1200,
    note: "White power adapter on leather.",
  },
  {
    slot: "category:demo-powerbank",
    id: "XvSiM0xsFuE",
    width: 1200,
    note: "Blue power bank charging a phone, plain white ground.",
  },
];

function wrangler(extra) {
  return execFileSync(process.execPath, ["node_modules/wrangler/bin/wrangler.js", ...extra], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
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

  const url = `${meta.urls.raw}&w=${image.width}&q=78&fm=jpg&fit=crop`;
  const bytes = Buffer.from(await (await fetch(url)).arrayBuffer());
  const hash = createHash("sha256").update(bytes).digest("hex");
  const key = `lifestyle/${image.id}-${hash.slice(0, 10)}.jpg`;
  const file = join(work, `${image.id}.jpg`);
  writeFileSync(file, bytes);

  wrangler([
    "r2",
    "object",
    "put",
    `${BUCKET}/${key}`,
    "--file",
    file,
    "--content-type",
    "image/jpeg",
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
