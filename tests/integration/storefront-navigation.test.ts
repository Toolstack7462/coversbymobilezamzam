import { env } from "cloudflare:test";
import { describe, it, expect, beforeEach } from "vitest";
import { seed } from "../../tests/fixtures/seed";

/**
 * The primary navigation points at categories that exist.
 *
 * ── The bug ──────────────────────────────────────────────────────────────────
 *
 * The header rail was a hardcoded constant of eight slugs — `cover`,
 * `protezione-schermo`, `caricatori`, `cavi`, `power-bank`, `magsafe`, `audio`,
 * `supporti-auto`. The catalogue held four categories, slugged `demo-cover`,
 * `demo-cavi`, `demo-caricabatterie`, `demo-powerbank`.
 *
 * Not one matched. **Every category link in the primary navigation led to a
 * page reading "0 prodotti"**, and the footer — built from the same constant so
 * the two could not drift — faithfully reproduced all eight broken links.
 *
 * It survived a full deployed-preview audit, a forensic visual audit and a
 * premium redesign, because everything that renders a category page renders it
 * correctly: the filter was applied, matched nothing, and an empty result is a
 * legitimate state. The pages were not broken. The menu was pointing somewhere
 * else, and nothing compared the two.
 *
 * ── Why this test is shaped like this ────────────────────────────────────────
 *
 * The fix was structural: the navigation is now read from the categories table
 * in the storefront layout, so a link to a category that does not exist is no
 * longer expressible. This test guards the query that does it — specifically
 * its filters, which are the part a future change would plausibly get wrong.
 *
 * The general lesson is worth stating: a constant that names rows in a database
 * is a foreign key with no constraint behind it. It will drift, and nothing
 * will say so.
 */

/** The query the storefront layout runs. Kept in step deliberately. */
const NAV_QUERY = `SELECT c.slug, COALESCE(ct.name, ct_fallback.name) AS name
     FROM categories c
     LEFT JOIN category_translations ct
       ON ct.category_id = c.id AND ct.locale = ?
     LEFT JOIN category_translations ct_fallback
       ON ct_fallback.category_id = c.id AND ct_fallback.locale = 'it'
    WHERE c.visible = 1 AND c.archived_at IS NULL AND c.depth = 0
    ORDER BY c.sort_order ASC, c.slug ASC`;

async function navigation(locale = "it") {
  const { results } = await env.DB.prepare(NAV_QUERY).bind(locale).all<{
    slug: string;
    name: string | null;
  }>();
  return results.filter((r) => r.name);
}

describe("storefront navigation", () => {
  beforeEach(async () => {
    await seed(env.DB);
  });

  it("only lists categories that exist in the catalogue", async () => {
    const slugs = (await navigation()).map((r) => r.slug);
    expect(slugs.length).toBeGreaterThan(0);

    const { results } = await env.DB.prepare(`SELECT slug FROM categories`).all<{ slug: string }>();
    const real = new Set(results.map((r) => r.slug));

    for (const slug of slugs) expect(real.has(slug)).toBe(true);
  });

  it("hides a category the merchant has made invisible", async () => {
    const before = (await navigation()).map((r) => r.slug);
    expect(before).toContain("cover");

    await env.DB.prepare(`UPDATE categories SET visible = 0 WHERE slug = 'cover'`).run();

    // Hiding a category has to remove it from the menu too. Otherwise the
    // merchant hides it, sees it still listed, and reasonably concludes the
    // setting does not work.
    expect((await navigation()).map((r) => r.slug)).not.toContain("cover");
  });

  it("hides an archived category", async () => {
    await env.DB.prepare(`UPDATE categories SET archived_at = ? WHERE slug = 'cover'`)
      .bind(Date.now())
      .run();

    expect((await navigation()).map((r) => r.slug)).not.toContain("cover");
  });

  it("never renders a link with no name", async () => {
    await env.DB.prepare(`DELETE FROM category_translations WHERE locale IN ('it', 'en')`).run();

    // A link labelled with a raw slug is worse than a shorter menu.
    expect(await navigation()).toEqual([]);
  });

  it("falls back to Italian when a category has no translation in the active locale", async () => {
    await env.DB.prepare(`DELETE FROM category_translations WHERE locale = 'en'`).run();

    const english = await navigation("en");
    const italian = await navigation("it");

    // An English visitor still gets a working menu, in Italian, rather than a
    // menu that silently loses entries at a locale boundary.
    expect(english.map((r) => r.slug)).toEqual(italian.map((r) => r.slug));
  });

  it("respects the merchant's ordering", async () => {
    await env.DB.prepare(`UPDATE categories SET sort_order = 99 WHERE slug = 'cover'`).run();
    const slugs = (await navigation()).map((r) => r.slug);

    if (slugs.length > 1) expect(slugs.at(-1)).toBe("cover");
  });
});
