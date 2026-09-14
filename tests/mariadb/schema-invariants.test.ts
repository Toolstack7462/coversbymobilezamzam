/**
 * The constraints this schema depends on, proved against a real MariaDB.
 *
 * Each test here corresponds to something SQLite did that MariaDB does not do
 * the same way. A green run means the replacement behaves like the original,
 * not that the SQL parsed.
 */

import { beforeAll, afterAll, beforeEach, describe, expect, it } from "vitest";
import { resetSchema, testDb, seedFixtures, truncateFixtures } from "./helpers";
import { classifySqlError } from "~/infrastructure/db/sql";
import type { MariaDbDatabase } from "~/infrastructure/db/mariadb";

let db: MariaDbDatabase;

beforeAll(async () => {
  await resetSchema();
  db = testDb();
}, 120_000);

afterAll(async () => {
  await db?.close();
});

beforeEach(async () => {
  await truncateFixtures(db);
});

describe("engine and encoding", () => {
  it("stores every table as InnoDB utf8mb4", async () => {
    const { results } = await db
      .prepare(
        `SELECT table_name, engine, table_collation
           FROM information_schema.tables
          WHERE table_schema = DATABASE()
            AND (engine <> 'InnoDB' OR table_collation NOT LIKE 'utf8mb4%')`,
      )
      .all<{ table_name: string }>();
    expect(results).toEqual([]);
  });

  it("round-trips Italian accents without mojibake", async () => {
    const now = Date.now();
    await db
      .prepare(
        `INSERT INTO brands (id, slug, name, sort_order, created_at, updated_at)
         VALUES (?1, 'citta', ?2, 0, ?3, ?3)`,
      )
      .bind("b-accent", "Città di Sulmona — €10 «test»", now)
      .run();

    const row = await db
      .prepare(`SELECT name FROM brands WHERE id = ?1`)
      .bind("b-accent")
      .first<{ name: string }>();

    expect(row?.name).toBe("Città di Sulmona — €10 «test»");
  });
});

describe("partial unique indexes, replaced by a generated scope column", () => {
  beforeEach(async () => {
    const now = Date.now();
    await db.batch([
      db
        .prepare(
          `INSERT INTO brands (id, slug, name, sort_order, created_at, updated_at)
           VALUES ('b1','acme','Acme',0,?1,?1)`,
        )
        .bind(now),
      db
        .prepare(
          `INSERT INTO products (id, slug, brand_id, status, is_featured, created_at, updated_at)
           VALUES ('p1','p-one','b1','active',0,?1,?1)`,
        )
        .bind(now),
      db
        .prepare(
          `INSERT INTO product_variants
             (id, product_id, sku, active, available_online, available_for_pickup, sort_order, created_at, updated_at)
           VALUES ('v1','p1','SKU-1',1,1,1,0,?1,?1), ('v2','p1','SKU-2',1,1,1,0,?1,?1)`,
        )
        .bind(now),
    ]);
  });

  const insertSpec = (id: string, variantId: string | null, key: string) =>
    db
      .prepare(
        `INSERT INTO product_specifications
           (id, product_id, variant_id, spec_key, value_text, sort_order)
         VALUES (?1, 'p1', ?2, ?3, 'x', 0)`,
      )
      .bind(id, variantId, key)
      .run();

  /*
   * This is the test that a plain nullable composite UNIQUE would fail.
   *
   * In both SQLite and MariaDB, NULLs are DISTINCT inside a UNIQUE index, so
   * `UNIQUE (product_id, variant_id, spec_key)` permits an unlimited number of
   * identical product-level rows. The partial index `WHERE variant_id IS NULL`
   * is what forbade it, and the generated scope column is what reproduces it.
   */
  it("rejects a second product-level specification for the same key", async () => {
    await insertSpec("s1", null, "weight");
    await expect(insertSpec("s2", null, "weight")).rejects.toThrow();

    const error = await insertSpec("s3", null, "weight").catch((e) => e);
    expect(classifySqlError(error).kind).toBe("unique_violation");
  });

  it("rejects a second specification for the same variant and key", async () => {
    await insertSpec("s1", "v1", "weight");
    await expect(insertSpec("s2", "v1", "weight")).rejects.toThrow();
  });

  it("still allows a variant override beside the product-level value", async () => {
    await insertSpec("s1", null, "weight");
    await insertSpec("s2", "v1", "weight");
    await insertSpec("s3", "v2", "weight");

    const row = await db
      .prepare(`SELECT COUNT(*) AS n FROM product_specifications WHERE product_id = 'p1'`)
      .first<{ n: number }>();
    expect(row?.n).toBe(3);
  });

  it("keeps the scope column in step with variant_id", async () => {
    await insertSpec("s1", null, "weight");
    await insertSpec("s2", "v1", "colour");

    const { results } = await db
      .prepare(`SELECT id, variant_id, variant_scope FROM product_specifications ORDER BY id`)
      .all<{ id: string; variant_id: string | null; variant_scope: string }>();

    expect(results).toEqual([
      { id: "s1", variant_id: null, variant_scope: "" },
      { id: "s2", variant_id: "v1", variant_scope: "v1" },
    ]);
  });

  /*
   * The generated column turns NULL into the empty string, so an actual empty
   * string variant_id would collide with the product-level row and make the
   * uniqueness mean something nobody intended. The CHECK forbids it.
   */
  it("refuses an empty-string variant id, which would forge the null scope", async () => {
    const error = await insertSpec("s1", "", "weight").catch((e) => e);
    expect(error).toBeInstanceOf(Error);
    expect(classifySqlError(error).kind).toBe("check_violation");
  });

  it("applies the same rules to product_compatibility", async () => {
    const insertCompat = (id: string, variantId: string | null) =>
      db
        .prepare(
          `INSERT INTO product_compatibility
             (id, product_id, variant_id, device_model_id, compatibility_level, verified, created_at, updated_at)
           VALUES (?1, 'p1', ?2, 'dm1', 'compatible', 0, ?3, ?3)`,
        )
        .bind(id, variantId, Date.now())
        .run();

    const now = Date.now();
    await db
      .prepare(
        `INSERT INTO device_brands (id, handle, name, sort_order, created_at, updated_at)
         VALUES ('db1','samsung','Samsung',0,?1,?1)`,
      )
      .bind(now)
      .run();
    await db
      .prepare(
        `INSERT INTO device_families (id, device_brand_id, handle, name, sort_order, created_at, updated_at)
         VALUES ('df1','db1','galaxy-s','Galaxy S',0,?1,?1)`,
      )
      .bind(now)
      .run();
    await db
      .prepare(
        `INSERT INTO device_models (id, device_brand_id, device_family_id, handle, name, sort_order, created_at, updated_at)
         VALUES ('dm1','db1','df1','galaxy-s24','Galaxy S24',0,?1,?1)`,
      )
      .bind(now)
      .run();

    await insertCompat("c1", null);
    await expect(insertCompat("c2", null)).rejects.toThrow();
    await insertCompat("c3", "v1");
    await expect(insertCompat("c4", "v1")).rejects.toThrow();
  });
});

describe("the oversell guard", () => {
  beforeEach(async () => {
    await seedFixtures(db);
  });

  it("carries the named CHECK constraint across, so the failure stays diagnosable", async () => {
    const row = await db
      .prepare(
        `SELECT constraint_name FROM information_schema.check_constraints
          WHERE constraint_schema = DATABASE()
            AND constraint_name = 'inventory_levels_reserved_bounds'`,
      )
      .first<{ constraint_name: string }>();
    expect(row?.constraint_name).toBe("inventory_levels_reserved_bounds");
  });

  it("refuses to reserve more than is on hand", async () => {
    const error = await db
      .prepare(
        `UPDATE inventory_levels SET reserved = reserved + 2, updated_at = ?1
          WHERE variant_id = 'v1' AND location_id = 'loc1'`,
      )
      .bind(Date.now())
      .run()
      .catch((e) => e);

    const failure = classifySqlError(error);
    expect(failure.kind).toBe("check_violation");
    expect(failure.kind === "check_violation" && failure.constraint).toBe(
      "inventory_levels_reserved_bounds",
    );
  });

  it("refuses to release below zero", async () => {
    const error = await db
      .prepare(
        `UPDATE inventory_levels SET reserved = reserved - 1, updated_at = ?1
          WHERE variant_id = 'v1' AND location_id = 'loc1'`,
      )
      .bind(Date.now())
      .run()
      .catch((e) => e);
    expect(classifySqlError(error).kind).toBe("check_violation");
  });

  /*
   * The behaviour that differs most between the two engines.
   *
   * D1 aborts the whole batch when a statement fails. MariaDB aborts the
   * STATEMENT and leaves the transaction open with the earlier statements
   * applied — so an adapter that forgets to roll back produces exactly the
   * partial order this design exists to prevent: a reservation row with no
   * matching stock deduction.
   */
  it("rolls the whole batch back when one statement violates the guard", async () => {
    const now = Date.now();
    const error = await db
      .batch([
        db
          .prepare(
            `INSERT INTO stock_reservations
               (id, order_id, variant_id, location_id, quantity, status, expires_at, created_at, updated_at)
             VALUES ('r1', 'o1', 'v1', 'loc1', 5, 'active', ?1, ?2, ?2)`,
          )
          .bind(now + 60_000, now),
        db
          .prepare(
            `UPDATE inventory_levels SET reserved = reserved + 5, updated_at = ?1
              WHERE variant_id = 'v1' AND location_id = 'loc1'`,
          )
          .bind(now),
      ])
      .catch((e) => e);

    expect(classifySqlError(error).kind).toBe("check_violation");

    const reservations = await db
      .prepare(`SELECT COUNT(*) AS n FROM stock_reservations`)
      .first<{ n: number }>();
    const level = await db
      .prepare(`SELECT reserved FROM inventory_levels WHERE variant_id = 'v1'`)
      .first<{ reserved: number }>();

    expect(reservations?.n).toBe(0);
    expect(level?.reserved).toBe(0);
  });

  /*
   * Exactly one of two buyers of the final unit must succeed.
   *
   * Both transactions lock the same row with FOR UPDATE, so they serialise:
   * the first commits, the second re-reads the now-reserved row and finds
   * nothing available.
   */
  it("lets exactly one of two concurrent buyers take the last unit", async () => {
    const attempt = async (reservationId: string): Promise<boolean> =>
      db
        .transaction(async (tx) => {
          const level = await tx
            .prepare(
              `SELECT on_hand, reserved FROM inventory_levels
                WHERE variant_id = 'v1' AND location_id = 'loc1' FOR UPDATE`,
            )
            .first<{ on_hand: number; reserved: number }>();

          if (!level || level.on_hand - level.reserved < 1) return false;

          const now = Date.now();
          await tx
            .prepare(
              `INSERT INTO stock_reservations
                 (id, order_id, variant_id, location_id, quantity, status, expires_at, created_at, updated_at)
               VALUES (?1, 'o1', 'v1', 'loc1', 1, 'active', ?2, ?3, ?3)`,
            )
            .bind(reservationId, now + 60_000, now)
            .run();

          const update = await tx
            .prepare(
              `UPDATE inventory_levels SET reserved = reserved + 1, updated_at = ?1
                WHERE variant_id = 'v1' AND location_id = 'loc1'
                  AND reserved + 1 <= on_hand`,
            )
            .bind(now)
            .run();

          // A conditional UPDATE that matched nothing is a silent no-op in any
          // engine. Inside a real transaction we can see that and refuse,
          // which is the improvement over the D1 batch.
          if (update.meta.changes !== 1) throw new Error("stock_gone");
          return true;
        })
        .catch((error) => {
          if (error instanceof Error && error.message === "stock_gone") return false;
          throw error;
        });

    const [a, b] = await Promise.all([attempt("ra"), attempt("rb")]);

    expect([a, b].filter(Boolean)).toHaveLength(1);

    const level = await db
      .prepare(`SELECT on_hand, reserved FROM inventory_levels WHERE variant_id = 'v1'`)
      .first<{ on_hand: number; reserved: number }>();
    expect(level).toEqual({ on_hand: 1, reserved: 1 });

    const reservations = await db
      .prepare(`SELECT COUNT(*) AS n FROM stock_reservations WHERE status = 'active'`)
      .first<{ n: number }>();
    expect(reservations?.n).toBe(1);
  });
});

describe("driver value semantics", () => {
  beforeEach(async () => {
    await seedFixtures(db);
  });

  /*
   * Timestamps are epoch milliseconds in BIGINT. mysql2 returns BIGINT as a JS
   * number, which is correct ONLY while the value stays inside
   * Number.MAX_SAFE_INTEGER. This pins that: a driver upgrade that started
   * returning strings would break every comparison in the application, and it
   * would break them quietly — `"1789..." > 1789...` is false, so a session
   * would simply never expire.
   */
  it("returns BIGINT timestamps as exact JS numbers", async () => {
    const now = 1_789_000_000_123; // ~2026, in epoch millis.
    await db
      .prepare(
        `INSERT INTO stock_reservations
           (id, order_id, variant_id, location_id, quantity, status, expires_at, created_at, updated_at)
         VALUES ('r-big', 'o1', 'v1', 'loc1', 1, 'active', ?1, ?1, ?1)`,
      )
      .bind(now)
      .run();

    const row = await db
      .prepare(`SELECT expires_at FROM stock_reservations WHERE id = 'r-big'`)
      .first<{ expires_at: number }>();

    expect(typeof row?.expires_at).toBe("number");
    expect(row?.expires_at).toBe(now);
    expect(Number.isSafeInteger(row?.expires_at)).toBe(true);
  });

  /*
   * An AGGREGATE over an integer column is a DECIMAL in MariaDB, and mysql2
   * returns DECIMAL as a STRING by default. SQLite returns an integer.
   *
   * That difference took `/admin/clienti` down: the screen sums each
   * customer's order value, "1990" reached the money guard, and the guard
   * correctly refused it —
   *
   *     MoneyError: Money must be integer minor units, received 1990
   *
   * — on a page that could not fail against D1. `decimalNumbers: true` in the
   * adapter is what makes SUM a number, and this pins it: the option is one
   * line away from being removed as "a default nobody needs".
   */
  /*
   * ── THE APPLICATION BRINGS ITS OWN sql_mode ─────────────────────────────
   *
   * The merchant's MariaDB runs with `NO_AUTO_CREATE_USER,NO_ENGINE_SUBSTITUTION`
   * and NO `STRICT_TRANS_TABLES`. Every test in this file was written against a
   * server that had it, so every one of them would have kept passing locally
   * while the deployed shop quietly accepted data it should have refused: an
   * over-long product name truncated to fit, a non-numeric price stored as 0.
   *
   * The adapter therefore sets the mode itself, per connection, and this is
   * what stops that being deleted as "a default nobody needs". It asserts the
   * SESSION mode rather than the server's, because the server's is not ours.
   */
  /*
   * ── A BOUND PARAMETER COMPARED TO A LITERAL ─────────────────────────────
   *
   * This is the shape that took the storefront down on its first deploy:
   *
   *     Illegal mix of collations (utf8mb4_general_ci,COERCIBLE)
   *     and (utf8mb4_unicode_ci,COERCIBLE) for operation '='
   *
   * MariaDB gives a PREPARED statement's parameter the collation implied by
   * `character_set_client`, while a literal in the same statement takes
   * `collation_connection`. Where those differ, two COERCIBLE operands meet
   * and the server refuses to pick a winner.
   *
   * Nothing caught it: every test that compares a parameter does so against a
   * COLUMN, and a column's collation is IMPLICIT, which outranks COERCIBLE and
   * settles the question. It needs a parameter against a LITERAL, which is what
   * the storefront's legal-documents query does — and what this does.
   *
   * The health check passed throughout, because it runs no comparison at all.
   * The shop answered "ok" on /api/health and 500 on every page.
   */
  it("compares a bound parameter with a string literal", async () => {
    const row = await db
      .prepare("SELECT CASE WHEN ?1 = 'en' THEN 'english' ELSE 'italian' END AS which")
      .bind("it")
      .first<{ which: string }>();

    expect(row?.which).toBe("italian");
  });

  it("uses the schema's own collation, not the driver's default", async () => {
    /*
     * utf8mb4_unicode_ci, not utf8mb4_general_ci — and for an Italian shop the
     * difference is not academic. The two sort accented characters
     * differently, so a connection in general_ci would order a product list
     * differently from the index the database keeps for it.
     */
    const row = await db
      .prepare("SELECT @@session.collation_connection AS collation")
      .first<{ collation: string }>();

    expect(row?.collation).toBe("utf8mb4_unicode_ci");
  });

  it("sets a strict sql_mode on its own connections, whatever the server's default", async () => {
    const row = await db.prepare("SELECT @@session.sql_mode AS mode").first<{ mode: string }>();

    expect(row?.mode).toContain("STRICT_TRANS_TABLES");
    expect(row?.mode).toContain("ERROR_FOR_DIVISION_BY_ZERO");
  });

  it("refuses an over-long value rather than truncating it", async () => {
    /*
     * The consequence of the mode above, stated as behaviour.
     *
     * Without strict mode this INSERT succeeds and the stored value is
     * silently shortened — which for a SKU means two products can end up
     * sharing one, and the unique index that was supposed to prevent exactly
     * that never sees a conflict.
     */
    const now = Date.now();
    const tooLong = "X".repeat(200);

    await expect(
      db
        .prepare(
          `INSERT INTO product_variants (id, product_id, sku, active, is_default, sort_order, created_at, updated_at)
           VALUES ('v-toolong', 'p1', ?1, 1, 0, 99, ?2, ?2)`,
        )
        .bind(tooLong, now)
        .run(),
    ).rejects.toThrow();

    const row = await db
      .prepare("SELECT COUNT(*) AS n FROM product_variants WHERE id = 'v-toolong'")
      .first<{ n: number }>();
    expect(row?.n).toBe(0);
  });

  it("returns SUM over integer money as a number, not a string", async () => {
    const now = Date.now();

    /*
     * Two price lists, one variant. `variant_prices` is unique on
     * (variant_id, price_list_id), so two rows for one variant need two lists
     * — which is the constraint doing its job and is worth tripping over here
     * rather than in a screen.
     */
    for (const code of ["sum-a", "sum-b"]) {
      await db
        .prepare(
          `INSERT INTO price_lists (id, code, name, channel, is_default, active, created_at, updated_at)
           VALUES (?1, ?2, ?2, 'online', 0, 1, ?3, ?3)`,
        )
        .bind(`pl-${code}`, code, now)
        .run();
    }

    for (const [id, list, amount] of [
      ["vp-sum-1", "pl-sum-a", 1990],
      ["vp-sum-2", "pl-sum-b", 1290],
    ] as const) {
      await db
        .prepare(
          `INSERT INTO variant_prices (id, variant_id, price_list_id, amount, currency, created_at, updated_at)
           VALUES (?1,'v1',?2,?3,'EUR',?4,?4)`,
        )
        .bind(id, list, amount, now)
        .run();
    }

    const row = await db
      .prepare(
        `SELECT SUM(amount) AS total, COUNT(*) AS n, AVG(amount) AS mean
           FROM variant_prices WHERE price_list_id IN ('pl-sum-a','pl-sum-b')`,
      )
      .first<{ total: number; n: number; mean: number }>();

    expect(typeof row?.total).toBe("number");
    expect(row?.total).toBe(3280);
    expect(Number.isInteger(row?.total)).toBe(true);

    // COUNT is BIGINT rather than DECIMAL, and was already a number. Asserted
    // beside SUM so a future change cannot fix one and break the other.
    expect(typeof row?.n).toBe("number");
    expect(row?.n).toBe(2);

    // AVG is DECIMAL too, and is allowed to be fractional — what matters is
    // that it arrives as a number rather than as text.
    expect(typeof row?.mean).toBe("number");
    expect(row?.mean).toBeCloseTo(1640, 6);
  });

  it("keeps money as exact integer minor units", async () => {
    const now = Date.now();
    await db
      .prepare(
        `INSERT INTO price_lists (id, code, name, channel, is_default, active, created_at, updated_at)
         VALUES ('pl1','default','Default','online',1,1,?1,?1)`,
      )
      .bind(now)
      .run();
    await db
      .prepare(
        `INSERT INTO variant_prices (id, variant_id, price_list_id, amount, currency, created_at, updated_at)
         VALUES ('vp1','v1','pl1',?1,'EUR',?2,?2)`,
      )
      .bind(1999, now)
      .run();

    const row = await db
      .prepare(`SELECT amount FROM variant_prices WHERE id = 'vp1'`)
      .first<{ amount: number }>();
    expect(row?.amount).toBe(1999);
    expect(Number.isInteger(row?.amount)).toBe(true);
  });

  /*
   * `meta.changes` must mean what D1's did at the eleven call sites that read
   * it. Every one is a conditional claim, and this is the shape they all take.
   */
  it("reports one change for a claim that wins and zero for one that loses", async () => {
    const now = Date.now();
    await db
      .prepare(
        `INSERT INTO stock_reservations
           (id, order_id, variant_id, location_id, quantity, status, expires_at, created_at, updated_at)
         VALUES ('r-claim', 'o1', 'v1', 'loc1', 1, 'active', ?1, ?2, ?2)`,
      )
      .bind(now + 60_000, now)
      .run();

    const claim = `UPDATE stock_reservations
                      SET status = 'expired', released_at = ?1, updated_at = ?1
                    WHERE id = 'r-claim' AND status = 'active'`;

    const first = await db.prepare(claim).bind(now).run();
    const second = await db.prepare(claim).bind(now).run();

    expect(first.meta.changes).toBe(1);
    expect(second.meta.changes).toBe(0);
  });

  it("reports one change for an upsert that updated, matching D1 rather than MariaDB's 2", async () => {
    const now = Date.now();
    const upsert = db.prepare(
      `INSERT INTO brands (id, slug, name, sort_order, created_at, updated_at)
       VALUES ('b-up', 'upsert', ?1, 0, ?2, ?2)
       ON CONFLICT(id) DO UPDATE SET name = excluded.name, updated_at = ?2`,
    );

    const inserted = await upsert.bind("First", now).run();
    const updated = await upsert.bind("Second", now + 1).run();

    expect(inserted.meta.changes).toBe(1);
    expect(updated.meta.changes).toBe(1);

    const row = await db
      .prepare(`SELECT name FROM brands WHERE id = 'b-up'`)
      .first<{ name: string }>();
    expect(row?.name).toBe("Second");
  });

  /*
   * Under STRICT_TRANS_TABLES an over-long value is an error rather than a
   * silent truncation. That is the behaviour the import relies on to reject a
   * row instead of storing half of it, so it is pinned here: a server whose
   * sql_mode drops strictness would otherwise shorten merchant data with no
   * signal at all.
   */
  it("errors rather than truncating a value that exceeds its column", async () => {
    const tooLong = "x".repeat(300);
    const error = await db
      .prepare(
        `INSERT INTO brands (id, slug, name, sort_order, created_at, updated_at)
         VALUES ('b-long', 'long', ?1, 0, ?2, ?2)`,
      )
      .bind(tooLong, Date.now())
      .run()
      .catch((e) => e);

    expect(error).toBeInstanceOf(Error);
    expect(String(error)).toMatch(/too long|Data too long/i);
  });
});
