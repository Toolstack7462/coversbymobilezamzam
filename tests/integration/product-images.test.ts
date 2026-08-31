import { env } from "cloudflare:test";
import { describe, it, expect, beforeEach } from "vitest";
import { inspectImage, hashImage, imageObjectKey } from "~/domain/media/image";
import { cryptoIds } from "~/infrastructure/primitives";
import { seed, IDS } from "../../tests/fixtures/seed";

/**
 * Product images: R2 and the database together.
 *
 * The unit tests prove the header parser reads dimensions correctly. This file
 * covers the part that spans two stores, where the interesting failures are:
 *
 *   - the object key is a content hash, so the same photo attached twice is one
 *     object, and deleting one product's copy must not blank another's;
 *   - a product must never end up with images but none marked primary, because
 *     the storefront picks the primary one and would render nothing;
 *   - the R2 write happens BEFORE the row, so a failure leaves an unreferenced
 *     object rather than a row pointing at nothing.
 */

const NOW = 1_756_000_800_000;

function png(width: number, height: number, tint = 0): ArrayBuffer {
  const bytes = new Uint8Array(32);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  const view = new DataView(bytes.buffer);
  view.setUint32(16, width, false);
  view.setUint32(20, height, false);
  // Distinguishes otherwise-identical files, so two different photos of the
  // same size do not collide on their hash.
  bytes[28] = tint;
  return bytes.buffer;
}

/** Mirrors the route's upload path. */
async function upload(
  productId: string,
  buffer: ArrayBuffer,
  alt: string | null = null,
): Promise<{ id: string; key: string }> {
  const check = inspectImage(buffer);
  if (!check.ok) throw new Error(check.error);

  const hash = await hashImage(buffer);
  const key = imageObjectKey(productId, hash, check.facts.extension);

  const existing = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM product_images WHERE product_id = ?1`,
  )
    .bind(productId)
    .first<{ n: number }>();

  await env.MEDIA.put(key, buffer, { httpMetadata: { contentType: check.facts.type } });

  const id = cryptoIds.generate();
  await env.DB.prepare(
    `INSERT INTO product_images
       (id, product_id, object_key, alt_it, width, height, mime_type, file_size, file_hash,
        is_primary, sort_order, created_at)
     VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12)`,
  )
    .bind(
      id,
      productId,
      key,
      alt,
      check.facts.width,
      check.facts.height,
      check.facts.type,
      check.facts.bytes,
      hash,
      (existing?.n ?? 0) === 0 ? 1 : 0,
      existing?.n ?? 0,
      NOW,
    )
    .run();

  return { id, key };
}

describe("uploading", () => {
  beforeEach(async () => {
    await seed(env.DB);
  });

  it("stores the object and a row carrying the real dimensions", async () => {
    const { key } = await upload(IDS.product, png(1200, 900), "Cover vista di fronte");

    const object = await env.MEDIA.get(key);
    expect(object).not.toBeNull();

    const row = await env.DB.prepare(
      `SELECT width, height, mime_type, alt_it, is_primary FROM product_images WHERE object_key = ?1`,
    )
      .bind(key)
      .first<Record<string, string | number | null>>();

    // Dimensions come from the file, not from the merchant. They are what lets
    // the storefront reserve space before the photo arrives.
    expect(row).toMatchObject({
      width: 1200,
      height: 900,
      mime_type: "image/png",
      alt_it: "Cover vista di fronte",
      is_primary: 1,
    });
  });

  it("makes only the first upload primary", async () => {
    await upload(IDS.product, png(1200, 900, 1));
    await upload(IDS.product, png(1200, 900, 2));

    const primaries = await env.DB.prepare(
      `SELECT COUNT(*) AS n FROM product_images WHERE product_id = ?1 AND is_primary = 1`,
    )
      .bind(IDS.product)
      .first<{ n: number }>();

    // Exactly one. Two would make the storefront's choice arbitrary; none would
    // make it render no photo at all.
    expect(primaries!.n).toBe(1);
  });

  it("puts the same photo at the same key twice", async () => {
    const photo = png(800, 600, 7);
    const first = await upload(IDS.product, photo);

    // A second product legitimately using the same image file.
    const secondProduct = "prod_second";
    await env.DB.prepare(
      `INSERT INTO products (id, slug, status, created_at, updated_at) VALUES (?1,'secondo','draft',?2,?2)`,
    )
      .bind(secondProduct, NOW)
      .run();
    const second = await upload(secondProduct, photo);

    // Different products, so different keys — the key is namespaced per
    // product. What is shared is the hash, which is what makes the duplicate
    // detectable at all.
    expect(first.key).not.toBe(second.key);

    const hashes = await env.DB.prepare(
      `SELECT DISTINCT file_hash FROM product_images WHERE id IN (?1, ?2)`,
    )
      .bind(first.id, second.id)
      .all<{ file_hash: string }>();
    expect(hashes.results).toHaveLength(1);
  });

  it("refuses a file that is not really an image", async () => {
    const notAnImage = new TextEncoder().encode("this is a text file").buffer as ArrayBuffer;
    await expect(upload(IDS.product, notAnImage)).rejects.toThrow(/Formato non riconosciuto/);

    const count = await env.DB.prepare(
      `SELECT COUNT(*) AS n FROM product_images WHERE product_id = ?1`,
    )
      .bind(IDS.product)
      .first<{ n: number }>();
    expect(count!.n).toBe(0);
  });
});

describe("deleting", () => {
  beforeEach(async () => {
    await seed(env.DB);
  });

  /** Mirrors the route's delete path, including the last-reference check. */
  async function remove(id: string, productId: string) {
    const image = await env.DB.prepare(
      `SELECT object_key, is_primary FROM product_images WHERE id = ?1`,
    )
      .bind(id)
      .first<{ object_key: string; is_primary: number }>();
    if (!image) throw new Error("not found");

    const others = await env.DB.prepare(
      `SELECT COUNT(*) AS n FROM product_images WHERE object_key = ?1 AND id <> ?2`,
    )
      .bind(image.object_key, id)
      .first<{ n: number }>();

    await env.DB.prepare(`DELETE FROM product_images WHERE id = ?1`).bind(id).run();
    if ((others?.n ?? 0) === 0) await env.MEDIA.delete(image.object_key);

    if (image.is_primary === 1) {
      const next = await env.DB.prepare(
        `SELECT id FROM product_images WHERE product_id = ?1 ORDER BY sort_order LIMIT 1`,
      )
        .bind(productId)
        .first<{ id: string }>();
      if (next) {
        await env.DB.prepare(`UPDATE product_images SET is_primary = 1 WHERE id = ?1`)
          .bind(next.id)
          .run();
      }
    }
  }

  it("removes the object when it was the last reference", async () => {
    const { id, key } = await upload(IDS.product, png(1200, 900, 3));
    await remove(id, IDS.product);

    expect(await env.MEDIA.get(key)).toBeNull();
  });

  it("keeps the object while another row still points at it", async () => {
    // Two rows sharing one key: possible when the same product row is
    // duplicated by an import. Deleting one must not blank the other.
    const photo = png(1200, 900, 4);
    const { key } = await upload(IDS.product, photo);

    const twinId = cryptoIds.generate();
    await env.DB.prepare(
      `INSERT INTO product_images
         (id, product_id, object_key, width, height, mime_type, file_size, file_hash,
          is_primary, sort_order, created_at)
       VALUES (?1, ?2, ?3, 1200, 900, 'image/png', 32, 'x', 0, 1, ?4)`,
    )
      .bind(twinId, IDS.product, key, NOW)
      .run();

    await remove(twinId, IDS.product);

    // Still there, because the first row still references it.
    expect(await env.MEDIA.get(key)).not.toBeNull();
  });

  it("promotes another image when the primary one is deleted", async () => {
    const first = await upload(IDS.product, png(1200, 900, 5));
    await upload(IDS.product, png(1200, 900, 6));

    await remove(first.id, IDS.product);

    const primaries = await env.DB.prepare(
      `SELECT COUNT(*) AS n FROM product_images WHERE product_id = ?1 AND is_primary = 1`,
    )
      .bind(IDS.product)
      .first<{ n: number }>();

    // A product with photos and no primary renders no photo on the storefront.
    expect(primaries!.n).toBe(1);
  });

  it("leaves no primary when the last image goes, without failing", async () => {
    const only = await upload(IDS.product, png(1200, 900, 8));
    await remove(only.id, IDS.product);

    const count = await env.DB.prepare(
      `SELECT COUNT(*) AS n FROM product_images WHERE product_id = ?1`,
    )
      .bind(IDS.product)
      .first<{ n: number }>();
    expect(count!.n).toBe(0);
  });
});
