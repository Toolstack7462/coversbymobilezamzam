/**
 * Catalogue search on MariaDB.
 *
 * The brief names the tokens that have to work: `PD`, `Qi`, `USB-C`,
 * `iPhone 16`, `25W`, `S24`, Italian accents, aliases and exact SKUs. Every one
 * of them is a case here, because each fails for a DIFFERENT reason and a test
 * that only searched for "cover" would pass while the shop was unable to find
 * a 25W charger.
 *
 *   PD, Qi        two characters — below innodb_ft_min_token_size, so FULLTEXT
 *                 never indexes them
 *   25W, S24      digits and a letter; indexed, but easy to lose to a
 *                 tokenisation change
 *   USB-C         a hyphen, which FULLTEXT splits and boolean mode reads as NOT
 *   città         an accent the collation must fold
 *   an exact SKU  must match exactly, not as a prefix of something else
 */

import { beforeAll, afterAll, beforeEach, describe, expect, it } from "vitest";
import { resetSchema, testDb, truncateFixtures } from "./helpers";
import { parseSearchQuery } from "~/domain/search/query";
import { searchPredicate } from "~/infrastructure/search/predicate";
import { rebuildAll } from "~/infrastructure/search/indexer";
import type { MariaDbDatabase } from "~/infrastructure/db/mariadb";

let db: MariaDbDatabase;

const ids = (() => {
  let n = 0;
  return {
    generate: () => `id-${String(++n).padStart(8, "0")}`,
  };
})();

/** The products the cases below search for. */
const CATALOGUE = [
  {
    id: "p-pd",
    slug: "caricatore-pd-25w",
    name: "Caricatore da parete PD 25W",
    description: "Ricarica rapida Power Delivery per iPhone 16 e Galaxy S24.",
    sku: "CAR-PD-25W",
  },
  {
    id: "p-qi",
    slug: "base-ricarica-qi",
    name: "Base di ricarica wireless Qi",
    description: "Compatibile con ogni telefono Qi.",
    sku: "BAS-QI-01",
  },
  {
    id: "p-usbc",
    slug: "cavo-usb-c",
    name: "Cavo USB-C intrecciato",
    description: "Un metro, USB-C su entrambe le estremità.",
    sku: "CAV-USBC-1M",
  },
  {
    id: "p-citta",
    slug: "cover-citta",
    name: "Cover Città di Sulmona",
    description: "Serie dedicata alla città.",
    sku: "COV-SUL-01",
  },
  {
    id: "p-plain",
    slug: "cover-trasparente",
    name: "Cover trasparente",
    description: "Cover semplice, senza stampa.",
    sku: "COV-TRA-01",
  },
] as const;

beforeAll(async () => {
  await resetSchema();
  db = testDb();
}, 120_000);

afterAll(async () => {
  await db?.close();
});

beforeEach(async () => {
  await truncateFixtures(db);

  const now = Date.now();
  await db
    .prepare(
      `INSERT INTO brands (id, slug, name, sort_order, created_at, updated_at)
       VALUES ('b1','acme','Acme',0,?1,?1)`,
    )
    .bind(now)
    .run();

  for (const product of CATALOGUE) {
    await db.batch([
      db
        .prepare(
          `INSERT INTO products (id, slug, brand_id, status, is_featured, created_at, updated_at)
           VALUES (?1, ?2, 'b1', 'active', 0, ?3, ?3)`,
        )
        .bind(product.id, product.slug, now),
      db
        .prepare(
          `INSERT INTO product_translations (id, product_id, locale, name, short_description)
           VALUES (?1, ?2, 'it', ?3, ?4)`,
        )
        .bind(`t-${product.id}`, product.id, product.name, product.description),
      db
        .prepare(
          `INSERT INTO product_variants
             (id, product_id, sku, active, available_online, available_for_pickup, sort_order, created_at, updated_at)
           VALUES (?1, ?2, ?3, 1, 1, 1, 0, ?4, ?4)`,
        )
        .bind(`v-${product.id}`, product.id, product.sku, now),
    ]);
  }

  await rebuildAll(db, ids, now);
});

/** Runs the real collection predicate and returns the slugs it matches. */
async function search(query: string): Promise<string[]> {
  const parsed = parseSearchQuery(query);
  const predicate = searchPredicate(db.dialect, parsed, 0);
  if (!predicate) return [];

  const { results } = await db
    .prepare(`SELECT p.slug FROM products p WHERE ${predicate.sql} ORDER BY p.slug`)
    .bind(...predicate.binds)
    .all<{ slug: string }>();
  return results.map((r) => r.slug);
}

describe("the index is built", () => {
  it("writes one document per product per locale, and tokens for each", async () => {
    const documents = await db
      .prepare(`SELECT COUNT(*) AS n FROM product_search_documents`)
      .first<{ n: number }>();
    const tokens = await db
      .prepare(`SELECT COUNT(*) AS n FROM product_search_tokens`)
      .first<{ n: number }>();

    expect(documents?.n).toBe(CATALOGUE.length);
    expect(tokens?.n).toBeGreaterThan(CATALOGUE.length);
  });

  it("weights a SKU token above a description word", async () => {
    const row = await db
      .prepare(
        `SELECT source, weight FROM product_search_tokens
          WHERE product_id = 'p-pd' AND token = 'car-pd-25w'`,
      )
      .first<{ source: string; weight: number }>();
    expect(row?.source).toBe("sku");
    expect(row?.weight).toBeGreaterThan(1);
  });
});

describe("the tokens the brief names", () => {
  /*
   * The two that FULLTEXT cannot see at all. `innodb_ft_min_token_size`
   * defaults to 3, so neither of these is in the FULLTEXT index — they are
   * found through the token table, which is the entire reason it exists.
   */
  it("finds a two-character technical token: PD", async () => {
    expect(await search("PD")).toContain("caricatore-pd-25w");
  });

  it("finds a two-character technical token: Qi", async () => {
    expect(await search("Qi")).toContain("base-ricarica-qi");
  });

  it("finds a wattage: 25W", async () => {
    expect(await search("25W")).toContain("caricatore-pd-25w");
  });

  it("finds a model designation: S24", async () => {
    expect(await search("S24")).toContain("caricatore-pd-25w");
  });

  /*
   * A hyphen is a NOT operator in boolean mode. Passed through unescaped,
   * `usb-c` means "contains usb, does NOT contain c" — the opposite of the
   * question. This is the case that would silently return the wrong products
   * rather than none.
   */
  it("finds a hyphenated token: USB-C", async () => {
    expect(await search("USB-C")).toContain("cavo-usb-c");
  });

  it("finds a multi-word product: iPhone 16", async () => {
    expect(await search("iPhone 16")).toContain("caricatore-pd-25w");
  });

  it("finds an exact SKU", async () => {
    expect(await search("CAV-USBC-1M")).toEqual(["cavo-usb-c"]);
  });

  it("folds an accent, in both directions", async () => {
    expect(await search("citta")).toContain("cover-citta");
    expect(await search("città")).toContain("cover-citta");
  });

  it("matches as the customer types, on the last term only", async () => {
    expect(await search("caric")).toContain("caricatore-pd-25w");
  });
});

describe("what search must NOT do", () => {
  /*
   * Several terms mean AND, exactly as FTS5 did. A search that quietly ORed
   * them would return most of the catalogue for every query and look like it
   * was working.
   */
  it("requires every term, not any of them", async () => {
    const both = await search("cavo usb");
    expect(both).toContain("cavo-usb-c");
    expect(both).not.toContain("cover-trasparente");
  });

  it("returns nothing rather than everything for a term no product has", async () => {
    expect(await search("frigorifero")).toEqual([]);
  });

  it("does not treat a stray quotation mark as syntax", async () => {
    await expect(search('cover "')).resolves.toBeInstanceOf(Array);
  });

  it("does not treat a leading hyphen as an exclusion", async () => {
    // FTS5 and boolean mode both read `-x` as NOT. The parser strips it, so a
    // customer typing a dash gets a search rather than an inverted one.
    const results = await search("-cover");
    expect(results).toContain("cover-trasparente");
  });

  it("survives an emoji and an operator word", async () => {
    await expect(search("cover 🙂 AND")).resolves.toBeInstanceOf(Array);
  });
});

describe("the index tracks the catalogue", () => {
  it("stops matching a product whose name no longer contains the term", async () => {
    expect(await search("trasparente")).toContain("cover-trasparente");

    await db
      .prepare(`UPDATE product_translations SET name = ?1 WHERE product_id = 'p-plain'`)
      .bind("Cover opaca")
      .run();
    await rebuildAll(db, ids, Date.now());

    expect(await search("trasparente")).not.toContain("cover-trasparente");
    expect(await search("opaca")).toContain("cover-trasparente");
  });

  it("drops a deleted product's rows through the foreign key", async () => {
    await db.prepare(`DELETE FROM product_translations WHERE product_id = 'p-plain'`).run();
    await db.prepare(`DELETE FROM product_variants WHERE product_id = 'p-plain'`).run();
    await db.prepare(`DELETE FROM products WHERE id = 'p-plain'`).run();

    const documents = await db
      .prepare(`SELECT COUNT(*) AS n FROM product_search_documents WHERE product_id = 'p-plain'`)
      .first<{ n: number }>();
    const tokens = await db
      .prepare(`SELECT COUNT(*) AS n FROM product_search_tokens WHERE product_id = 'p-plain'`)
      .first<{ n: number }>();

    expect(documents?.n).toBe(0);
    expect(tokens?.n).toBe(0);
  });

  it("rebuilds to the same state, so a rebuild is safe to re-run", async () => {
    const before = await search("cavo usb");
    await rebuildAll(db, ids, Date.now());
    await rebuildAll(db, ids, Date.now());
    expect(await search("cavo usb")).toEqual(before);
  });
});
