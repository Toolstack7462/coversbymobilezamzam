import { env } from "cloudflare:test";
import { describe, it, expect, beforeEach } from "vitest";
import { seed, IDS } from "../../tests/fixtures/seed";
import { categoryMembershipSql } from "~/domain/catalogue/category-membership";

/**
 * Category browsing returns the products in the category.
 *
 * This is a regression test for the largest defect found in the storefront so
 * far: the category filter read `product_category_assignments`, a table with
 * one reader and no writer anywhere in the repository, and therefore matched
 * nothing for every category in every environment. Every category page in the
 * shop said "0 prodotti" while the catalogue sat one column away, in
 * `products.primary_category_id`.
 *
 * Nothing caught it. It typechecked, the SQL was valid, the page rendered its
 * empty state correctly, and an empty category is a state a real shop is
 * legitimately in — so every check that looked at the page in isolation passed.
 * Only comparing the menu against what the menu leads to shows it.
 */
async function inCategory(slug: string) {
  const { results } = await env.DB.prepare(
    `SELECT p.id FROM products p
      WHERE p.status = 'active' AND p.archived_at IS NULL AND ${categoryMembershipSql(1)}`,
  )
    .bind(slug)
    .all<{ id: string }>();
  return results.map((r) => r.id);
}

describe("category membership", () => {
  beforeEach(async () => {
    await seed(env.DB);
  });

  it("finds a product by its PRIMARY category, with no assignment row", async () => {
    // The exact case that was broken. The fixture, like the real catalogue,
    // sets primary_category_id and writes no assignment.
    const assignments = await env.DB.prepare(
      `SELECT COUNT(*) AS n FROM product_category_assignments`,
    ).first<{ n: number }>();
    expect(assignments?.n).toBe(0);

    expect(await inCategory("cover")).toContain(IDS.product);
  });

  it("finds a product by an explicit assignment to a second category", async () => {
    await env.DB.prepare(
      `INSERT INTO categories (id, slug, path, depth, sort_order, visible, created_at, updated_at)
       VALUES ('cat_regalo','regalo','regalo',0,9,1,?1,?1)`,
    )
      .bind(Date.now())
      .run();
    await env.DB.prepare(
      `INSERT INTO product_category_assignments (id, product_id, category_id)
       VALUES ('pca_1', ?1, 'cat_regalo')`,
    )
      .bind(IDS.product)
      .run();

    expect(await inCategory("regalo")).toContain(IDS.product);
    // And it stays in its primary category. An extra assignment adds, never moves.
    expect(await inCategory("cover")).toContain(IDS.product);
  });

  it("shows a child category's products under its parent", async () => {
    await env.DB.prepare(
      `INSERT INTO categories (id, slug, parent_id, path, depth, sort_order, visible, created_at, updated_at)
       VALUES ('cat_rigide','cover-rigide',?2,'cover/rigide',1,0,1,?1,?1)`,
    )
      .bind(Date.now(), IDS.category)
      .run();
    await env.DB.prepare(`UPDATE products SET primary_category_id = 'cat_rigide' WHERE id = ?1`)
      .bind(IDS.product)
      .run();

    // Browsing the parent must not go empty because the stock sits one level down.
    expect(await inCategory("cover")).toContain(IDS.product);
    expect(await inCategory("cover-rigide")).toContain(IDS.product);
  });

  it("does not match a sibling whose path merely starts with the same text", async () => {
    await env.DB.prepare(
      `INSERT INTO categories (id, slug, path, depth, sort_order, visible, created_at, updated_at)
       VALUES ('cat_cover_xl','cover-xl','cover-xl',0,5,1,?1,?1)`,
    )
      .bind(Date.now())
      .run();

    // `cover-xl` is a different category, not a descendant of `cover`. Prefix
    // matching without the separator is how this goes quietly wrong.
    expect(await inCategory("cover-xl")).toEqual([]);
  });

  it("returns nothing for a hidden or archived category", async () => {
    await env.DB.prepare(`UPDATE categories SET visible = 0 WHERE slug = 'cover'`).run();
    expect(await inCategory("cover")).toEqual([]);

    await env.DB.prepare(`UPDATE categories SET visible = 1, archived_at = ?1 WHERE slug = 'cover'`)
      .bind(Date.now())
      .run();
    expect(await inCategory("cover")).toEqual([]);
  });

  it("returns nothing for a category that does not exist", async () => {
    expect(await inCategory("non-esiste")).toEqual([]);
  });
});
