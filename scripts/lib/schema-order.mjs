/**
 * Working out what depends on what, from the schema itself.
 *
 * Both halves of the backup story need this and they need it to agree:
 *
 *   - the export writes rows PARENT-FIRST, so a restore can insert them without
 *     tripping a foreign key;
 *   - the restore drill drops tables CHILD-FIRST, because SQLite cannot drop a
 *     child whose parent table has already gone (`no such table: main.roles`).
 *
 * One is the reverse of the other, so they must come from one implementation.
 * Two copies that drifted apart would produce a backup that exports cleanly and
 * cannot be restored — which is the exact failure this whole area exists to
 * prevent.
 *
 * The graph is read from the `REFERENCES` clauses in the stored `CREATE TABLE`
 * text. D1 refuses the obvious route — `pragma_foreign_key_list` comes back
 * `not authorized: SQLITE_AUTH` — so the schema text is the source of truth.
 */

const REFERENCES = /REFERENCES\s+["'`[]?([A-Za-z_][A-Za-z0-9_]*)["'`\]]?/gi;

/**
 * Parent tables referenced by a table's own DDL, excluding itself.
 *
 * A self-reference is dropped here on purpose: it says nothing about the order
 * of TABLES, only about the order of rows within one. See `selfReferencing`.
 */
export function parentsOf(name, sql) {
  return new Set(
    [...String(sql).matchAll(REFERENCES)]
      .map((match) => match[1])
      .filter((parent) => parent !== name),
  );
}

/** Tables whose rows point at other rows in the same table. */
export function selfReferencing(rows) {
  return rows
    .filter((row) =>
      [...String(row.sql).matchAll(REFERENCES)].some((match) => match[1] === row.name),
    )
    .map((row) => row.name);
}

/**
 * Order `tables` so that every table appears after the tables it references.
 *
 * `rows` is what `SELECT name, sql FROM sqlite_master WHERE type='table'`
 * returns. References to tables outside `tables` are ignored — an excluded
 * table cannot constrain the order of the ones that remain.
 *
 * Sorted alphabetically within each layer so two runs against the same schema
 * produce byte-identical output, and a diff between two backups shows data
 * changes rather than reshuffling.
 *
 * Throws on a cycle rather than returning an order that is quietly wrong.
 */
export function dependencyOrder(tables, rows) {
  const graph = new Map(rows.map((row) => [row.name, parentsOf(row.name, row.sql)]));
  const remaining = new Set(tables);
  const ordered = [];

  while (remaining.size > 0) {
    const ready = [...remaining]
      .filter((table) => [...(graph.get(table) ?? [])].every((parent) => !remaining.has(parent)))
      .sort();

    if (ready.length === 0) {
      throw new Error(
        `Circular foreign keys among: ${[...remaining].sort().join(", ")}. ` +
          "No ordering can satisfy them.",
      );
    }

    for (const table of ready) {
      ordered.push(table);
      remaining.delete(table);
    }
  }

  return ordered;
}

/** Virtual (FTS) tables, which are derived and are never backed up. */
export function virtualTables(rows) {
  return rows.filter((row) => /USING\s+fts\d/i.test(String(row.sql))).map((row) => row.name);
}

/**
 * The exact suffixes FTS5 gives the hidden tables it stores an index in.
 *
 * Fixed and documented, which is why they are listed rather than pattern
 * matched. The first version of this matched any table whose name STARTED with
 * the virtual table's name, and that quietly swallowed `product_search_map` —
 * an ordinary table holding the product-to-rowid mapping, which happens to
 * share the prefix. It was therefore never dropped and never exported, and the
 * restore died recreating it:
 *
 *     table `product_search_map` already exists
 *
 * A prefix test cannot tell a shadow table from a table that is merely named
 * after the same feature. The suffix list can.
 */
const FTS5_SHADOW_SUFFIXES = ["data", "idx", "content", "docsize", "config"];

/**
 * The hidden tables an FTS index keeps its data in.
 *
 * SQLite refuses to let anything modify or drop these directly; they appear and
 * disappear with their virtual table.
 */
export function shadowTables(rows) {
  const virtual = virtualTables(rows);
  return rows
    .map((row) => row.name)
    .filter((name) =>
      virtual.some((fts) => FTS5_SHADOW_SUFFIXES.some((suffix) => name === `${fts}_${suffix}`)),
    );
}
