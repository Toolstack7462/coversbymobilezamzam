import { parseAmountToMinorUnits } from "~/domain/pricing/money";

/**
 * Planning a product import.
 *
 * **Nothing is written until the merchant has seen what will happen.** This
 * function produces a plan; a separate step applies it. That separation is the
 * whole design, and it exists because a bulk import is the single most
 * dangerous thing a merchant can do to their own catalogue: one mis-mapped
 * column silently rewrites every price in the shop, and the first sign of it is
 * a customer paying 3,99 for a 39,90 product.
 *
 * So every row is classified before anything happens — create, update,
 * unchanged, or error — and the merchant confirms a summary that says exactly
 * how many of each.
 *
 * Pure over the parsed rows plus a snapshot of what already exists. No
 * database, so every rule below is testable directly.
 */

/** Column names accepted for each field, in the merchant's language. */
const COLUMN_ALIASES: Record<string, readonly string[]> = {
  sku: ["sku", "codice", "codice sku", "cod"],
  name: ["nome", "name", "prodotto", "titolo"],
  price: ["prezzo", "price", "prezzo di vendita"],
  stock: ["giacenza", "quantita", "quantità", "stock", "disponibili", "qta"],
  description: ["descrizione", "description", "descrizione breve"],
  brand: ["marchio", "marca", "brand"],
  category: ["categoria", "category"],
};

export type RowOutcome = "create" | "update" | "unchanged" | "error";

export interface PlannedRow {
  rowNumber: number;
  outcome: RowOutcome;
  sku: string;
  /** What the row would set. Absent fields are left alone on an update. */
  values: {
    name?: string;
    priceMinor?: number;
    stock?: number;
    description?: string;
    brand?: string;
    category?: string;
  };
  /** Why it is an error, or what is unusual about it. */
  message: string | null;
  /** Non-fatal: the row will be applied, but the merchant should look. */
  warning: string | null;
}

export interface ImportPlan {
  rows: PlannedRow[];
  counts: Record<RowOutcome, number>;
  /** Columns in the file that this importer does not understand. */
  unknownColumns: string[];
  /** Required columns that are missing entirely. */
  missingColumns: string[];
  /** True when the plan is safe to apply. */
  applicable: boolean;
}

/** What already exists, so the plan can say create versus update. */
export interface CatalogueSnapshot {
  /** SKU (uppercased) to its current price in minor units and stock. */
  bySku: Map<string, { name: string; priceMinor: number | null; stock: number | null }>;
}

/** Maps a file's headers onto known fields. */
function mapColumns(headers: string[]): {
  mapping: Record<string, string>;
  unknown: string[];
} {
  const mapping: Record<string, string> = {};
  const unknown: string[] = [];

  for (const header of headers) {
    const field = Object.entries(COLUMN_ALIASES).find(([, aliases]) =>
      aliases.includes(header),
    )?.[0];

    if (field === undefined) {
      unknown.push(header);
    } else if (mapping[field] === undefined) {
      mapping[field] = header;
    } else {
      // Two columns claiming the same field. Taking the first silently would
      // make which one wins depend on column order.
      unknown.push(header);
    }
  }

  return { mapping, unknown };
}

export function planProductImport(
  headers: string[],
  rows: Record<string, string>[],
  snapshot: CatalogueSnapshot,
): ImportPlan {
  const { mapping, unknown } = mapColumns(headers);

  // SKU is the only truly required column: it is the identity of the row. A
  // file without it cannot say which product it means.
  const missingColumns = mapping["sku"] === undefined ? ["sku"] : [];

  const planned: PlannedRow[] = [];
  const seenSkus = new Set<string>();

  rows.forEach((row, index) => {
    // Line numbers count the header, matching what the merchant sees.
    const rowNumber = index + 2;
    const get = (field: string) =>
      mapping[field] !== undefined ? (row[mapping[field]!] ?? "").trim() : "";

    const sku = get("sku").toUpperCase();

    if (sku === "") {
      planned.push({
        rowNumber,
        outcome: "error",
        sku: "",
        values: {},
        message: "Manca il codice SKU: senza non si sa a quale prodotto si riferisce la riga.",
        warning: null,
      });
      return;
    }

    if (seenSkus.has(sku)) {
      // Two rows for one product would apply in file order, so the last would
      // silently win. Refusing both halves is the honest reading.
      planned.push({
        rowNumber,
        outcome: "error",
        sku,
        values: {},
        message: `Il codice ${sku} compare più di una volta nel file. Tieni una sola riga per prodotto.`,
        warning: null,
      });
      return;
    }
    seenSkus.add(sku);

    const values: PlannedRow["values"] = {};
    let warning: string | null = null;

    const rawPrice = get("price");
    if (rawPrice !== "") {
      try {
        values.priceMinor = parseAmountToMinorUnits(rawPrice);
      } catch {
        planned.push({
          rowNumber,
          outcome: "error",
          sku,
          values: {},
          message: `Prezzo non leggibile: "${rawPrice}". Usa la forma 39,90.`,
          warning: null,
        });
        return;
      }

      if (values.priceMinor < 0) {
        planned.push({
          rowNumber,
          outcome: "error",
          sku,
          values: {},
          message: "Il prezzo non può essere negativo.",
          warning: null,
        });
        return;
      }
    }

    const rawStock = get("stock");
    if (rawStock !== "") {
      const stock = Number(rawStock.replace(/\s/g, ""));
      if (!Number.isInteger(stock) || stock < 0) {
        planned.push({
          rowNumber,
          outcome: "error",
          sku,
          values: {},
          message: `Quantità non valida: "${rawStock}". Deve essere un numero intero non negativo.`,
          warning: null,
        });
        return;
      }
      values.stock = stock;
    }

    const name = get("name");
    if (name !== "") values.name = name;

    const description = get("description");
    if (description !== "") values.description = description;

    const brand = get("brand");
    if (brand !== "") values.brand = brand;

    const category = get("category");
    if (category !== "") values.category = category;

    const existing = snapshot.bySku.get(sku);

    if (existing === undefined) {
      // A new product needs at least a name; a row with only a SKU would create
      // a product nobody can identify.
      if (values.name === undefined) {
        planned.push({
          rowNumber,
          outcome: "error",
          sku,
          values,
          message: `${sku} non esiste ancora e la riga non ha un nome: non si può creare un prodotto senza nome.`,
          warning: null,
        });
        return;
      }

      planned.push({ rowNumber, outcome: "create", sku, values, message: null, warning: null });
      return;
    }

    // A large price movement is applied, not refused — the merchant may well
    // mean it — but it is surfaced, because it is also what a mis-mapped column
    // looks like.
    if (values.priceMinor !== undefined && existing.priceMinor !== null) {
      const ratio = values.priceMinor / Math.max(existing.priceMinor, 1);
      if (ratio > 3 || ratio < 0.34) {
        warning =
          `Il prezzo cambia molto (da ${(existing.priceMinor / 100).toFixed(2)} ` +
          `a ${(values.priceMinor / 100).toFixed(2)}). Controlla che la colonna sia quella giusta.`;
      }
    }

    const changesNothing =
      (values.name === undefined || values.name === existing.name) &&
      (values.priceMinor === undefined || values.priceMinor === existing.priceMinor) &&
      (values.stock === undefined || values.stock === existing.stock) &&
      values.description === undefined &&
      values.brand === undefined &&
      values.category === undefined;

    planned.push({
      rowNumber,
      outcome: changesNothing ? "unchanged" : "update",
      sku,
      values,
      message: null,
      warning,
    });
  });

  const counts: Record<RowOutcome, number> = {
    create: 0,
    update: 0,
    unchanged: 0,
    error: 0,
  };
  for (const row of planned) counts[row.outcome] += 1;

  return {
    rows: planned,
    counts,
    unknownColumns: unknown,
    missingColumns,
    // A file missing its SKU column cannot be applied at all. Rows with errors
    // do NOT block the rest: refusing an entire 400-row file because one line
    // has a typo is how a merchant gives up and edits the database by hand.
    applicable: missingColumns.length === 0 && counts.create + counts.update > 0,
  };
}
