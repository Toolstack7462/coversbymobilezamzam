/**
 * Foreign-key-safe table ordering.
 *
 * MariaDB enforces foreign keys during the import, so a child row inserted
 * before its parent is rejected. The order is DERIVED from the generated schema
 * rather than written down, because a hand-maintained list is a second source
 * of truth that goes stale the first time somebody adds a table.
 *
 * Deliberately NOT solved by disabling FOREIGN_KEY_CHECKS. That turns a
 * migration that would have failed loudly into one that succeeds and leaves
 * orphans — and the whole point of moving to an engine that enforces
 * references is that it enforces them.
 */

import fs from "node:fs";

/**
 * @param {string} baselineSql the generated 0001_baseline.sql
 * @returns {{ order: string[], cycles: string[][], dependencies: Map<string, Set<string>> }}
 */
export function tableOrder(baselineSql) {
  const tables = [...baselineSql.matchAll(/CREATE TABLE `([^`]+)`/g)].map((m) => m[1]);

  /** table -> the tables it references. */
  const dependencies = new Map(tables.map((t) => [t, new Set()]));

  const fkPattern =
    /ALTER TABLE `([^`]+)` ADD CONSTRAINT `[^`]+` FOREIGN KEY \([^)]*\) REFERENCES `([^`]+)`/g;
  for (const [, child, parent] of baselineSql.matchAll(fkPattern)) {
    // A self-reference is satisfiable within one table's own insert order and
    // must not make the table depend on itself, which would look like a cycle.
    if (child !== parent) dependencies.get(child)?.add(parent);
  }

  const order = [];
  const state = new Map(tables.map((t) => [t, "pending"]));
  const cycles = [];

  /** Depth-first, parents before children. */
  const visit = (table, path) => {
    const current = state.get(table);
    if (current === "done") return;
    if (current === "visiting") {
      cycles.push([...path.slice(path.indexOf(table)), table]);
      return;
    }
    state.set(table, "visiting");
    for (const parent of dependencies.get(table) ?? []) visit(parent, [...path, table]);
    state.set(table, "done");
    order.push(table);
  };

  for (const table of tables) visit(table, []);

  return { order, cycles, dependencies };
}

export function loadTableOrder(baselinePath) {
  return tableOrder(fs.readFileSync(baselinePath, "utf8"));
}
