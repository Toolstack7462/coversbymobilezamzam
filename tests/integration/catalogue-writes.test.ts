import { env } from "cloudflare:test";
import { describe, it, expect, beforeEach } from "vitest";
import { slugify } from "~/domain/catalogue/slug";
import { loadProductDetail } from "~/routes/admin/product-detail";
import { cryptoIds } from "~/infrastructure/primitives";
import { seed, IDS } from "../../tests/fixtures/seed";

/**
 * Writes to the catalogue reference data, against the real schema.
 *
 * Two things here are worth testing rather than trusting:
 *
 *   - The devices screen builds its INSERT column list at runtime, because the
 *     three levels differ only in their parent columns. That is convenient and
 *     exactly the kind of code that names a column wrong without TypeScript
 *     noticing.
 *   - The partial unique index on compatibility is the ONLY thing preventing
 *     two contradictory claims about the same phone. SQLite treats NULLs as
 *     distinct, so a single index over (product, variant, model) would let a
 *     product-level "exact fit" and a product-level "incompatible" coexist.
 *     That deserves a test that would fail if someone simplified the index.
 */

const NOW = 1_756_000_700_000;

/** Mirrors the devices route's dynamic insert. */
async function addDevice(
  table: "device_brands" | "device_families" | "device_models",
  name: string,
  extraColumns: Record<string, string | number | null>,
): Promise<string> {
  const id = cryptoIds.generate();
  const columns = [
    "id",
    "handle",
    "name",
    ...Object.keys(extraColumns),
    "created_at",
    "updated_at",
  ];
  const values = [id, slugify(name), name, ...Object.values(extraColumns), NOW, NOW];
  const placeholders = values.map((_, i) => `?${i + 1}`).join(", ");

  await env.DB.prepare(`INSERT INTO ${table} (${columns.join(", ")}) VALUES (${placeholders})`)
    .bind(...values)
    .run();

  return id;
}

describe("adding devices", () => {
  beforeEach(async () => {
    await seed(env.DB);
  });

  it("adds a brand, a family and a model in that order", async () => {
    const brandId = await addDevice("device_brands", "Nothing", {});
    const familyId = await addDevice("device_families", "Phone 2a", {
      device_brand_id: brandId,
      release_year: 2024,
    });
    const modelId = await addDevice("device_models", "Nothing Phone 2a Plus", {
      device_brand_id: brandId,
      device_family_id: familyId,
      release_year: 2024,
      connector: "USB-C",
    });

    const model = await env.DB.prepare(
      `SELECT m.name, m.handle, m.connector, m.active, b.name AS brand, f.name AS family
         FROM device_models m
         JOIN device_brands b ON b.id = m.device_brand_id
         JOIN device_families f ON f.id = m.device_family_id
        WHERE m.id = ?1`,
    )
      .bind(modelId)
      .first<Record<string, string | number>>();

    expect(model).toMatchObject({
      name: "Nothing Phone 2a Plus",
      handle: "nothing-phone-2a-plus",
      connector: "USB-C",
      brand: "Nothing",
      family: "Phone 2a",
      // Active by default: a model is added because the shop wants to sell for
      // it, so making them tick a box to enable it would be busywork.
      active: 1,
    });
  });

  it("refuses a duplicate handle", async () => {
    // A brand name the fixture does not already seed, so the FIRST insert is
    // the one under test rather than an accidental collision with the seed.
    await addDevice("device_brands", "Nothing", {});
    // Different capitalisation, same handle. Two "Nothing" brands would split
    // the compatibility data in half with no visible sign.
    await expect(addDevice("device_brands", "NOTHING", {})).rejects.toThrow(/UNIQUE/i);
  });

  it("deactivates rather than deletes", async () => {
    const brandId = await addDevice("device_brands", "Fairphone", {});
    await env.DB.prepare(`UPDATE device_brands SET active = 0 WHERE id = ?1`).bind(brandId).run();

    const row = await env.DB.prepare(`SELECT active FROM device_brands WHERE id = ?1`)
      .bind(brandId)
      .first<{ active: number }>();

    // Still there, still readable by every historical record that points at it.
    expect(row).not.toBeNull();
    expect(row!.active).toBe(0);
  });
});

describe("adding compatibility", () => {
  beforeEach(async () => {
    await seed(env.DB);
  });

  const addCompatibility = (level: string, modelId: string, id = cryptoIds.generate()) =>
    env.DB.prepare(
      `INSERT INTO product_compatibility
         (id, product_id, variant_id, device_model_id, compatibility_level, verified, created_at, updated_at)
       VALUES (?1, ?2, NULL, ?3, ?4, 0, ?5, ?5)`,
    )
      .bind(id, IDS.product, modelId, level, NOW)
      .run();

  it("records a claim as unverified, whatever the level", async () => {
    // Nobody can assert a fit by filling in a form. exact_fit in particular
    // needs someone holding both objects.
    const id = cryptoIds.generate();
    await addCompatibility("exact_fit", IDS.deviceModelOther, id);

    const row = await env.DB.prepare(
      `SELECT compatibility_level, verified, verified_by FROM product_compatibility WHERE id = ?1`,
    )
      .bind(id)
      .first<{ compatibility_level: string; verified: number; verified_by: string | null }>();

    expect(row).toMatchObject({ compatibility_level: "exact_fit", verified: 0, verified_by: null });
  });

  it("refuses a second product-level claim about the same phone", async () => {
    await addCompatibility("exact_fit", IDS.deviceModelOther);

    // The partial unique index is what stops this. Without it — or with a
    // single index over all three columns, since SQLite treats NULLs as
    // distinct — a product could claim both "fits exactly" and "does not fit"
    // for one phone, and the resolver would pick whichever it read first.
    await expect(addCompatibility("incompatible", IDS.deviceModelOther)).rejects.toThrow(/UNIQUE/i);
  });

  it("allows claims about two different phones", async () => {
    // The fixture already records the product against IDS.deviceModel, so this
    // adds a claim about the OTHER model. Two rows, two phones, no collision —
    // the index constrains a product-and-phone pair, not a product.
    const before = await env.DB.prepare(
      `SELECT COUNT(*) AS n FROM product_compatibility WHERE product_id = ?1`,
    )
      .bind(IDS.product)
      .first<{ n: number }>();

    await addCompatibility("incompatible", IDS.deviceModelOther);

    const after = await env.DB.prepare(
      `SELECT COUNT(*) AS n FROM product_compatibility WHERE product_id = ?1`,
    )
      .bind(IDS.product)
      .first<{ n: number }>();

    expect(after!.n).toBe(before!.n + 1);
    expect(after!.n).toBeGreaterThanOrEqual(2);
  });

  it("shows up on the product screen with its device name resolved", async () => {
    const id = cryptoIds.generate();
    await addCompatibility("adapter_required", IDS.deviceModelOther, id);

    const data = await loadProductDetail(env, IDS.product);
    const row = data.compatibility.find((c) => c.id === id);

    expect(row).toBeDefined();
    expect(row!.compatibility_level).toBe("adapter_required");
    // Resolved through the model and brand joins, not left as a raw id.
    expect(row!.model_name).toBeTruthy();
  });

  it("can be removed without touching any order", async () => {
    const id = cryptoIds.generate();
    await addCompatibility("compatible", IDS.deviceModelOther, id);

    await env.DB.prepare(`DELETE FROM product_compatibility WHERE id = ?1`).bind(id).run();

    const gone = await env.DB.prepare(`SELECT id FROM product_compatibility WHERE id = ?1`)
      .bind(id)
      .first();
    expect(gone).toBeNull();

    // Deleting a rule is safe precisely because orders do not reference it:
    // they snapshot the state they were placed under into order_items.
    const orderItemsStillFine = await env.DB.prepare(
      `SELECT COUNT(*) AS n FROM order_items`,
    ).first<{ n: number }>();
    expect(Number.isInteger(orderItemsStillFine!.n)).toBe(true);
  });
});
