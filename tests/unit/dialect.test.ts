/**
 * The SQLite -> MariaDB translator.
 *
 * These are unit tests because the translation is pure, and they are worth
 * having separately from the MariaDB integration suite: a rule that mangles a
 * string literal or silently drops a condition produces SQL that RUNS. The
 * integration tests would pass and the shop would be wrong.
 */

import { describe, expect, it } from "vitest";
import { translate, orderParameters, UntranslatableSqlError } from "~/infrastructure/db/dialect";

describe("placeholders", () => {
  it("converts numbered placeholders to positional ones", () => {
    const { sql, parameterOrder } = translate("SELECT * FROM t WHERE a = ?1 AND b = ?2");
    expect(sql).toBe("SELECT * FROM t WHERE a = ? AND b = ?");
    expect(parameterOrder).toEqual([0, 1]);
  });

  /*
   * The behaviour the whole codebase leans on: `VALUES (?1, ?2, ?3, ?4, ?4)`
   * writes one timestamp to both created_at and updated_at. MariaDB has no
   * numbered placeholders, so the value has to be repeated in the bind array.
   */
  it("repeats a value bound to the same number twice", () => {
    const { sql, parameterOrder } = translate("INSERT INTO t (a, b, c) VALUES (?1, ?2, ?2)");
    expect(sql).toBe("INSERT INTO t (a, b, c) VALUES (?, ?, ?)");
    expect(parameterOrder).toEqual([0, 1, 1]);
    expect(orderParameters(["x", 7], parameterOrder)).toEqual(["x", 7, 7]);
  });

  it("handles out-of-order numbering", () => {
    const { parameterOrder } = translate("UPDATE t SET a = ?2 WHERE id = ?1");
    expect(orderParameters(["id", "value"], parameterOrder)).toEqual(["value", "id"]);
  });

  it("passes anonymous placeholders through in encounter order", () => {
    const { sql, parameterOrder } = translate("SELECT * FROM t WHERE a = ? LIMIT ?");
    expect(sql).toBe("SELECT * FROM t WHERE a = ? LIMIT ?");
    expect(parameterOrder).toEqual([0, 1]);
  });

  it("refuses to guess when the two styles are mixed", () => {
    expect(() => translate("SELECT * FROM t WHERE a = ?1 AND b = ?")).toThrow(
      UntranslatableSqlError,
    );
  });

  it("rejects an undefined bind rather than writing NULL", () => {
    const { parameterOrder } = translate("INSERT INTO t (a, b) VALUES (?1, ?2)");
    expect(() => orderParameters(["only-one"], parameterOrder)).toThrow(/undefined/);
  });

  it("leaves a question mark inside a string literal alone", () => {
    const { sql, parameterOrder } = translate("SELECT * FROM t WHERE note = 'why?' AND id = ?1");
    expect(sql).toBe("SELECT * FROM t WHERE note = 'why?' AND id = ?");
    expect(parameterOrder).toEqual([0]);
  });
});

describe("scalar MIN and MAX", () => {
  /*
   * The rewrite that matters most. In MySQL and MariaDB, MIN and MAX are
   * AGGREGATES; the two-argument scalar form is SQLite-only. Both call sites
   * in this repository clamp stock arithmetic.
   */
  /*
   * Exact equality, not `toContain`. A `toContain` assertion passed here while
   * the rewrite was silently DROPPING everything after the closing
   * parenthesis — which turned this statement into an unconditional update of
   * every row in inventory_levels. The whole-string comparison is the test.
   */
  it("rewrites the stock-release clamp and keeps the WHERE clause", () => {
    const { sql } = translate(
      "UPDATE inventory_levels SET reserved = MAX(0, reserved - ?1) WHERE variant_id = ?2",
    );
    expect(sql).toBe(
      "UPDATE inventory_levels SET reserved = GREATEST(0, reserved - ?) WHERE variant_id = ?",
    );
  });

  it("rewrites the cart-quantity clamp", () => {
    const { sql } = translate(
      "INSERT INTO cart_items VALUES (?1) ON CONFLICT(cart_id, variant_id) DO UPDATE SET quantity = MIN(99, cart_items.quantity + ?2)",
    );
    expect(sql).toBe(
      "INSERT INTO cart_items VALUES (?) ON DUPLICATE KEY UPDATE quantity = LEAST(99, cart_items.quantity + ?)",
    );
  });

  /*
   * The order-cancellation clamp: a scalar MAX whose second argument is a
   * subquery containing a string literal. The first version of this translator
   * scanned code and string runs separately and saw this as unbalanced
   * parentheses, refusing a statement that is perfectly ordinary.
   */
  it("rewrites a clamp whose argument is a subquery containing a literal", () => {
    const { sql } = translate(
      "UPDATE inventory_levels SET reserved = MAX(0, reserved - (SELECT COALESCE(SUM(r.quantity), 0) FROM stock_reservations r WHERE r.order_id = ?1 AND r.status = 'active')) WHERE location_id = ?2",
    );
    expect(sql).toBe(
      "UPDATE inventory_levels SET reserved = GREATEST(0, reserved - (SELECT COALESCE(SUM(r.quantity), 0) FROM stock_reservations r WHERE r.order_id = ? AND r.status = 'active')) WHERE location_id = ?",
    );
  });

  it("leaves a genuine aggregate alone", () => {
    const { sql } = translate("SELECT MAX(created_at) FROM orders");
    expect(sql).toBe("SELECT MAX(created_at) FROM orders");
  });

  it("rewrites a nested scalar call without touching the aggregate around it", () => {
    const { sql } = translate("SELECT MAX(MIN(a, b)) FROM t");
    expect(sql).toBe("SELECT MAX(LEAST(a, b)) FROM t");
  });

  it("does not mistake a comma inside a nested call for an argument separator", () => {
    const { sql } = translate("SELECT MAX(COALESCE(a, b)) FROM t");
    expect(sql).toBe("SELECT MAX(COALESCE(a, b)) FROM t");
  });
});

describe("upserts", () => {
  it("maps ON CONFLICT DO UPDATE onto ON DUPLICATE KEY UPDATE", () => {
    const { sql } = translate(
      "INSERT INTO carts (id, token) VALUES (?1, ?2) ON CONFLICT(token) DO UPDATE SET expires_at = ?3",
    );
    expect(sql).toBe(
      "INSERT INTO carts (id, token) VALUES (?, ?) ON DUPLICATE KEY UPDATE expires_at = ?",
    );
  });

  it("maps excluded.column onto VALUES(column)", () => {
    const { sql } = translate(
      "INSERT INTO page_translations (id, title) VALUES (?1, ?2) ON CONFLICT(page_id, locale) DO UPDATE SET title = excluded.title",
    );
    expect(sql).toContain("ON DUPLICATE KEY UPDATE title = VALUES(`title`)");
  });

  /*
   * The one that must NOT be translated. MariaDB's ON DUPLICATE KEY UPDATE
   * takes no WHERE, and quietly dropping the condition would turn the
   * installation claim in bootstrap-admin into an unconditional one — letting
   * a second installer seize a live claim and create a second super admin.
   */
  it("refuses a conflict clause carrying its own WHERE", () => {
    expect(() =>
      translate(
        `INSERT INTO installation_state (id, status) VALUES ('singleton', 'in_progress')
         ON CONFLICT(id) DO UPDATE SET claimed_at = ?1
         WHERE installation_state.status = 'in_progress' AND installation_state.claimed_at < ?2`,
      ),
    ).toThrow(/no MariaDB equivalent/);
  });

  it("refuses DO NOTHING, which has a different spelling rather than a translation", () => {
    expect(() => translate("INSERT INTO t (id) VALUES (?1) ON CONFLICT(id) DO NOTHING")).toThrow(
      UntranslatableSqlError,
    );
  });

  it("maps INSERT OR IGNORE onto INSERT IGNORE", () => {
    const { sql } = translate("INSERT OR IGNORE INTO product_search_map (product_id) VALUES (?1)");
    expect(sql).toBe("INSERT IGNORE INTO product_search_map (product_id) VALUES (?)");
  });
});

describe("functions", () => {
  it("gives GROUP_CONCAT its MariaDB separator syntax", () => {
    const { sql } = translate("SELECT GROUP_CONCAT(v.sku, ' ') FROM product_variants v");
    expect(sql).toBe("SELECT GROUP_CONCAT(v.sku SEPARATOR ' ') FROM product_variants v");
  });

  it("leaves the single-argument form alone, since both default to a comma", () => {
    const { sql } = translate("SELECT GROUP_CONCAT(p.code) FROM permissions p");
    expect(sql).toBe("SELECT GROUP_CONCAT(p.code) FROM permissions p");
  });

  it("maps randomblob onto RANDOM_BYTES", () => {
    const { sql } = translate("SELECT lower(hex(randomblob(16)))");
    expect(sql).toBe("SELECT lower(hex(RANDOM_BYTES(16)))");
  });
});

describe("constructs that must fail loudly", () => {
  it.each([
    ["FTS5 MATCH", "SELECT * FROM product_search WHERE product_search MATCH ?1"],
    ["RETURNING", "UPDATE t SET a = ?1 RETURNING id"],
    ["PRAGMA", "PRAGMA foreign_keys = ON"],
    ["strftime", "SELECT strftime('%Y', created_at) FROM orders"],
    ["unixepoch", "SELECT unixepoch() FROM orders"],
    ["json_extract", "SELECT json_extract(payload, '$.a') FROM order_events"],
    ["GLOB", "SELECT * FROM t WHERE name GLOB 'a*'"],
  ])("throws on %s rather than passing it through", (_label, sql) => {
    expect(() => translate(sql)).toThrow(UntranslatableSqlError);
  });

  /*
   * A forbidden word inside a string literal is DATA. A product called
   * "Match Case" or a note containing the word `returning` must not make the
   * statement untranslatable.
   */
  it("does not trip on a forbidden keyword inside a string literal", () => {
    expect(() =>
      translate("SELECT * FROM products WHERE name = ?1 AND slug = 'match-case'"),
    ).not.toThrow();
  });

  it("does not edit SQL-looking text inside a string literal", () => {
    const { sql } = translate("UPDATE t SET note = 'use MAX(0, x) here' WHERE id = ?1");
    expect(sql).toBe("UPDATE t SET note = 'use MAX(0, x) here' WHERE id = ?");
  });

  it("handles a doubled quote inside a literal", () => {
    const { sql, parameterOrder } = translate("UPDATE t SET note = 'it''s fine' WHERE id = ?1");
    expect(sql).toBe("UPDATE t SET note = 'it''s fine' WHERE id = ?");
    expect(parameterOrder).toEqual([0]);
  });
});

describe("reserved identifiers", () => {
  /*
   * The one that took the whole shop down.
   *
   * SQLite reserves almost nothing, so `SELECT key, value FROM store_settings`
   * is ordinary SQL there and a syntax error in MariaDB. That statement is on
   * the storefront layout's critical path — every page load reads the
   * merchant's settings — so every route returned 500 until the rule existed.
   */
  it("backticks `key` used as a column", () => {
    const { sql } = translate("SELECT key, value FROM store_settings WHERE key = ?1");
    expect(sql).toBe("SELECT `key`, value FROM store_settings WHERE `key` = ?");
  });

  it("backticks a qualified reserved column", () => {
    const { sql } = translate("SELECT s.key FROM store_settings s");
    expect(sql).toBe("SELECT s.`key` FROM store_settings s");
  });

  it("leaves an already-backticked identifier alone", () => {
    const { sql } = translate("SELECT `key` FROM store_settings");
    expect(sql).toBe("SELECT `key` FROM store_settings");
  });

  /*
   * Three places `KEY` is syntax rather than a column. Backticking any of them
   * produces a statement MariaDB cannot parse.
   */
  it("does not touch ON DUPLICATE KEY UPDATE", () => {
    const { sql } = translate(
      "INSERT INTO carts (id, token) VALUES (?1, ?2) ON CONFLICT(token) DO UPDATE SET expires_at = ?3",
    );
    expect(sql).toContain("ON DUPLICATE KEY UPDATE");
    expect(sql).not.toContain("`KEY`");
  });

  it("does not touch a word that merely contains a reserved one", () => {
    const { sql } = translate("SELECT monkey, keyboard FROM t");
    expect(sql).toBe("SELECT monkey, keyboard FROM t");
  });

  it("does not touch ROW_NUMBER() the window function", () => {
    const { sql } = translate("SELECT ROW_NUMBER() OVER (ORDER BY id) AS n FROM orders");
    expect(sql).toBe("SELECT ROW_NUMBER() OVER (ORDER BY id) AS n FROM orders");
  });

  it("does not touch the word inside a string literal", () => {
    const { sql } = translate("SELECT * FROM store_settings WHERE value = 'the key is here'");
    expect(sql).toBe("SELECT * FROM store_settings WHERE value = 'the key is here'");
  });
});
