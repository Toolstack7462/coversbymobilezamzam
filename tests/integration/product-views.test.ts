import { env } from "cloudflare:test";
import { describe, it, expect, beforeEach } from "vitest";
import { PRODUCT_VIEWS } from "~/lib/product-views";
import { orderByClause, parseTableParams, paginate, type TableSpec } from "~/lib/table-params";
import { seed, IDS } from "../../tests/fixtures/seed";

/**
 * The saved views, executed against a real D1 with the real migrations.
 *
 * A unit test can prove `PRODUCT_VIEWS` contains the slug the action centre
 * links to. It cannot prove the SQL beside that slug is valid — a view whose
 * clause names a column that was renamed three migrations ago compiles fine,
 * passes every unit test, and throws a 500 the first time a merchant clicks
 * the tab. That is what this file is for.
 */

const FROM = `FROM products p
   LEFT JOIN product_translations pt ON pt.product_id = p.id AND pt.locale = 'it'
   LEFT JOIN brands b ON b.id = p.brand_id`;

const SPEC: TableSpec = {
  views: PRODUCT_VIEWS.map((v) => v.slug),
  sortable: ["name", "brand", "status", "price", "updated"],
  defaultSort: { key: "updated", direction: "desc" },
};

const SORT_COLUMNS: Record<string, string> = {
  name: "pt.name",
  brand: "b.name",
  status: "p.status",
  price: "min_price",
  updated: "p.updated_at",
};

describe("every saved view is executable SQL", () => {
  beforeEach(async () => {
    await seed(env.DB);
  });

  for (const view of PRODUCT_VIEWS) {
    it(`"${view.slug}" runs and returns a number`, async () => {
      const row = await env.DB.prepare(`SELECT COUNT(*) AS n ${FROM} WHERE ${view.where}`).first<{
        n: number;
      }>();
      expect(Number.isInteger(row?.n)).toBe(true);
    });

    it(`"${view.slug}" runs as a paged, sorted list`, async () => {
      // The real shape the route issues, including the ORDER BY and the
      // tiebreaker, because that is where a bad column name actually surfaces.
      const { results } = await env.DB.prepare(
        `SELECT p.id,
                (SELECT MIN(vp.amount) FROM variant_prices vp
                   JOIN product_variants v ON v.id = vp.variant_id
                  WHERE v.product_id = p.id) AS min_price
           ${FROM}
          WHERE ${view.where}
          ORDER BY p.updated_at DESC, p.id
          LIMIT 25 OFFSET 0`,
      ).all<{ id: string }>();
      expect(Array.isArray(results)).toBe(true);
    });
  }

  it("runs the combined counts query the tab bar uses", async () => {
    // One query with a CASE per view. If any clause is invalid the whole tab
    // bar fails, so it is worth executing exactly as the route builds it.
    const row = await env.DB.prepare(
      `SELECT ${PRODUCT_VIEWS.map((v, i) => `SUM(CASE WHEN ${v.where} THEN 1 ELSE 0 END) AS v${i}`).join(", ")}
         ${FROM}`,
    ).first<Record<string, number>>();

    expect(row).not.toBeNull();
    for (let i = 0; i < PRODUCT_VIEWS.length; i += 1) {
      expect(Number(row![`v${i}`]), PRODUCT_VIEWS[i]!.slug).toBeGreaterThanOrEqual(0);
    }
  });
});

describe("every sortable column is a real column", () => {
  beforeEach(async () => {
    await seed(env.DB);
  });

  for (const key of SPEC.sortable) {
    it(`sorts by "${key}" without error, both directions`, async () => {
      for (const direction of ["asc", "desc"] as const) {
        const orderBy = orderByClause({ key, direction }, SORT_COLUMNS, "p.updated_at DESC");
        const { results } = await env.DB.prepare(
          `SELECT p.id,
                  (SELECT MIN(vp.amount) FROM variant_prices vp
                     JOIN product_variants v ON v.id = vp.variant_id
                    WHERE v.product_id = p.id) AS min_price
             ${FROM}
            WHERE p.archived_at IS NULL
            ORDER BY ${orderBy}, p.id LIMIT 25`,
        ).all<{ id: string }>();
        expect(Array.isArray(results), `${key} ${direction}`).toBe(true);
      }
    });
  }
});

describe("paging is stable", () => {
  beforeEach(async () => {
    await seed(env.DB);

    // Twelve products that differ only in slug, all stamped with the SAME
    // updated_at. Without the id tiebreaker SQLite is free to order these
    // however it likes, which lets a row appear on two pages or on none.
    const now = 1_756_000_000_000;
    const statements = Array.from({ length: 12 }, (_, i) =>
      env.DB.prepare(
        `INSERT INTO products (id, slug, status, brand_id, primary_category_id, created_at, updated_at)
         VALUES (?1, ?2, 'active', ?3, ?4, ?5, ?5)`,
      ).bind(`prod_page_${i}`, `page-${i}`, IDS.brand, IDS.category, now),
    );
    await env.DB.batch(statements);
  });

  async function idsOnPage(page: number, perPage: number): Promise<string[]> {
    const state = parseTableParams(
      new URLSearchParams(`pagina=${page}&per-pagina=${perPage}`),
      SPEC,
    );
    const { results } = await env.DB.prepare(
      `SELECT p.id ${FROM}
        WHERE p.archived_at IS NULL
        ORDER BY p.updated_at DESC, p.id
        LIMIT ?1 OFFSET ?2`,
    )
      .bind(state.perPage, (state.page - 1) * state.perPage)
      .all<{ id: string }>();
    return results.map((r) => r.id);
  }

  it("never repeats or drops a row across pages of identical timestamps", async () => {
    const total = await env.DB.prepare(
      `SELECT COUNT(*) AS n FROM products WHERE archived_at IS NULL`,
    ).first<{ n: number }>();

    const perPage = 5;
    const pages = Math.ceil(total!.n / perPage);
    const seen: string[] = [];
    for (let page = 1; page <= pages; page += 1) {
      seen.push(...(await idsOnPage(page, perPage)));
    }

    expect(seen).toHaveLength(total!.n);
    expect(new Set(seen).size).toBe(total!.n);
  });

  it("agrees with paginate() about the size of the last page", async () => {
    const total = await env.DB.prepare(
      `SELECT COUNT(*) AS n FROM products WHERE archived_at IS NULL`,
    ).first<{ n: number }>();

    const first = paginate(parseTableParams(new URLSearchParams("per-pagina=5"), SPEC), total!.n);

    // Ask for the last page and check the row count the paginator promised.
    // The last page is the one that is usually short, and therefore the one an
    // off-by-one shows up on.
    const lastState = parseTableParams(
      new URLSearchParams(`per-pagina=5&pagina=${first.totalPages}`),
      SPEC,
    );
    const last = paginate(lastState, total!.n);
    const rows = await idsOnPage(first.totalPages, 5);

    expect(rows).toHaveLength(last.lastRow - last.firstRow + 1);
    expect(last.hasNext).toBe(false);
  });
});
