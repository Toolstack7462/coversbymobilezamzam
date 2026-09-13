/**
 * Emits the MariaDB schema from the parsed D1 migrations.
 *
 * Two things here are not mechanical translation, and both are called out in
 * the output so a reviewer sees them rather than discovering them later.
 *
 * 1. PARTIAL UNIQUE INDEXES. SQLite can say "unique among the rows where
 *    variant_id IS NULL". MariaDB cannot. The pair of partial indexes on
 *    product_specifications and product_compatibility is what enforces
 *    "one specification per product, and one per variant that overrides it",
 *    and dropping to an ordinary nullable composite UNIQUE would enforce
 *    nothing at all: in both engines, NULLs are distinct in a UNIQUE index, so
 *    the same product-level row could be inserted any number of times.
 *
 *    The replacement is a generated scope column, `COALESCE(variant_id, '')`,
 *    with a single UNIQUE index over it and a CHECK that a real variant_id is
 *    never the empty string. That makes NULL a VALUE rather than an absence,
 *    which is precisely what the partial index was simulating.
 *
 * 2. FTS5. There is no virtual table and no external-content index in MariaDB.
 *    Search moves to a materialised document table with a FULLTEXT index; see
 *    0002_search.sql for why it is a table the application maintains rather
 *    than more triggers.
 */

import { mapColumnType } from "./type-map.mjs";

const q = (name) => "`" + name + "`";

/**
 * Partial unique indexes, and the scope column that replaces each pair.
 *
 * Keyed by table. `nullableColumn` is the column the SQLite predicate tested;
 * `scopeColumn` is the generated column that replaces it in the index.
 */
export const SCOPE_REPLACEMENTS = {
  product_specifications: {
    nullableColumn: "variant_id",
    scopeColumn: "variant_scope",
    indexName: "product_specifications_scope_unique",
    keyColumns: ["product_id", "variant_scope", "spec_key"],
    replaces: ["product_specifications_variant_unique", "product_specifications_product_unique"],
  },
  product_compatibility: {
    nullableColumn: "variant_id",
    scopeColumn: "variant_scope",
    indexName: "product_compatibility_scope_unique",
    keyColumns: ["product_id", "variant_scope", "device_model_id"],
    replaces: ["product_compatibility_variant_unique", "product_compatibility_product_unique"],
  },
};

/**
 * Tables that exist only to serve SQLite's FTS5 and have no MariaDB equivalent.
 * `product_search_map` survives — see 0002_search.sql.
 */
export const FTS_ARTEFACTS = new Set(["product_search"]);

export function buildSchema(model) {
  const { tables, indexes } = model;

  const indexedColumns = new Map();
  for (const index of indexes) {
    for (const column of index.columns) {
      const key = `${index.table}.${column}`;
      indexedColumns.set(key, true);
    }
  }
  // Foreign keys are indexed by InnoDB whether or not anybody asked, so the
  // referencing column needs a bounded type for the same reason.
  for (const table of tables) {
    for (const fk of table.foreignKeys) {
      for (const column of fk.columns) indexedColumns.set(`${table.name}.${column}`, true);
      for (const column of fk.refColumns) indexedColumns.set(`${fk.table}.${column}`, true);
    }
  }

  const decisions = [];
  const statements = [];

  for (const table of tables) {
    if (FTS_ARTEFACTS.has(table.name)) continue;

    const scope = SCOPE_REPLACEMENTS[table.name];
    const lines = [];

    for (const column of table.columns) {
      const mapped = mapColumnType(table.name, column.name, column.type, {
        indexed: indexedColumns.has(`${table.name}.${column.name}`),
        defaultValue: column.default,
      });
      decisions.push({
        table: table.name,
        column: column.name,
        from: column.type,
        to: mapped.type,
        rule: mapped.rule,
        notNull: column.notNull,
        default: column.default,
      });

      let line = `  ${q(column.name)} ${mapped.type}`;
      if (column.notNull) line += " NOT NULL";
      const def = mapDefault(column.default, mapped.type);
      if (def !== null) line += ` DEFAULT ${def}`;
      lines.push(line);
    }

    if (scope) {
      // STORED, not VIRTUAL: MariaDB will not build a UNIQUE index over a
      // VIRTUAL column, and the uniqueness is the entire point.
      lines.push(
        `  ${q(scope.scopeColumn)} VARCHAR(64) AS (COALESCE(${q(scope.nullableColumn)}, '')) STORED`,
      );
    }

    if (table.primaryKey.length > 0) {
      lines.push(`  PRIMARY KEY (${table.primaryKey.map(q).join(", ")})`);
    }

    for (const check of table.checks) {
      const expression = unqualify(check.expression, table.name);
      lines.push(
        check.name
          ? `  CONSTRAINT ${q(check.name)} CHECK (${expression})`
          : `  CHECK (${expression})`,
      );
    }

    if (scope) {
      // The guard that makes the scope column honest. Without it, a row whose
      // variant_id is the empty string would collide with the product-level
      // row and the uniqueness would mean something nobody intended.
      lines.push(
        `  CONSTRAINT ${q(`${table.name}_scope_not_empty`)} CHECK (${q(scope.nullableColumn)} IS NULL OR ${q(scope.nullableColumn)} <> '')`,
      );
    }

    statements.push(
      `CREATE TABLE ${q(table.name)} (\n${lines.join(",\n")}\n) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;`,
    );
  }

  // Foreign keys are added after every table exists, so the emitted file does
  // not depend on table order. D1 accepted the original order because SQLite
  // resolves references lazily; MariaDB does not.
  const foreignKeyStatements = [];
  for (const table of tables) {
    if (FTS_ARTEFACTS.has(table.name)) continue;
    table.foreignKeys.forEach((fk, i) => {
      if (FTS_ARTEFACTS.has(fk.table)) return;
      foreignKeyStatements.push(
        `ALTER TABLE ${q(table.name)} ADD CONSTRAINT ${q(`fk_${table.name}_${fk.columns.join("_")}_${i}`)} ` +
          `FOREIGN KEY (${fk.columns.map(q).join(", ")}) REFERENCES ${q(fk.table)} (${fk.refColumns.map(q).join(", ")}) ` +
          `ON DELETE ${normaliseAction(fk.onDelete)} ON UPDATE ${normaliseAction(fk.onUpdate)};`,
      );
    });
  }

  const indexStatements = [];
  const replacedIndexNames = new Set(Object.values(SCOPE_REPLACEMENTS).flatMap((s) => s.replaces));
  const skippedIndexes = [];

  for (const index of indexes) {
    if (FTS_ARTEFACTS.has(index.table)) continue;
    if (replacedIndexNames.has(index.name)) {
      skippedIndexes.push(index);
      continue;
    }
    if (index.where) {
      throw new Error(
        `Partial index ${index.name} on ${index.table} has no declared MariaDB replacement. ` +
          `Add one to SCOPE_REPLACEMENTS rather than dropping the predicate.`,
      );
    }
    indexStatements.push(
      `CREATE ${index.unique ? "UNIQUE " : ""}INDEX ${q(index.name)} ON ${q(index.table)} (${index.columns.map(q).join(", ")});`,
    );
  }

  for (const [table, scope] of Object.entries(SCOPE_REPLACEMENTS)) {
    indexStatements.push(
      `CREATE UNIQUE INDEX ${q(scope.indexName)} ON ${q(table)} (${scope.keyColumns.map(q).join(", ")});`,
    );
  }

  return { statements, foreignKeyStatements, indexStatements, decisions, skippedIndexes };
}

/**
 * Strips a table qualifier from a CHECK expression.
 *
 * SQLite writes `CHECK("inventory_levels"."reserved" >= 0)`. MariaDB rejects a
 * qualified column name inside a CHECK outright — the constraint cannot refer
 * to a table, only to the row being written — so the qualifier has to go, and
 * the double-quoted identifiers have to become backticks while we are here:
 * under MariaDB's default SQL mode a double-quoted token is a STRING, so
 * `"reserved" >= 0` would compare the literal text "reserved" against zero and
 * the constraint would never fire.
 */
function unqualify(expression, tableName) {
  return expression
    .replace(new RegExp(`["\`]${tableName}["\`]\\s*\\.\\s*`, "g"), "")
    .replace(/"([A-Za-z_][\w]*)"/g, "`$1`");
}

function normaliseAction(action) {
  const normalised = action.replace(/\s+/g, " ").toUpperCase();
  return normalised === "NO ACTION" ? "NO ACTION" : normalised;
}

/**
 * Translates a SQLite default into a MariaDB one.
 *
 * `true`/`false` are SQLite keywords that store 1 and 0. MariaDB accepts them
 * too, but writing the number makes what is on disk unambiguous — and a
 * TINYINT(1) column defaulting to the literal `true` reads as a different type
 * than it is.
 */
function mapDefault(value, targetType) {
  if (value === null) return null;
  const lowered = value.toLowerCase();
  if (lowered === "true") return "1";
  if (lowered === "false") return "0";
  if (lowered === "null") return "NULL";
  // MariaDB does not allow a DEFAULT on TEXT/BLOB columns at all.
  if (/^(TINY|MEDIUM|LONG)?(TEXT|BLOB)$/i.test(targetType)) return null;
  return value;
}
