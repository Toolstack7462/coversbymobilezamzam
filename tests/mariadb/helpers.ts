/**
 * Shared setup for the MariaDB integration tests.
 *
 * These tests talk to a REAL MariaDB server. That is the whole point: the
 * project already has 648 tests that pass against SQLite, and not one of them
 * would have caught `MAX(0, x)` meaning something different, a VARCHAR chosen
 * too short, or a CHECK constraint that MariaDB parses but never evaluates.
 * SQLite passing is not MariaDB evidence.
 *
 * The server is started by `npm run mariadb:start` (scripts/hostinger/local-db.mjs)
 * and reached through TEST_DB_* environment variables so CI can point the same
 * suite at its own service container.
 */

import fs from "node:fs";
import path from "node:path";
import mysql from "mysql2/promise";
import { MariaDbDatabase } from "~/infrastructure/db/mariadb";

export const TEST_DB = {
  host: process.env.TEST_DB_HOST ?? "127.0.0.1",
  port: Number(process.env.TEST_DB_PORT ?? 3399),
  user: process.env.TEST_DB_USER ?? "root",
  password: process.env.TEST_DB_PASSWORD ?? "",
  database: process.env.TEST_DB_NAME ?? "zamzam_test",
};

const BASELINE = path.resolve(process.cwd(), "db/mariadb/migrations/0001_baseline.sql");
const SEARCH = path.resolve(process.cwd(), "db/mariadb/migrations/0002_search.sql");

/**
 * Splits a migration file into statements.
 *
 * Naive `split(";")` shreds a routine body, so `DELIMITER` blocks are honoured
 * the way the mysql client honours them.
 */
export function splitSqlFile(sql: string): string[] {
  const statements: string[] = [];
  let delimiter = ";";
  let buffer = "";

  for (const rawLine of sql.split(/\r?\n/)) {
    const line = rawLine.trimEnd();
    const delimiterChange = /^DELIMITER\s+(\S+)\s*$/i.exec(line.trim());
    if (delimiterChange) {
      if (buffer.trim() !== "") {
        statements.push(buffer.trim());
        buffer = "";
      }
      delimiter = delimiterChange[1] ?? ";";
      continue;
    }
    if (/^\s*--/.test(line) || line.trim() === "") continue;

    buffer += line + "\n";
    if (line.trimEnd().endsWith(delimiter)) {
      const statement = buffer.trim().slice(0, -delimiter.length).trim();
      if (statement !== "") statements.push(statement);
      buffer = "";
    }
  }
  if (buffer.trim() !== "") statements.push(buffer.trim());
  return statements;
}

/** Drops and recreates the test schema, then applies the target migrations. */
export async function resetSchema(): Promise<void> {
  const admin = await mysql.createConnection({
    host: TEST_DB.host,
    port: TEST_DB.port,
    user: TEST_DB.user,
    password: TEST_DB.password,
    multipleStatements: true,
  });

  try {
    await admin.query(`DROP DATABASE IF EXISTS \`${TEST_DB.database}\``);
    await admin.query(
      `CREATE DATABASE \`${TEST_DB.database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
    );
    await admin.query(`USE \`${TEST_DB.database}\``);

    for (const file of [BASELINE, SEARCH]) {
      if (!fs.existsSync(file)) continue;
      for (const statement of splitSqlFile(fs.readFileSync(file, "utf8"))) {
        try {
          await admin.query(statement);
        } catch (error) {
          // The statement is what makes a migration failure diagnosable; the
          // driver error is kept as the cause so the stack is not lost.
          throw new Error(
            `${path.basename(file)}: ${(error as Error).message}\n  ${statement.slice(0, 200)}`,
            { cause: error },
          );
        }
      }
    }
  } finally {
    await admin.end();
  }
}

export function testDb(): MariaDbDatabase {
  return new MariaDbDatabase({ ...TEST_DB, connectionLimit: 6 });
}

/**
 * The tables the fixtures write, in the order they must be DELETED from.
 *
 * Written out rather than derived, because the foreign keys are real here and
 * a wrong order fails with a constraint error that reads like a test bug.
 */
export const FIXTURE_TABLES = [
  "product_search_tokens",
  "product_search_documents",
  "product_specifications",
  "product_compatibility",
  "stock_movements",
  "stock_reservations",
  "order_items",
  "orders",
  "payment_methods",
  "inventory_levels",
  "inventory_locations",
  "variant_prices",
  "price_lists",
  "product_variants",
  "products",
  "brands",
  "device_models",
  "device_families",
  "device_brands",
] as const;

export async function truncateFixtures(db: MariaDbDatabase): Promise<void> {
  for (const table of FIXTURE_TABLES) {
    await db.prepare(`DELETE FROM ${table}`).run();
  }
}

/**
 * One product, one variant, one location, one unit in stock, one order.
 *
 * Enough to exercise the reservation path and nothing more. `stock_reservations
 * .order_id` is NOT NULL in this schema, so a reservation test needs a real
 * order row — which is worth knowing, because it means a reservation can never
 * be orphaned from the order that holds it.
 */
export async function seedFixtures(db: MariaDbDatabase, onHand = 1): Promise<void> {
  const now = Date.now();
  await db.batch([
    db
      .prepare(
        `INSERT INTO brands (id, slug, name, sort_order, created_at, updated_at)
         VALUES ('b1', 'acme', 'Acme', 0, ?1, ?1)`,
      )
      .bind(now),
    db
      .prepare(
        `INSERT INTO products (id, slug, brand_id, status, is_featured, created_at, updated_at)
         VALUES ('p1', 'p-one', 'b1', 'active', 0, ?1, ?1)`,
      )
      .bind(now),
    db
      .prepare(
        `INSERT INTO product_variants
           (id, product_id, sku, active, available_online, available_for_pickup, sort_order, created_at, updated_at)
         VALUES ('v1', 'p1', 'SKU-1', 1, 1, 1, 0, ?1, ?1)`,
      )
      .bind(now),
    db
      .prepare(
        `INSERT INTO inventory_locations
           (id, code, name, location_type, sellable_online, sellable_in_store, active, sort_order, created_at, updated_at)
         VALUES ('loc1', 'main', 'Negozio', 'store', 1, 1, 1, 0, ?1, ?1)`,
      )
      .bind(now),
    db
      .prepare(
        `INSERT INTO inventory_levels
           (id, variant_id, location_id, on_hand, reserved, allow_backorder, created_at, updated_at)
         VALUES ('il1', 'v1', 'loc1', ?1, 0, 0, ?2, ?2)`,
      )
      .bind(onHand, now),
    db
      .prepare(
        `INSERT INTO orders
           (id, order_number, tracking_token, status, customer_first_name, customer_last_name,
            customer_email, delivery_method, item_subtotal, grand_total, currency, created_at, updated_at)
         VALUES ('o1', 'ORD-1', 'tok-1', 'awaiting_customer_contact', 'Test', 'Cliente',
                 'test@example.invalid', 'pickup', 1000, 1000, 'EUR', ?1, ?1)`,
      )
      .bind(now),
  ]);
}
