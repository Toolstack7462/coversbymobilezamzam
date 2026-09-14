/**
 * What a product of a given kind needs to be described.
 *
 * ── THE PROBLEM ─────────────────────────────────────────────────────────────
 *
 * A phone case, a charger and a cable are not the same kind of thing and cannot
 * be described by the same form. A charger has a wattage; a case does not. A
 * cable has a length and two connectors; neither of the others does. A power
 * bank has a capacity in mAh, and asking a merchant for the mAh of a screen
 * protector is asking them to leave a field blank and wonder whether they were
 * supposed to.
 *
 * The database already knew this — `product_variants` carries `capacity_mah`,
 * `length_mm`, `connector`, `pack_size`, `weight_grams` and `dimensions_mm` —
 * and the admin never surfaced ANY of them. Every one of those columns was
 * unreachable through the interface, so the specification a customer most wants
 * ("is this 20 W or 65 W?") could only be put in the free-text description, or
 * not at all.
 *
 * ── WHY A TABLE AND NOT A FORM PER TYPE ─────────────────────────────────────
 *
 * Nine accessory types and six possible fields is fifty-four decisions. Written
 * as nine forms they drift: the charger form grows a field, the car-charger
 * form does not, and nobody notices until a customer asks. Written as a table
 * they are one screen of data that can be read at a glance and argued with.
 *
 * It also means the SAME definition drives the editor, the validation and the
 * tests. A form that shows a field the action does not save is worse than no
 * field, because it looks like it worked.
 *
 * ── WHAT THIS IS NOT ────────────────────────────────────────────────────────
 *
 * Not a product-type system with inheritance, custom attributes or a schema
 * editor. Those are for a catalogue nobody can enumerate. This catalogue has
 * twenty-six products in nine known kinds, and a table of nine rows is the
 * honest size of the problem.
 */

/**
 * The accessory types, exactly as `products.accessory_type` stores them.
 *
 * The column is a free-text VARCHAR rather than an enum, so a value outside
 * this list is possible and is handled rather than assumed away — a product
 * imported with an unknown type gets no specification fields and a plain note
 * saying so, instead of a crash or a silently empty section.
 */
export const ACCESSORY_TYPES = [
  "case",
  "screen_protector",
  "charger",
  "cable",
  "powerbank",
  "audio",
  "car_mount",
  "magsafe",
  "other",
] as const;

export type AccessoryType = (typeof ACCESSORY_TYPES)[number];

/** Italian, because the admin is Italian and these are what the merchant calls them. */
export const ACCESSORY_TYPE_LABELS: Record<AccessoryType, string> = {
  case: "Cover e custodie",
  screen_protector: "Pellicole e vetri",
  charger: "Caricabatterie",
  cable: "Cavi",
  powerbank: "Power bank",
  audio: "Audio e auricolari",
  car_mount: "Supporti auto",
  magsafe: "MagSafe e magnetici",
  other: "Altro",
};

export function isAccessoryType(value: unknown): value is AccessoryType {
  return typeof value === "string" && (ACCESSORY_TYPES as readonly string[]).includes(value);
}

export function accessoryTypeLabel(value: string | null): string {
  return isAccessoryType(value) ? ACCESSORY_TYPE_LABELS[value] : "Tipo non impostato";
}

/**
 * A field the merchant can fill in, and the column it is stored in.
 *
 * `column` is the real `product_variants` column name. Keeping it here rather
 * than mapping it in the route means the route can build its SQL from this
 * definition and cannot write a field the definition does not know about —
 * which is also why the column list is checked against an allowlist before it
 * reaches a statement.
 */
export interface SpecField {
  /** The `product_variants` column. */
  column: SpecColumn;
  /** Italian label, shown to the merchant. */
  label: string;
  kind: "integer" | "text";
  /** Shown after the input, e.g. "mAh". Never part of the stored value. */
  unit?: string;
  /** One line under the field. Says what to type, not what the field is. */
  help?: string;
  min?: number;
  max?: number;
  maxLength?: number;
}

/**
 * Every column a specification field may write.
 *
 * An allowlist rather than a convention. The editor builds an UPDATE from the
 * fields a type declares, and a column name that came from anywhere but this
 * list must never reach a statement.
 */
export const SPEC_COLUMNS = [
  "capacity_mah",
  "length_mm",
  "connector",
  "pack_size",
  "weight_grams",
  "dimensions_mm",
] as const;

export type SpecColumn = (typeof SPEC_COLUMNS)[number];

const FIELD: Record<SpecColumn, SpecField> = {
  capacity_mah: {
    column: "capacity_mah",
    label: "Capacità",
    kind: "integer",
    unit: "mAh",
    help: "Solo il numero, come stampato sulla confezione. Esempio: 10000",
    min: 1,
    max: 1_000_000,
  },
  length_mm: {
    column: "length_mm",
    label: "Lunghezza",
    kind: "integer",
    unit: "mm",
    help: "In millimetri. Un cavo da 1 metro è 1000.",
    min: 1,
    max: 100_000,
  },
  connector: {
    column: "connector",
    label: "Connettori",
    kind: "text",
    help: "Esempio: USB-C a Lightning",
    maxLength: 60,
  },
  pack_size: {
    column: "pack_size",
    label: "Pezzi nella confezione",
    kind: "integer",
    help: "1 se il prodotto è singolo.",
    min: 1,
    max: 1000,
  },
  weight_grams: {
    column: "weight_grams",
    label: "Peso",
    kind: "integer",
    unit: "g",
    help: "In grammi.",
    min: 1,
    max: 100_000,
  },
  dimensions_mm: {
    column: "dimensions_mm",
    label: "Dimensioni",
    kind: "text",
    help: "Esempio: 160 × 78 × 9",
    maxLength: 40,
  },
};

/**
 * Which fields each kind of product needs. The whole point of the file.
 *
 * Read it as a claim that can be wrong and corrected, not as a definition:
 *
 *   - A **case** is described by what it fits, which lives in compatibility,
 *     not here. Dimensions help a customer comparing bulk. Nothing else.
 *   - A **screen protector** is sold in packs more often than not, so pack size
 *     is the field people actually want.
 *   - A **charger's** wattage is the question customers ask first — and there
 *     is no wattage column. It is recorded in `connector` today ("USB-C 20 W"),
 *     which is a compromise noted in §"Known compromises" below rather than a
 *     column invented in a migration nobody asked for.
 *   - A **cable** is length and connectors, in that order of importance.
 *   - A **power bank** is capacity first, then weight, because a 20,000 mAh
 *     brick that weighs 500 g is a different product from one that weighs 300.
 *   - **Audio**, **car mounts** and **MagSafe** accessories have no dominant
 *     numeric specification, so they get weight and dimensions and nothing
 *     invented.
 */
const TEMPLATES: Record<AccessoryType, readonly SpecColumn[]> = {
  case: ["dimensions_mm", "weight_grams"],
  screen_protector: ["pack_size", "dimensions_mm"],
  charger: ["connector", "weight_grams"],
  cable: ["length_mm", "connector"],
  powerbank: ["capacity_mah", "weight_grams", "dimensions_mm"],
  audio: ["weight_grams", "dimensions_mm"],
  car_mount: ["weight_grams", "dimensions_mm"],
  magsafe: ["weight_grams", "dimensions_mm"],
  other: ["weight_grams", "dimensions_mm"],
};

/**
 * The fields to show for a product of this type.
 *
 * An unknown or absent type returns NOTHING rather than a default set. A form
 * that guesses which fields a product needs is a form that collects the wrong
 * data confidently; the editor shows a line telling the merchant to choose a
 * type first, which is a thing they can act on.
 */
export function specFieldsFor(accessoryType: string | null): SpecField[] {
  if (!isAccessoryType(accessoryType)) return [];
  return TEMPLATES[accessoryType].map((column) => FIELD[column]);
}

/** True when this column belongs to this type. The write-side guard. */
export function specColumnAllowed(accessoryType: string | null, column: string): boolean {
  if (!isAccessoryType(accessoryType)) return false;
  return (TEMPLATES[accessoryType] as readonly string[]).includes(column);
}

export type SpecValue = number | string | null;

export interface SpecParseResult {
  values: Partial<Record<SpecColumn, SpecValue>>;
  errors: string[];
}

/**
 * Reads submitted specification values for one variant.
 *
 * Three rules, and each exists because of a way this goes wrong:
 *
 *   - A field the TYPE does not declare is ignored, not saved. Otherwise a
 *     crafted form could write `capacity_mah` onto a phone case.
 *   - An empty value clears the column. A merchant who deletes a wrong number
 *     and saves must end up with no number, not with the old one.
 *   - A non-numeric or out-of-range number is an ERROR, not a silent `null`.
 *     `Number("abc")` is `NaN` and `NaN` stored as an integer is a quiet zero,
 *     which is a real specification that happens to be wrong.
 */
export function parseSpecValues(
  accessoryType: string | null,
  read: (name: string) => string | null,
): SpecParseResult {
  const values: Partial<Record<SpecColumn, SpecValue>> = {};
  const errors: string[] = [];

  for (const field of specFieldsFor(accessoryType)) {
    const raw = (read(field.column) ?? "").trim();

    if (raw === "") {
      values[field.column] = null;
      continue;
    }

    if (field.kind === "integer") {
      /*
       * Italian number formatting, without guessing.
       *
       * A merchant typing "10.000" means ten thousand: the dot is a thousands
       * separator here, not a decimal point. So it is stripped — but ONLY when
       * the dots actually form thousands groups.
       *
       * Stripping every dot unconditionally is the trap: "1.5" would become
       * "15" and be stored as a perfectly plausible wrong number. A value that
       * is not grouped keeps its dot, fails the integer check, and the merchant
       * is told rather than surprised.
       */
      const spaceless = raw.replace(/\s/g, "");
      const grouped = /^\d{1,3}(\.\d{3})+$/.test(spaceless);
      const normalised = (grouped ? spaceless.replace(/\./g, "") : spaceless).replace(",", ".");
      const parsed = Number(normalised);
      if (!Number.isFinite(parsed) || !Number.isInteger(parsed)) {
        errors.push(`${field.label}: inserire un numero intero.`);
        continue;
      }
      if (field.min !== undefined && parsed < field.min) {
        errors.push(`${field.label}: il minimo è ${field.min}.`);
        continue;
      }
      if (field.max !== undefined && parsed > field.max) {
        errors.push(`${field.label}: il massimo è ${field.max}.`);
        continue;
      }
      values[field.column] = parsed;
      continue;
    }

    if (field.maxLength !== undefined && raw.length > field.maxLength) {
      errors.push(`${field.label}: massimo ${field.maxLength} caratteri.`);
      continue;
    }
    values[field.column] = raw;
  }

  return { values, errors };
}
