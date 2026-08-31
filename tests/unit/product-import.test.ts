import { describe, it, expect } from "vitest";
import { planProductImport, type CatalogueSnapshot } from "~/domain/import/product-import";
import { parseCsv } from "~/domain/import/csv";

/**
 * A bulk import is the most dangerous thing a merchant can do to their own
 * catalogue: one mis-mapped column silently rewrites every price, and the first
 * sign of it is a customer paying 3,99 for a 39,90 product.
 *
 * So the plan is produced and shown BEFORE anything is written, and these tests
 * are mostly about the plan telling the truth.
 */

const snapshot = (
  entries: [string, { name: string; priceMinor: number | null; stock: number | null }][] = [],
): CatalogueSnapshot => ({ bySku: new Map(entries) });

/** Plans straight from CSV text, the way the route will. */
const planFrom = (csv: string, existing: CatalogueSnapshot = snapshot()) => {
  const parsed = parseCsv(csv);
  return planProductImport(parsed.headers, parsed.rows, existing);
};

describe("classifying rows", () => {
  it("plans a create for an unknown SKU", () => {
    const plan = planFrom("sku;nome;prezzo\nNEW-1;Cover nuova;19,90");
    expect(plan.counts).toMatchObject({ create: 1, update: 0, unchanged: 0, error: 0 });
    expect(plan.rows[0]!.values).toMatchObject({ name: "Cover nuova", priceMinor: 1990 });
  });

  it("plans an update for a known SKU with a changed value", () => {
    const existing = snapshot([["OLD-1", { name: "Cover", priceMinor: 1990, stock: 5 }]]);
    const plan = planFrom("sku;prezzo\nOLD-1;24,90", existing);
    expect(plan.counts).toMatchObject({ update: 1, create: 0 });
    expect(plan.rows[0]!.values.priceMinor).toBe(2490);
  });

  it("plans nothing for a row that changes nothing", () => {
    // Re-importing an unchanged export must be a no-op, or a merchant checking
    // their file would rewrite their whole catalogue for no reason.
    const existing = snapshot([["SAME-1", { name: "Cover", priceMinor: 1990, stock: 5 }]]);
    const plan = planFrom("sku;nome;prezzo;giacenza\nSAME-1;Cover;19,90;5", existing);
    expect(plan.counts).toMatchObject({ unchanged: 1, update: 0 });
  });

  it("leaves absent columns alone rather than blanking them", () => {
    // A file with only sku and prezzo must not erase every product's name.
    const existing = snapshot([["KEEP-1", { name: "Cover", priceMinor: 1990, stock: 5 }]]);
    const plan = planFrom("sku;prezzo\nKEEP-1;24,90", existing);
    expect(plan.rows[0]!.values.name).toBeUndefined();
    expect(plan.rows[0]!.values.stock).toBeUndefined();
  });
});

describe("column names in the merchant's language", () => {
  it("accepts Italian headers", () => {
    const plan = planFrom("codice;nome;prezzo;giacenza\nIT-1;Cover;19,90;3");
    expect(plan.missingColumns).toEqual([]);
    expect(plan.rows[0]!.values).toMatchObject({ name: "Cover", priceMinor: 1990, stock: 3 });
  });

  it("accepts English headers", () => {
    const plan = planFrom("sku;name;price;stock\nEN-1;Cover;19,90;3");
    expect(plan.rows[0]!.values).toMatchObject({ name: "Cover", priceMinor: 1990 });
  });

  it("accepts quantità with and without its accent", () => {
    expect(planFrom("sku;quantità\nQ-1;4").rows[0]!.values.stock).toBe(4);
    expect(planFrom("sku;quantita\nQ-2;4").rows[0]!.values.stock).toBe(4);
  });

  it("reports columns it does not understand rather than ignoring them", () => {
    // Silently dropping a column is how a merchant discovers their supplier's
    // "prezzo_acquisto" was never imported, three months later.
    const plan = planFrom("sku;nome;colonna_strana\nX-1;Cover;valore");
    expect(plan.unknownColumns).toContain("colonna_strana");
  });

  it("refuses a file with no SKU column at all", () => {
    const plan = planFrom("nome;prezzo\nCover;19,90");
    expect(plan.missingColumns).toEqual(["sku"]);
    expect(plan.applicable).toBe(false);
  });
});

describe("rows that cannot be applied", () => {
  it("rejects a row with no SKU", () => {
    const plan = planFrom("sku;nome\n;Cover senza codice");
    expect(plan.rows[0]!.outcome).toBe("error");
    expect(plan.rows[0]!.message).toContain("SKU");
  });

  it("rejects a duplicate SKU rather than letting the last row win", () => {
    // Applying both in file order means whichever is last silently wins, which
    // depends on how the merchant happened to sort their spreadsheet.
    //
    // The SKU is seeded as existing so the FIRST row is a clean update: this
    // test is about the duplicate, not about a new product needing a name.
    const existing = snapshot([["DUP-1", { name: "Cover", priceMinor: 500, stock: 1 }]]);
    const plan = planFrom("sku;prezzo\nDUP-1;10,00\nDUP-1;20,00", existing);

    expect(plan.rows[0]!.outcome).toBe("update");
    expect(plan.rows[1]!.outcome).toBe("error");
    expect(plan.rows[1]!.message).toContain("più di una volta");
    expect(plan.counts.error).toBe(1);
  });

  it("rejects an unreadable price and says what a good one looks like", () => {
    const plan = planFrom("sku;prezzo\nBAD-1;venti euro");
    expect(plan.rows[0]!.outcome).toBe("error");
    expect(plan.rows[0]!.message).toContain("39,90");
  });

  it("rejects a negative price and a fractional quantity", () => {
    expect(planFrom("sku;prezzo\nNEG-1;-5,00").rows[0]!.outcome).toBe("error");
    expect(planFrom("sku;giacenza\nFRAC-1;2,5").rows[0]!.outcome).toBe("error");
  });

  it("refuses to create a product with no name", () => {
    const plan = planFrom("sku;prezzo\nNONAME-1;19,90");
    expect(plan.rows[0]!.outcome).toBe("error");
    expect(plan.rows[0]!.message).toContain("nome");
  });

  it("does not let one bad row block the whole file", () => {
    // Refusing 400 good rows because line 87 has a typo is how a merchant gives
    // up and edits the database by hand.
    const plan = planFrom(
      "sku;nome;prezzo\nOK-1;Cover;19,90\nBAD-1;Cavo;non un prezzo\nOK-2;Pellicola;9,90",
    );
    expect(plan.counts).toMatchObject({ create: 2, error: 1 });
    expect(plan.applicable).toBe(true);
  });
});

describe("warnings", () => {
  it("flags a large price movement without blocking it", () => {
    // The merchant may well mean it — but this is also exactly what a
    // mis-mapped column looks like.
    const existing = snapshot([["WARN-1", { name: "Cover", priceMinor: 3990, stock: 1 }]]);
    const plan = planFrom("sku;prezzo\nWARN-1;3,99", existing);

    expect(plan.rows[0]!.outcome).toBe("update");
    expect(plan.rows[0]!.warning).toContain("cambia molto");
  });

  it("says nothing about an ordinary price change", () => {
    const existing = snapshot([["OK-1", { name: "Cover", priceMinor: 1990, stock: 1 }]]);
    expect(planFrom("sku;prezzo\nOK-1;21,90", existing).rows[0]!.warning).toBeNull();
  });
});

describe("the summary a merchant confirms", () => {
  it("counts every outcome", () => {
    const existing = snapshot([
      ["UPD-1", { name: "Cover", priceMinor: 1990, stock: 5 }],
      ["SAME-1", { name: "Cavo", priceMinor: 1000, stock: 2 }],
    ]);
    const plan = planFrom(
      "sku;nome;prezzo\nNEW-1;Nuovo;5,00\nUPD-1;Cover;29,90\nSAME-1;Cavo;10,00\n;Senza codice;1,00",
      existing,
    );

    expect(plan.counts).toEqual({ create: 1, update: 1, unchanged: 1, error: 1 });
  });

  it("is not applicable when nothing would change", () => {
    // A confirm button that does nothing is worse than no button.
    const existing = snapshot([["SAME-1", { name: "Cover", priceMinor: 1990, stock: 5 }]]);
    const plan = planFrom("sku;nome;prezzo;giacenza\nSAME-1;Cover;19,90;5", existing);
    expect(plan.applicable).toBe(false);
  });

  it("numbers rows the way the merchant's editor does", () => {
    // Line 1 is the header, so the first data row is line 2.
    const plan = planFrom("sku;nome\nA-1;Uno\nB-2;Due");
    expect(plan.rows.map((r) => r.rowNumber)).toEqual([2, 3]);
  });
});
