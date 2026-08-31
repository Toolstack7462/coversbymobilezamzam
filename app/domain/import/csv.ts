/**
 * CSV parsing.
 *
 * Written rather than taken from a library for one reason: the failure that
 * matters here is not a crash, it is a **silent misreading**, and a library
 * configured wrongly misreads just as quietly as no library at all.
 *
 * **The delimiter problem.** Italian Excel writes CSV with `;` as the field
 * separator, because `,` is the decimal separator in Italian locales. A parser
 * that assumes `,` reads the whole line as one field and reports "1 column";
 * worse, a parser that assumes `,` on a file that uses `,` but writes prices as
 * `39,90` splits every price in half and imports 39 euro products as 39 and 90.
 * So the delimiter is DETECTED, and the detection is tested.
 *
 * **The BOM problem.** Excel prefixes UTF-8 files with a byte-order mark. Left
 * in place it becomes part of the first header name, so `sku` silently becomes
 * `\uFEFFsku` and every row reports a missing SKU while the file looks correct
 * in every editor.
 *
 * **The quoting problem.** A product called `Cover 6,7" trasparente` contains
 * both the delimiter and a quote. RFC 4180 quoting handles it; naive splitting
 * does not, and the row lands one column out of alignment — which imports the
 * price into the description and the description into the price.
 *
 * Pure: text in, rows out. No file handling, no database.
 */

export type Delimiter = "," | ";" | "\t";

export interface CsvParseResult {
  /** Header names, trimmed and lower-cased. */
  headers: string[];
  /** One record per data row, keyed by header. */
  rows: Record<string, string>[];
  delimiter: Delimiter;
  /** Rows whose column count did not match the header. */
  malformed: { rowNumber: number; got: number; expected: number }[];
}

/**
 * Guesses the delimiter by counting candidates OUTSIDE quotes on the header
 * line.
 *
 * Outside quotes matters: a header like `"nome, completo";sku` has more commas
 * than semicolons, and counting naively picks the wrong one.
 */
export function detectDelimiter(firstLine: string): Delimiter {
  const counts: Record<Delimiter, number> = { ",": 0, ";": 0, "\t": 0 };

  let inQuotes = false;
  for (let i = 0; i < firstLine.length; i += 1) {
    const char = firstLine[i]!;
    if (char === '"') {
      // A doubled quote inside a quoted field is an escaped quote, not a close.
      if (inQuotes && firstLine[i + 1] === '"') {
        i += 1;
        continue;
      }
      inQuotes = !inQuotes;
      continue;
    }
    if (!inQuotes && (char === "," || char === ";" || char === "\t")) {
      counts[char] += 1;
    }
  }

  // Semicolon wins ties: this shop's merchant uses Italian Excel, and a file
  // with equal counts is far more likely to be semicolon-separated with commas
  // inside decimal numbers than the reverse.
  if (counts[";"] >= counts[","] && counts[";"] >= counts["\t"] && counts[";"] > 0) return ";";
  if (counts["\t"] > counts[","]) return "\t";
  return ",";
}

/** Splits one line into fields, honouring RFC 4180 quoting. */
function splitLine(line: string, delimiter: Delimiter): string[] {
  const fields: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const char = line[i]!;

    if (inQuotes) {
      if (char === '"') {
        if (line[i + 1] === '"') {
          current += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        current += char;
      }
      continue;
    }

    if (char === '"') {
      inQuotes = true;
    } else if (char === delimiter) {
      fields.push(current);
      current = "";
    } else {
      current += char;
    }
  }

  fields.push(current);
  return fields;
}

/**
 * Splits the text into logical lines.
 *
 * A quoted field may contain a newline — a multi-line product description
 * exported from a spreadsheet routinely does — so lines cannot be found by
 * splitting on `\n`. Doing that turns one product into three broken rows.
 */
function splitLines(text: string): string[] {
  const lines: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i]!;

    if (char === '"') {
      if (inQuotes && text[i + 1] === '"') {
        current += '""';
        i += 1;
        continue;
      }
      inQuotes = !inQuotes;
      current += char;
      continue;
    }

    if (!inQuotes && (char === "\n" || char === "\r")) {
      // Swallow the \n of a \r\n pair rather than emitting an empty line.
      if (char === "\r" && text[i + 1] === "\n") i += 1;
      lines.push(current);
      current = "";
      continue;
    }

    current += char;
  }

  if (current !== "") lines.push(current);
  return lines;
}

export function parseCsv(text: string): CsvParseResult {
  // Strip the UTF-8 BOM. Left in place it becomes part of the first header,
  // so `sku` becomes `\uFEFFsku` and every row reports a missing SKU while the
  // file looks perfectly normal in any editor.
  const clean = text.replace(/^\uFEFF/, "");

  const lines = splitLines(clean).filter((line) => line.trim() !== "");
  if (lines.length === 0) {
    return { headers: [], rows: [], delimiter: ",", malformed: [] };
  }

  const delimiter = detectDelimiter(lines[0]!);
  const headers = splitLine(lines[0]!, delimiter).map((h) => h.trim().toLowerCase());

  const rows: Record<string, string>[] = [];
  const malformed: CsvParseResult["malformed"] = [];

  for (let i = 1; i < lines.length; i += 1) {
    const fields = splitLine(lines[i]!, delimiter);

    if (fields.length !== headers.length) {
      // Reported rather than guessed at. A row one column out of alignment
      // imports the price into the description; refusing it is the only safe
      // reading. `i + 1` is the line number a merchant sees in their editor.
      malformed.push({ rowNumber: i + 1, got: fields.length, expected: headers.length });
      continue;
    }

    const record: Record<string, string> = {};
    headers.forEach((header, index) => {
      record[header] = (fields[index] ?? "").trim();
    });
    rows.push(record);
  }

  return { headers, rows, delimiter, malformed };
}

/**
 * Serialises rows back to CSV.
 *
 * Always semicolon-delimited with a BOM, because the file is going to be opened
 * in Italian Excel. A comma-delimited export opens as a single column there,
 * and a merchant who exports, edits and re-imports would lose everything.
 */
export function toCsv(headers: string[], rows: Record<string, string | number | null>[]): string {
  const escape = (value: string | number | null): string => {
    const text = value === null ? "" : String(value);
    // Quote when the value contains the delimiter, a quote or a newline.
    return /[;"\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };

  const lines = [headers.join(";")];
  for (const row of rows) {
    lines.push(headers.map((header) => escape(row[header] ?? "")).join(";"));
  }

  // CRLF and a BOM: what Excel expects, and what makes accented characters
  // render correctly rather than as mojibake.
  return `\uFEFF${lines.join("\r\n")}\r\n`;
}
