import { describe, it, expect } from "vitest";
import { parseCsv, detectDelimiter, toCsv } from "~/domain/import/csv";

/**
 * The failure mode here is not a crash — it is a silent misreading that imports
 * a whole catalogue slightly wrong. Most of these tests are about a file that
 * parses "successfully" into the wrong thing.
 */

describe("delimiter detection", () => {
  it("reads a comma-separated file", () => {
    expect(detectDelimiter("sku,nome,prezzo")).toBe(",");
  });

  it("reads a semicolon-separated file", () => {
    // What Italian Excel writes, because the comma is the decimal separator.
    expect(detectDelimiter("sku;nome;prezzo")).toBe(";");
  });

  it("reads a tab-separated file", () => {
    expect(detectDelimiter("sku\tnome\tprezzo")).toBe("\t");
  });

  it("ignores delimiters inside quoted headers", () => {
    // Counting naively picks the comma here and reads the file as one column.
    expect(detectDelimiter('"nome, completo";sku;prezzo')).toBe(";");
  });

  it("falls back to a comma when there is nothing to go on", () => {
    expect(detectDelimiter("sku")).toBe(",");
  });
});

describe("the Italian decimal problem", () => {
  it("keeps a comma decimal intact in a semicolon file", () => {
    // The whole reason delimiter detection exists. Read as comma-separated,
    // this row imports a 39,90 product as two fields: 39 and 90.
    const result = parseCsv("sku;nome;prezzo\nCOV-1;Cover trasparente;39,90");
    expect(result.delimiter).toBe(";");
    expect(result.rows[0]).toEqual({
      sku: "COV-1",
      nome: "Cover trasparente",
      prezzo: "39,90",
    });
  });
});

describe("quoting", () => {
  it("keeps a delimiter inside a quoted field", () => {
    const result = parseCsv('sku,nome\nCOV-1,"Cover, trasparente"');
    expect(result.rows[0]!.nome).toBe("Cover, trasparente");
  });

  it("unescapes a doubled quote", () => {
    // A real product name: Cover 6,7" trasparente.
    const result = parseCsv('sku;nome\nCOV-1;"Cover 6,7"" trasparente"');
    expect(result.rows[0]!.nome).toBe('Cover 6,7" trasparente');
  });

  it("keeps a newline inside a quoted field", () => {
    // A multi-line description from a spreadsheet. Splitting on \n turns one
    // product into three broken rows.
    const result = parseCsv('sku;descrizione\nCOV-1;"Riga uno\nRiga due"');
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]!.descrizione).toBe("Riga uno\nRiga due");
  });
});

describe("what Excel actually produces", () => {
  it("strips the UTF-8 BOM from the first header", () => {
    // Left in place, `sku` becomes `\uFEFFsku`, every row reports a missing SKU,
    // and the file looks perfectly normal in any editor.
    const result = parseCsv("\uFEFFsku;nome\nCOV-1;Cover");
    expect(result.headers).toEqual(["sku", "nome"]);
    expect(result.rows[0]!.sku).toBe("COV-1");
  });

  it("handles CRLF line endings", () => {
    const result = parseCsv("sku;nome\r\nCOV-1;Cover\r\nCOV-2;Cavo\r\n");
    expect(result.rows).toHaveLength(2);
    expect(result.rows[1]!.nome).toBe("Cavo");
  });

  it("ignores trailing blank lines", () => {
    // Excel leaves them behind constantly; each one would otherwise be a row
    // with an empty SKU and a confusing error.
    const result = parseCsv("sku;nome\nCOV-1;Cover\n\n\n");
    expect(result.rows).toHaveLength(1);
  });

  it("normalises header case and whitespace", () => {
    const result = parseCsv(" SKU ; Nome \nCOV-1;Cover");
    expect(result.headers).toEqual(["sku", "nome"]);
  });
});

describe("malformed rows are reported, not guessed at", () => {
  it("refuses a row with too few columns and says which line", () => {
    // A row one column short imports the price into the description. Refusing
    // is the only safe reading, and the line number is the one the merchant
    // sees in their editor.
    const result = parseCsv("sku;nome;prezzo\nCOV-1;Cover;39,90\nCOV-2;Cavo");
    expect(result.rows).toHaveLength(1);
    expect(result.malformed).toEqual([{ rowNumber: 3, got: 2, expected: 3 }]);
  });

  it("refuses a row with too many columns", () => {
    const result = parseCsv("sku;nome\nCOV-1;Cover;extra");
    expect(result.rows).toHaveLength(0);
    expect(result.malformed[0]).toMatchObject({ got: 3, expected: 2 });
  });

  it("returns nothing for an empty file rather than throwing", () => {
    expect(parseCsv("").rows).toEqual([]);
    expect(parseCsv("   \n\n").rows).toEqual([]);
  });

  it("handles a header with no data rows", () => {
    const result = parseCsv("sku;nome");
    expect(result.headers).toEqual(["sku", "nome"]);
    expect(result.rows).toEqual([]);
  });
});

describe("export", () => {
  it("writes semicolon-delimited with a BOM, for Excel", () => {
    // A comma-delimited export opens as a single column in Italian Excel, so a
    // merchant who exports, edits and re-imports loses everything.
    const csv = toCsv(["sku", "nome"], [{ sku: "COV-1", nome: "Cover" }]);
    expect(csv.startsWith("\uFEFF")).toBe(true);
    expect(csv).toContain("sku;nome");
    expect(csv).toContain("COV-1;Cover");
  });

  it("quotes values containing a delimiter, quote or newline", () => {
    const csv = toCsv(["nome"], [{ nome: 'Cover 6,7"; grande' }]);
    expect(csv).toContain('"Cover 6,7""; grande"');
  });

  it("writes an empty string for a missing or null value", () => {
    // Never "null" or "undefined" as text: a merchant re-importing that file
    // would create a product literally named null.
    const csv = toCsv(["sku", "nome"], [{ sku: "COV-1", nome: null }]);
    expect(csv).toContain("COV-1;");
    expect(csv).not.toContain("null");
  });

  it("round-trips through the parser", () => {
    const rows = [
      { sku: "COV-1", nome: 'Cover 6,7" trasparente', prezzo: "39,90" },
      { sku: "CAV-2", nome: "Cavo USB-C; 1m", prezzo: "12,50" },
    ];
    const parsed = parseCsv(toCsv(["sku", "nome", "prezzo"], rows));
    expect(parsed.rows).toEqual(rows);
    expect(parsed.malformed).toEqual([]);
  });
});
