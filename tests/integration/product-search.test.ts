import { env } from "cloudflare:test";
import { describe, it, expect, beforeEach } from "vitest";
import { parseSearchQuery } from "~/domain/search/query";
import { createProduct, CreateProductInput } from "~/application/commands/create-product";
import { fixedClock, cryptoIds } from "~/infrastructure/primitives";
import { seed, IDS } from "../../tests/fixtures/seed";

/**
 * Full-text search, against real SQLite.
 *
 * The unit tests prove the query parser cannot produce invalid FTS5 syntax.
 * This file proves the two things only a database can answer:
 *
 *   1. The index is actually kept in step by the triggers. An index the
 *      application has to remember to update goes stale the first time somebody
 *      writes a bulk import or fixes a row by hand — so the triggers exist to
 *      make staleness impossible, and that claim needs testing.
 *   2. The parser's output survives contact with MATCH. A quoted term is only
 *      safe if SQLite agrees it is.
 */

const NOW = 1_756_000_900_000;
const deps = {
  d1: env.DB,
  clock: fixedClock(NOW),
  ids: cryptoIds,
  defaultLocationId: IDS.location,
  actorId: "u",
  actorLabel: "U",
};

/** Runs a customer's search the way the storefront will. */
async function search(raw: string): Promise<string[]> {
  const parsed = parseSearchQuery(raw);
  if (parsed.match === null) return [];

  const { results } = await env.DB.prepare(
    `SELECT m.product_id
       FROM product_search s
       JOIN product_search_map m ON m.rowid = s.rowid
      WHERE product_search MATCH ?1
      ORDER BY rank
      LIMIT 20`,
  )
    .bind(parsed.match)
    .all<{ product_id: string }>();

  return results.map((r) => r.product_id);
}

const add = async (name: string, sku: string, description?: string) => {
  const result = await createProduct(
    CreateProductInput.parse({
      name,
      sku,
      price: "19,90",
      ...(description ? { shortDescription: description } : {}),
    }),
    deps,
  );
  if (!result.ok) throw new Error(result.error);
  return result.productId;
};

describe("finding a product", () => {
  beforeEach(async () => {
    await seed(env.DB);
  });

  it("finds it by a word from its name", async () => {
    const id = await add("Cover trasparente per iPhone 15", "SRCH-1");
    expect(await search("trasparente")).toContain(id);
  });

  it("finds it by two words in any order", async () => {
    const id = await add("Cover trasparente per iPhone 15", "SRCH-2");
    expect(await search("cover trasparente")).toContain(id);
    expect(await search("trasparente cover")).toContain(id);
  });

  it("finds it by a prefix of the last word, as someone types", async () => {
    const id = await add("Caricabatterie rapido 20W", "SRCH-3");
    expect(await search("caricabat")).toContain(id);
  });

  it("finds it by SKU", async () => {
    // A shopper reading a code off a box, or staff checking stock at the
    // counter. The SKU is indexed alongside the name for exactly this.
    const id = await add("Pellicola vetro temperato", "PELL-99XZ");
    expect(await search("PELL-99XZ")).toContain(id);
  });

  it("finds it by a word from its description", async () => {
    const id = await add("Cover minimal", "SRCH-4", "Antiurto e sottile, compatibile MagSafe");
    expect(await search("magsafe")).toContain(id);
  });

  it("ignores accents in both directions", async () => {
    // remove_diacritics 2 on the tokenizer. A customer typing without accents —
    // which is most of them, on a phone — still finds the product.
    const id = await add("Cover per città e viaggio", "SRCH-5");
    expect(await search("citta")).toContain(id);
    expect(await search("città")).toContain(id);
  });

  it("requires ALL the words, not any of them", async () => {
    const cover = await add("Cover iPhone", "SRCH-6");
    await add("Cavo USB-C", "SRCH-7");

    // An OR search returns the whole catalogue for a two-word query and buries
    // the thing the customer asked for.
    const results = await search("cover iphone");
    expect(results).toContain(cover);
    expect(results).toHaveLength(1);
  });
});

describe("the index follows the data", () => {
  beforeEach(async () => {
    await seed(env.DB);
  });

  it("indexes a product the moment it is created", async () => {
    const id = await add("Supporto magnetico da auto", "SRCH-8");
    expect(await search("magnetico")).toContain(id);
  });

  it("follows a rename, and stops matching the old name", async () => {
    const id = await add("Cover vecchio nome", "SRCH-9");
    expect(await search("vecchio")).toContain(id);

    await env.DB.prepare(
      `UPDATE product_translations SET name = 'Cover nome nuovo'
        WHERE product_id = ?1 AND locale = 'it'`,
    )
      .bind(id)
      .run();

    expect(await search("nuovo")).toContain(id);
    // The old row must be removed, not merely superseded: FTS5 external-content
    // tables have no update in place, so a missing delete leaves the product
    // findable under a name it no longer has.
    expect(await search("vecchio")).not.toContain(id);
  });

  it("picks up a SKU added later", async () => {
    const id = await add("Cover con varianti", "SRCH-10");

    await env.DB.prepare(
      `INSERT INTO product_variants (id, product_id, sku, is_default, active, sort_order, created_at, updated_at)
       VALUES (?1, ?2, 'EXTRA-SKU-77', 0, 1, 1, ?3, ?3)`,
    )
      .bind(cryptoIds.generate(), id, NOW)
      .run();

    expect(await search("EXTRA-SKU-77")).toContain(id);
  });

  it("drops a product from the index when its translation goes", async () => {
    const id = await add("Cover da rimuovere", "SRCH-11");
    expect(await search("rimuovere")).toContain(id);

    await env.DB.prepare(`DELETE FROM product_translations WHERE product_id = ?1`).bind(id).run();

    expect(await search("rimuovere")).not.toContain(id);
  });
});

describe("hostile input reaches MATCH without exploding", () => {
  beforeEach(async () => {
    await seed(env.DB);
    await add("Cover trasparente", "SRCH-12");
  });

  // Each of these raises a SQLite syntax error if passed to MATCH unparsed —
  // meaning the shop's search page returns a 500 because somebody typed a
  // quotation mark.
  const NASTY = [
    'cover"',
    'cover 6.7"',
    "-cover",
    "cover AND",
    "NEAR(cover, 3)",
    "cover OR OR OR",
    "^cover",
    "cover*",
    "((()))",
    "cover: iphone",
    "'; DROP TABLE products; --",
    "🙂 cover",
  ];

  for (const input of NASTY) {
    it(`survives ${JSON.stringify(input)}`, async () => {
      await expect(search(input)).resolves.toBeInstanceOf(Array);
    });
  }

  it("leaves the catalogue intact after an injection attempt", async () => {
    await search("'; DROP TABLE products; --");
    const count = await env.DB.prepare(`SELECT COUNT(*) AS n FROM products`).first<{ n: number }>();
    expect(count!.n).toBeGreaterThan(0);
  });
});
