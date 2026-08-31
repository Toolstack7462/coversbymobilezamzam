import { describe, expect, it } from "vitest";

import {
  dependencyOrder,
  parentsOf,
  selfReferencing,
  shadowTables,
  virtualTables,
} from "../../scripts/lib/schema-order.mjs";

/**
 * The ordering behind the backup.
 *
 * Every case here is a failure that actually happened while building the
 * backup, not a hypothetical. The rules are invisible when they work and the
 * symptom when they break is always a confusing SQLite error at restore time —
 * which is the worst moment to be debugging a graph.
 */

const table = (name: string, sql: string) => ({ name, sql });

describe("dependencyOrder", () => {
  it("puts a parent before the table that references it", () => {
    const rows = [
      table(
        "role_permissions",
        "CREATE TABLE role_permissions (role_id TEXT REFERENCES roles(id))",
      ),
      table("roles", "CREATE TABLE roles (id TEXT PRIMARY KEY)"),
    ];

    // The failure this prevents: D1's own export is alphabetical, so
    // role_permissions is written first and the restore dies on
    // "FOREIGN KEY constraint failed".
    const order = dependencyOrder(["role_permissions", "roles"], rows);
    expect(order.indexOf("roles")).toBeLessThan(order.indexOf("role_permissions"));
  });

  it("orders a chain transitively", () => {
    const rows = [
      table(
        "variant_prices",
        "CREATE TABLE variant_prices (v TEXT REFERENCES product_variants(id))",
      ),
      table("product_variants", "CREATE TABLE product_variants (p TEXT REFERENCES products(id))"),
      table("products", "CREATE TABLE products (b TEXT REFERENCES brands(id))"),
      table("brands", "CREATE TABLE brands (id TEXT PRIMARY KEY)"),
    ];

    expect(
      dependencyOrder(["variant_prices", "product_variants", "products", "brands"], rows),
    ).toEqual(["brands", "products", "product_variants", "variant_prices"]);
  });

  it("is stable, so two backups of the same schema order identically", () => {
    const rows = [
      table("a", "CREATE TABLE a (id TEXT)"),
      table("b", "CREATE TABLE b (id TEXT)"),
      table("c", "CREATE TABLE c (id TEXT)"),
    ];

    // Independent tables are alphabetical rather than input-order, so a diff
    // between two dumps shows data changes and not reshuffling.
    expect(dependencyOrder(["c", "a", "b"], rows)).toEqual(["a", "b", "c"]);
  });

  it("ignores references to tables outside the set being ordered", () => {
    // The FTS tables are excluded from the backup; a reference to one of them
    // must not make an ordinary table unorderable.
    const rows = [
      table(
        "product_search_map",
        "CREATE TABLE product_search_map (p TEXT REFERENCES products(id))",
      ),
      table("products", "CREATE TABLE products (id TEXT PRIMARY KEY)"),
    ];

    expect(dependencyOrder(["product_search_map"], rows)).toEqual(["product_search_map"]);
  });

  it("does not treat a self-reference as an unsatisfiable dependency", () => {
    // A category whose parent is another category. Table order cannot express
    // this — it is a row-level concern — so it must not stall the sort.
    const rows = [
      table("categories", "CREATE TABLE categories (parent_id TEXT REFERENCES categories(id))"),
    ];

    expect(dependencyOrder(["categories"], rows)).toEqual(["categories"]);
  });

  it("refuses a cycle rather than inventing an order", () => {
    const rows = [
      table("a", "CREATE TABLE a (x TEXT REFERENCES b(id))"),
      table("b", "CREATE TABLE b (y TEXT REFERENCES a(id))"),
    ];

    // Silently emitting one of the two wrong orders would produce a backup that
    // fails at restore, months later.
    expect(() => dependencyOrder(["a", "b"], rows)).toThrow(/Circular foreign keys/);
  });

  it("reversed, gives an order tables can be dropped in", () => {
    const rows = [
      table("role_permissions", "CREATE TABLE role_permissions (r TEXT REFERENCES roles(id))"),
      table("roles", "CREATE TABLE roles (id TEXT PRIMARY KEY)"),
    ];

    // SQLite resolves a table's foreign keys as it drops it, so dropping the
    // parent first fails with "no such table: main.roles".
    const dropOrder = dependencyOrder(["roles", "role_permissions"], rows).reverse();
    expect(dropOrder.indexOf("role_permissions")).toBeLessThan(dropOrder.indexOf("roles"));
  });
});

describe("parentsOf", () => {
  it("reads quoted, bracketed and bare table names", () => {
    const sql = `CREATE TABLE t (
      a TEXT REFERENCES "one"(id),
      b TEXT REFERENCES [two](id),
      c TEXT REFERENCES three(id)
    )`;

    expect(parentsOf("t", sql)).toEqual(new Set(["one", "two", "three"]));
  });

  it("excludes the table itself", () => {
    expect(parentsOf("categories", "REFERENCES categories(id)")).toEqual(new Set());
  });
});

describe("virtualTables and shadowTables", () => {
  const rows = [
    table("product_search", "CREATE VIRTUAL TABLE product_search USING fts5(title, content='')"),
    table(
      "product_search_data",
      "CREATE TABLE 'product_search_data'(id INTEGER PRIMARY KEY, block BLOB)",
    ),
    table("product_search_idx", "CREATE TABLE 'product_search_idx'(segid, term, pgno)"),
    table(
      "product_search_docsize",
      "CREATE TABLE 'product_search_docsize'(id INTEGER PRIMARY KEY, sz BLOB)",
    ),
    table("product_search_config", "CREATE TABLE 'product_search_config'(k PRIMARY KEY, v)"),
    table(
      "product_search_map",
      "CREATE TABLE product_search_map (product_id TEXT REFERENCES products(id))",
    ),
    table("products", "CREATE TABLE products (id TEXT PRIMARY KEY)"),
  ];

  it("finds the fts5 virtual table", () => {
    expect(virtualTables(rows)).toEqual(["product_search"]);
  });

  it("matches the four real shadow tables", () => {
    expect(shadowTables(rows).sort()).toEqual([
      "product_search_config",
      "product_search_data",
      "product_search_docsize",
      "product_search_idx",
    ]);
  });

  it("does NOT mistake product_search_map for a shadow table", () => {
    /*
     * The bug this pins down. `product_search_map` is an ordinary table that
     * merely shares the prefix. Treating it as a shadow table meant it was
     * never dropped and never exported, and the restore failed with
     * "table `product_search_map` already exists" when migration 0005 tried to
     * recreate it.
     */
    expect(shadowTables(rows)).not.toContain("product_search_map");
  });
});

describe("selfReferencing", () => {
  it("names tables whose rows point at their own table", () => {
    const rows = [
      table("categories", "CREATE TABLE categories (parent_id TEXT REFERENCES categories(id))"),
      table("products", "CREATE TABLE products (b TEXT REFERENCES brands(id))"),
    ];

    expect(selfReferencing(rows)).toEqual(["categories"]);
  });
});
