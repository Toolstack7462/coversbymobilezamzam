import { describe, it, expect } from "vitest";
import {
  parseTableParams,
  buildTableQuery,
  sortLink,
  ariaSort,
  paginate,
  orderByClause,
  MAX_PER_PAGE,
  DEFAULT_PER_PAGE,
  type TableSpec,
} from "~/lib/table-params";

/**
 * Query strings arrive from bookmarks, from colleagues' links and from
 * hand-editing. These tests are mostly about what happens when the URL is
 * wrong, because that is the case that reaches SQL.
 */

const SPEC: TableSpec = {
  views: ["tutti", "da-verificare", "in-verifica"],
  sortable: ["created_at", "total", "customer"],
  defaultSort: { key: "created_at", direction: "desc" },
  facets: { consegna: ["ritiro", "spedizione"] },
};

const parse = (qs: string) => parseTableParams(new URLSearchParams(qs), SPEC);

describe("parsing defends against the URL", () => {
  it("falls back to the first view for an unknown one", () => {
    expect(parse("vista=inventata").view).toBe("tutti");
  });

  it("ignores an undeclared sort key rather than passing it on", () => {
    // The failure this prevents: a sort key reaching a query builder.
    expect(parse("ordina=password").sort).toEqual({ key: "created_at", direction: "desc" });
  });

  it("reads the leading minus as descending", () => {
    expect(parse("ordina=-total").sort).toEqual({ key: "total", direction: "desc" });
    expect(parse("ordina=total").sort).toEqual({ key: "total", direction: "asc" });
  });

  it("caps page size", () => {
    // ?per-pagina=100000 over D1 is a cheap way to time out the Worker.
    expect(parse("per-pagina=100000").perPage).toBe(MAX_PER_PAGE);
    expect(parse("per-pagina=-5").perPage).toBe(DEFAULT_PER_PAGE);
    expect(parse("per-pagina=abc").perPage).toBe(DEFAULT_PER_PAGE);
    expect(parse("per-pagina=50").perPage).toBe(50);
  });

  it("refuses a page below one", () => {
    expect(parse("pagina=0").page).toBe(1);
    expect(parse("pagina=-3").page).toBe(1);
    expect(parse("pagina=abc").page).toBe(1);
    expect(parse("pagina=4").page).toBe(4);
  });

  it("drops a facet value that was never declared", () => {
    expect(parse("consegna=teletrasporto").filters).toEqual({});
    expect(parse("consegna=ritiro").filters).toEqual({ consegna: "ritiro" });
  });

  it("normalises search whitespace", () => {
    expect(parse("q=%20%20iphone%20%20%2015%20").q).toBe("iphone 15");
  });
});

describe("building keeps one canonical URL per list", () => {
  it("omits every default, so the plain list has a clean address", () => {
    expect(buildTableQuery(parse(""), SPEC)).toBe("");
  });

  it("round-trips a non-default state", () => {
    const state = parse("vista=da-verificare&ordina=total&pagina=3&consegna=ritiro&q=cover");
    const rebuilt = buildTableQuery(state, SPEC);
    expect(parseTableParams(new URLSearchParams(rebuilt), SPEC)).toEqual(state);
  });

  it("drops the sort parameter when it matches the default", () => {
    expect(buildTableQuery(parse("ordina=-created_at"), SPEC)).toBe("");
  });
});

describe("sorting links", () => {
  it("flips direction on the active column", () => {
    const ascending = parse("ordina=total");
    expect(sortLink(ascending, SPEC, "total")).toContain("ordina=-total");
  });

  it("starts a different column ascending", () => {
    const state = parse("ordina=-total");
    expect(sortLink(state, SPEC, "customer")).toContain("ordina=customer");
  });

  it("returns to page one when the sort changes", () => {
    // Staying on page 7 of a differently ordered list shows rows nobody asked
    // for and looks like data loss.
    const state = parse("pagina=7&ordina=total");
    expect(sortLink(state, SPEC, "customer")).not.toContain("pagina");
  });

  it("preserves the view, the search and the facets", () => {
    const state = parse("vista=da-verificare&q=cover&consegna=ritiro");
    const link = sortLink(state, SPEC, "total");
    expect(link).toContain("vista=da-verificare");
    expect(link).toContain("q=cover");
    expect(link).toContain("consegna=ritiro");
  });

  it("reports aria-sort as none on inactive columns", () => {
    const state = parse("ordina=-total");
    expect(ariaSort(state, "total")).toBe("descending");
    expect(ariaSort(state, "customer")).toBe("none");
  });
});

describe("pagination", () => {
  it("describes an ordinary middle page", () => {
    const p = paginate(parse("pagina=2&per-pagina=25"), 120);
    expect(p).toMatchObject({
      page: 2,
      totalPages: 5,
      offset: 25,
      hasPrevious: true,
      hasNext: true,
      firstRow: 26,
      lastRow: 50,
    });
  });

  it("clamps a bookmark to a page that no longer exists", () => {
    // The list shrank. Show the last page of results, not a silent empty table.
    const p = paginate(parse("pagina=9"), 30);
    expect(p.page).toBe(2);
    expect(p.hasNext).toBe(false);
  });

  it("stays coherent with no rows at all", () => {
    const p = paginate(parse(""), 0);
    expect(p).toMatchObject({
      page: 1,
      totalPages: 1,
      firstRow: 0,
      lastRow: 0,
      hasPrevious: false,
      hasNext: false,
    });
  });

  it("does not claim more rows than exist on the last page", () => {
    const p = paginate(parse("pagina=3&per-pagina=25"), 51);
    expect(p.lastRow).toBe(51);
  });
});

describe("orderByClause", () => {
  const COLUMNS = { created_at: "o.created_at", total: "o.grand_total" };

  it("maps a declared key to its column", () => {
    expect(orderByClause({ key: "total", direction: "desc" }, COLUMNS, "o.id ASC")).toBe(
      "o.grand_total DESC",
    );
  });

  it("falls back rather than emitting an unordered page", () => {
    // SQLite without ORDER BY is not stable across pages: rows repeat or vanish.
    expect(orderByClause({ key: "sneaky", direction: "asc" }, COLUMNS, "o.id ASC")).toBe(
      "o.id ASC",
    );
    expect(orderByClause(null, COLUMNS, "o.id ASC")).toBe("o.id ASC");
  });

  it("emits only ASC or DESC, never the caller's text", () => {
    const clause = orderByClause({ key: "total", direction: "asc" }, COLUMNS, "o.id ASC");
    expect(clause).toMatch(/^o\.grand_total (ASC|DESC)$/);
  });
});
