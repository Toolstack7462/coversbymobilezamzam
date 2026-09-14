/**
 * Moves the product photographs from Cloudflare R2 onto Hostinger's filesystem.
 *
 *   npm run hostinger:media -- --from .local/d1-export
 *
 * ── WHAT IT MIGRATES, AND WHY NOT "EVERYTHING IN THE BUCKET" ────────────────
 *
 * The keys come from the DATABASE — `product_images.object_key`,
 * `categories.image_key` and the `media.*` settings — not from a bucket
 * listing. Two reasons, and the second is the one that matters:
 *
 *   - An object with no row is an orphan. Copying it would move a file nobody
 *     can reach onto a plan where disk is the merchant's to pay for.
 *   - A row with no object is a BROKEN IMAGE on the storefront, and that is
 *     worth knowing about. Driving from the database means every one of those
 *     is reported rather than silently skipped.
 *
 * ── THE PRIVATE BUCKET IS NOT TOUCHED ───────────────────────────────────────
 *
 * `ita-commerce-private` holds payment proofs. There are none — the shop is
 * pre-transactional — and if there were, they would need a separate, deliberate
 * migration with its own verification that they are unreachable anonymously.
 * Copying them as a side effect of moving product photographs is exactly the
 * kind of thing that puts a customer's bank transfer screenshot on a public
 * path.
 *
 * ── VERIFICATION ────────────────────────────────────────────────────────────
 *
 * Every file is checked by SIZE after upload, and the script reports what it
 * could not find rather than exiting 0 over a half-migrated catalogue.
 */

import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { withSsh } from "./lib/ssh.mjs";

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};

const FROM = flag("from", ".local/d1-export");
const BUCKET = flag("bucket", "ita-commerce-preview-media");
const ENVIRONMENT = flag("env", "preview");
const LOCAL = flag("cache", ".local/media");

/**
 * The preview buckets live in the EU jurisdiction, and the CLI must be told.
 *
 * Without it every download fails with "The specified key does not exist" — a
 * message about the KEY, for a problem with the BUCKET. `wrangler r2 bucket
 * list` does not show them either: it lists the default jurisdiction only, so
 * the buckets appear not to exist at all.
 *
 * The objects were there the whole time; the Worker serves them today. Worth
 * the flag being explicit rather than a default, because "eu" is a deliberate
 * data-residency choice for an Italian shop and not a detail to lose.
 */
const JURISDICTION = flag("jurisdiction", "eu");
const REMOTE_ROOT = flag(
  "remote-root",
  `/home/${process.env.HOSTINGER_SSH_USER ?? ""}/zamzam-storage/public`,
);

/** Reads one exported table, or an empty list if it was not exported. */
function ndjson(file) {
  const full = path.join(FROM, file);
  if (!fs.existsSync(full)) return [];
  return fs
    .readFileSync(full, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

const keys = new Set();

/**
 * The content type each object should be served with, from the DATABASE.
 *
 * `product_images.mime_type` is what the upload path sniffed from the file's
 * own magic bytes when the merchant added it, so it is a recorded fact rather
 * than a guess from a file extension. Where there is no row — a category tile,
 * a lifestyle image — the extension is the only thing available and is used,
 * with a comment saying so.
 */
const declaredType = new Map();

for (const row of ndjson("product_images.ndjson")) {
  if (!row.object_key) continue;
  keys.add(row.object_key);
  if (row.mime_type) declaredType.set(row.object_key, row.mime_type);
}
for (const row of ndjson("categories.ndjson")) if (row.image_key) keys.add(row.image_key);
for (const row of ndjson("store_settings.ndjson")) {
  if (String(row.key).startsWith("media.") && row.value) keys.add(row.value);
}

if (keys.size === 0) {
  console.error(`No media keys found in ${FROM}. Run the D1 export first.`);
  process.exit(1);
}

/**
 * Only the three formats the upload path accepts.
 *
 * Not a general extension-to-MIME table: this store holds images this
 * application put there, and a key with any other extension is something that
 * should be looked at rather than served.
 */
const BY_EXTENSION = {
  ".webp": "image/webp",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
};

function contentTypeFor(key) {
  const declared = declaredType.get(key);
  if (declared) return declared;
  const guess = BY_EXTENSION[path.extname(key).toLowerCase()];
  if (guess) return guess;
  return null;
}

console.log(`Media migration — ${keys.size} objects referenced by the database\n`);

fs.mkdirSync(LOCAL, { recursive: true });

// ── 1. Down from R2 ──────────────────────────────────────────────────────────
const downloaded = [];
const missing = [];

for (const key of [...keys].sort()) {
  const target = path.join(LOCAL, key);
  fs.mkdirSync(path.dirname(target), { recursive: true });

  if (fs.existsSync(target) && fs.statSync(target).size > 0) {
    downloaded.push({ key, bytes: fs.statSync(target).size, cached: true });
    continue;
  }

  try {
    /*
     * `--pipe` is deliberately not used: wrangler writes progress to stdout as
     * well, and a photograph with a progress bar prepended is a corrupt
     * photograph that still has the right extension.
     */
    execFileSync(
      "npx",
      [
        "wrangler",
        "r2",
        "object",
        "get",
        `${BUCKET}/${key}`,
        "--env",
        ENVIRONMENT,
        "--file",
        target,
        "--remote",
        "--jurisdiction",
        JURISDICTION,
      ],
      { stdio: "pipe", shell: true },
    );
    const bytes = fs.existsSync(target) ? fs.statSync(target).size : 0;
    if (bytes === 0) {
      missing.push(key);
      fs.rmSync(target, { force: true });
    } else {
      downloaded.push({ key, bytes, cached: false });
    }
  } catch {
    missing.push(key);
    fs.rmSync(target, { force: true });
  }

  process.stdout.write(`  ${downloaded.length + missing.length}/${keys.size}\r`);
}

const total = downloaded.reduce((sum, d) => sum + d.bytes, 0);
console.log(
  `  downloaded ${downloaded.length}/${keys.size}` +
    ` (${(total / 1024 / 1024).toFixed(2)} MB)` +
    `${missing.length > 0 ? `, ${missing.length} MISSING` : ""}`,
);

if (missing.length > 0) {
  console.log(`\n  Referenced by the database and not in the bucket:`);
  for (const key of missing) console.log(`    ${key}`);
  console.log(
    `\n  Each of these is a broken image on the storefront. They are reported\n` +
      `  rather than skipped quietly, and the migration continues with the rest.`,
  );
}

// ── 2. Up to Hostinger, in one archive ───────────────────────────────────────
if (downloaded.length === 0) {
  console.error("\nNothing to upload.");
  process.exit(1);
}

/*
 * ── SIDECARS ────────────────────────────────────────────────────────────────
 *
 * A filesystem stores bytes and a modification time. It does not store a
 * content type, and R2 did — so `FilesystemObjectStore` keeps one in a
 * `.meta.json` beside each object, and the media route reads it.
 *
 * Copying only the bytes produced a storefront where every image returned 200
 * with NO Content-Type at all. Browsers would normally sniff their way out of
 * that; this application sends `X-Content-Type-Options: nosniff` on media
 * precisely so they cannot, so every photograph silently failed to render.
 *
 * The sha256 is computed here rather than copied, because it is the one field
 * that must describe the bytes that actually landed.
 */
const withoutType = [];
for (const item of downloaded) {
  const type = contentTypeFor(item.key);
  if (type === null) {
    withoutType.push(item.key);
    continue;
  }

  const bytes = fs.readFileSync(path.join(LOCAL, item.key));
  const sidecar = {
    contentType: type,
    // A year, immutable: the key contains a content hash, so the object at a
    // given key cannot change. Matches what the Worker sent.
    cacheControl: "public, max-age=31536000, immutable",
    size: bytes.byteLength,
    sha256: crypto.createHash("sha256").update(bytes).digest("hex"),
    uploadedAt: Date.now(),
  };
  fs.writeFileSync(path.join(LOCAL, `${item.key}.meta.json`), JSON.stringify(sidecar));
}

console.log(`  wrote ${downloaded.length - withoutType.length} sidecars`);
if (withoutType.length > 0) {
  console.log(`  NO CONTENT TYPE for ${withoutType.length}: ${withoutType.join(", ")}`);
  console.log(`  Those are copied but will not be served — the media route needs a type.`);
}

const tarball = path.posix.join(".local", "media.tar.gz");
execFileSync("tar", ["-czf", tarball, "-C", LOCAL, "."], { stdio: "pipe" });
console.log(`  packed ${(fs.statSync(tarball).size / 1024 / 1024).toFixed(2)} MB`);

await withSsh(async (ssh) => {
  await ssh.run(`mkdir -p ${REMOTE_ROOT}`);
  await ssh.put(tarball, `${REMOTE_ROOT}/media.tar.gz`);
  const unpack = await ssh.run(
    `cd ${REMOTE_ROOT} && tar -xzf media.tar.gz && rm -f media.tar.gz && find . -type f | wc -l`,
  );
  console.log(`  unpacked — ${unpack.out.trim()} files now under ${REMOTE_ROOT}`);

  /*
   * Reconciliation, by size, per key.
   *
   * Not a count: a count matches while a truncated upload sits in the middle
   * of it, and a truncated photograph is a photograph the browser refuses to
   * render with no error anywhere.
   */
  const expected = downloaded.map((d) => `${d.bytes} ${d.key}`).join("\n");
  await ssh.write(expected, `${REMOTE_ROOT}/.expected-sizes`);
  const check = await ssh.run(
    `cd ${REMOTE_ROOT} && bad=0; while read -r size key; do ` +
      `actual=$(stat -c%s "$key" 2>/dev/null || echo 0); ` +
      `[ "$actual" = "$size" ] || { echo "MISMATCH $key expected=$size actual=$actual"; bad=$((bad+1)); }; ` +
      `done < .expected-sizes; rm -f .expected-sizes; echo "mismatches=$bad"`,
  );
  console.log(`  ${check.out.trim().split("\n").slice(-1)[0]}`);
  if (!check.out.includes("mismatches=0")) {
    console.error(check.out.trim());
    throw new Error("Uploaded media does not match what was downloaded.");
  }
});

fs.rmSync(tarball, { force: true });

console.log(
  `\n  ${downloaded.length} objects migrated and size-verified.` +
    (missing.length > 0 ? `\n  ${missing.length} referenced objects were NOT in the bucket.` : ""),
);
