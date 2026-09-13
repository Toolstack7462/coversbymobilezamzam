/**
 * SQLite -> MariaDB column type decisions.
 *
 * SQLite has one string type and does not care how long a value is. MariaDB
 * does, and the difference is not cosmetic:
 *
 *   - an indexed column must have a bounded length, because InnoDB indexes a
 *     key prefix and `TEXT` has no length to index;
 *   - a VARCHAR chosen too short does not warn, it TRUNCATES — and under the
 *     strict SQL mode this project runs, it errors instead, which is the
 *     behaviour we want and the reason the import rejects rows rather than
 *     silently shortening them.
 *
 * So every text column gets a deliberate length, and the rule that produced it
 * is recorded next to the choice. `npm run hostinger:schema-map` prints the
 * whole table for review; docs/hostinger/mariadb-schema-map.md is its output.
 */

/**
 * Columns whose length is decided by hand, because a name-based rule would get
 * them wrong. Keyed `table.column`, or `*.column` for a column that means the
 * same thing everywhere it appears.
 */
const EXPLICIT = {
  // ── Identifiers ──────────────────────────────────────────────────────────
  // ULIDs are 26 characters. 64 leaves room for the Better Auth ids, which are
  // 32-character nanoids, and for anything a future generator produces, without
  // pushing a four-column index near InnoDB's 3072-byte key limit.
  "*.id": "VARCHAR(64)",

  // ── Better Auth ──────────────────────────────────────────────────────────
  // Token and hash columns are opaque and bounded by the library, not by us.
  "session.token": "VARCHAR(255)",
  "account.access_token": "TEXT",
  "account.refresh_token": "TEXT",
  "account.id_token": "TEXT",
  "account.password": "VARCHAR(255)",
  "account.scope": "VARCHAR(500)",
  "verification.value": "VARCHAR(500)",
  "verification.identifier": "VARCHAR(255)",
  "two_factor.secret": "VARCHAR(500)",
  "two_factor.backup_codes": "TEXT",

  // ── Free text the merchant writes ────────────────────────────────────────
  "*.description": "TEXT",
  "*.short_description": "TEXT",
  "*.full_description": "TEXT",
  "*.body": "MEDIUMTEXT",
  "*.body_it": "MEDIUMTEXT",
  "*.body_en": "MEDIUMTEXT",
  "*.content": "MEDIUMTEXT",
  "*.customer_note": "TEXT",
  "*.note": "TEXT",
  "*.notes": "TEXT",
  "*.reason": "VARCHAR(500)",
  "*.instructions": "TEXT",
  "*.instructions_it": "TEXT",
  "*.instructions_en": "TEXT",

  // ── Machine-written blobs ────────────────────────────────────────────────
  // JSON, serialised as text. Deliberately not MariaDB's JSON alias: the
  // application already parses and validates these, a JSON type would add a
  // CHECK that rejects on write with no better message, and LONGTEXT keeps the
  // bytes identical to what D1 held.
  "*.payload": "MEDIUMTEXT",
  "*.before_json": "MEDIUMTEXT",
  "*.after_json": "MEDIUMTEXT",
  "*.metadata": "MEDIUMTEXT",
  "*.result_payload": "MEDIUMTEXT",
  "*.error_message": "TEXT",
  "*.error_details": "MEDIUMTEXT",
  "*.raw_row": "MEDIUMTEXT",
  "*.user_agent": "VARCHAR(500)",

  // ── Bounded by an external standard ──────────────────────────────────────
  "*.locale": "VARCHAR(10)",
  "*.currency": "VARCHAR(3)",
  "*.country": "VARCHAR(2)",
  "*.province": "VARCHAR(2)",
  "*.postcode": "VARCHAR(20)",
  "*.ip_address": "VARCHAR(45)", // IPv6, fully expanded, with a v4 tail.
  "*.mime_type": "VARCHAR(120)",
  "*.email": "VARCHAR(255)",
  "*.customer_email": "VARCHAR(255)",
  "*.phone": "VARCHAR(40)",
  "*.customer_phone": "VARCHAR(40)",
  "*.file_hash": "VARCHAR(128)",
  "*.object_key": "VARCHAR(512)",
  "*.url": "VARCHAR(1000)",
  "*.image_key": "VARCHAR(512)",
  "*.tracking_token": "VARCHAR(128)",
  "*.token": "VARCHAR(255)",
  "*.token_hash": "VARCHAR(128)",
  "*.value": "TEXT",
  "*.alt_it": "VARCHAR(500)",
  "*.alt_en": "VARCHAR(500)",
  "*.alt_text": "VARCHAR(500)",

  // ── Store settings ───────────────────────────────────────────────────────
  // A setting value can be an IBAN, a paragraph of pickup instructions or an
  // encrypted blob. TEXT, and the key is what gets indexed.
  "store_settings.value": "TEXT",
  "system_settings.value": "TEXT",
  "store_settings.encrypted_value": "TEXT",
};

/**
 * Columns that hold a boolean.
 *
 * Drizzle writes `integer DEFAULT false`, which is how they are recognised;
 * this list is for the ones with no default, where nothing in the DDL says so.
 */
const BOOLEAN_COLUMNS = new Set([
  "verified",
  "customer_visible",
  "is_primary",
  "is_default",
  "is_featured",
  "is_system",
  "active",
  "enabled",
  "published",
  "allow_backorder",
  "available_online",
  "available_for_pickup",
  "eligible_for_shipping",
  "eligible_for_pickup",
  "requires_proof",
  "noindex",
  "in_stock",
  "track_inventory",
]);

/**
 * Integer columns that are epoch milliseconds.
 *
 * They need BIGINT: an epoch-millisecond value is about 1.8e12, and a 32-bit
 * INT stops at 2.1e9 — it would not hold a single timestamp in this schema.
 * Under the strict SQL mode the failure is an error rather than a wrong date,
 * but an error on every insert is not a better outcome.
 */
const TIMESTAMP_SUFFIXES = ["_at", "_until", "_from", "_expires", "_time"];

/** Integer columns whose value is money in minor units. */
const MONEY_SUFFIXES = ["_amount", "_total", "_price", "_cost", "_fee", "_subtotal"];

const SHORT_CODE = 64;
const LABEL = 255;

/**
 * @param {string} table
 * @param {string} column
 * @param {"text" | "integer" | "real" | "blob" | string} sqliteType
 * @param {{ indexed: boolean, defaultValue: string | null }} context
 * @returns {{ type: string, rule: string }}
 */
export function mapColumnType(table, column, sqliteType, context) {
  const explicit = EXPLICIT[`${table}.${column}`] ?? EXPLICIT[`*.${column}`];
  if (explicit) return { type: explicit, rule: "explicit" };

  if (sqliteType === "integer") {
    const isBooleanDefault = context.defaultValue === "true" || context.defaultValue === "false";
    if (isBooleanDefault || BOOLEAN_COLUMNS.has(column)) {
      return { type: "TINYINT(1)", rule: "boolean" };
    }
    if (TIMESTAMP_SUFFIXES.some((s) => column.endsWith(s))) {
      return { type: "BIGINT", rule: "epoch-millis" };
    }
    if (MONEY_SUFFIXES.some((s) => column.endsWith(s)) || column === "amount") {
      // Minor units. BIGINT rather than INT because a minor-unit total has two
      // more digits than the number anyone pictures, and because widening a
      // column on a live table is the one migration worth never needing.
      return { type: "BIGINT", rule: "money-minor-units" };
    }
    return { type: "INT", rule: "integer" };
  }

  if (sqliteType === "real") return { type: "DOUBLE", rule: "real" };
  if (sqliteType === "blob") return { type: "LONGBLOB", rule: "blob" };

  // text
  if (column.endsWith("_id") || column === "id") {
    return { type: "VARCHAR(64)", rule: "identifier" };
  }
  if (context.indexed) {
    // An indexed text column MUST be bounded; TEXT cannot be indexed without a
    // prefix length, and a prefix index changes what UNIQUE means.
    if (
      ["code", "slug", "handle", "sku", "barcode", "key", "status", "type"].some(
        (w) => column === w || column.endsWith(`_${w}`),
      )
    ) {
      return { type: `VARCHAR(${SHORT_CODE})`, rule: "indexed-code" };
    }
    return { type: `VARCHAR(${LABEL})`, rule: "indexed-label" };
  }
  if (
    ["name", "label", "title", "subtitle", "heading"].some(
      (w) => column === w || column.endsWith(`_${w}`),
    )
  ) {
    return { type: `VARCHAR(${LABEL})`, rule: "name" };
  }
  return { type: `VARCHAR(${LABEL})`, rule: "default-label" };
}

export { EXPLICIT, BOOLEAN_COLUMNS };
