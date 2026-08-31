/**
 * Minimal fixture data for integration tests.
 *
 * Deliberately small and explicit: a test that fails should point at one rule,
 * not at a hundred rows of scenery.
 */
import { SETTING_KEYS } from "~/domain/content/gates";

export const IDS = {
  location: "loc_shop",
  brand: "brand_generic",
  category: "cat_cover",
  product: "prod_case",
  variant: "var_case_black",
  variantB: "var_case_blue",
  priceList: "pl_online",
  paymentMethod: "pm_transfer",
  deviceBrand: "dbrand_apple",
  deviceFamily: "dfam_iphone16",
  deviceModel: "dmodel_iphone16pro",
  deviceModelOther: "dmodel_iphone16promax",
} as const;

const NOW = 1_756_000_000_000;

export interface SeedOptions {
  onHand?: number;
  reserved?: number;
  price?: number;
  allowBackorder?: boolean;
  paymentMethodActive?: boolean;
}

/**
 * Tables cleared before each seed, in foreign-key-safe order (children first).
 *
 * @cloudflare/vitest-pool-workers 0.22 dropped the `isolatedStorage` option, so
 * the database persists across tests in a file. Resetting explicitly is more
 * honest than depending on a pool behaviour that has already changed once.
 */
/**
 * The order tables must be emptied in, computed from the LIVE schema.
 *
 * This used to be a hand-written list of twenty-odd table names. It was wrong:
 * sixty-one tables were missing from it, so any test touching one of them
 * leaked rows into the next test, and adding a row to `price_history` made
 * `reset` fail outright on a restrict foreign key.
 *
 * A list that has to be updated whenever a migration adds a table will fall out
 * of date again — this one already had — so it is derived instead. SQLite tells
 * us both the tables and their foreign keys, and a topological sort puts every
 * child before its parent.
 *
 * Computed once per process: the schema does not change between tests, and
 * doing this per test would add a hundred pragma round trips to every one.
 */
let deleteOrder: string[] | null = null;

async function tableDeleteOrder(db: D1Database): Promise<string[]> {
  if (deleteOrder !== null) return deleteOrder;

  const tables = await db
    .prepare(
      `SELECT name FROM sqlite_master
        WHERE type = 'table'
          AND name NOT LIKE 'sqlite_%'
          AND name NOT LIKE '_cf_%'
          AND name <> 'd1_migrations'`,
    )
    .all<{ name: string }>();

  const names = tables.results.map((r) => r.name);

  /** table -> the tables it points AT. */
  const dependsOn = new Map<string, Set<string>>();
  for (const name of names) {
    const fks = await db.prepare(`PRAGMA foreign_key_list(${name})`).all<{ table: string }>();
    dependsOn.set(
      name,
      // A self-reference (a category with a parent category) would otherwise
      // make the table depend on itself and never sort.
      new Set(fks.results.map((r) => r.table).filter((t) => t !== name && names.includes(t))),
    );
  }

  // Children first: a table is safe to empty once everything pointing at it is
  // already empty.
  const order: string[] = [];
  const placed = new Set<string>();

  while (order.length < names.length) {
    const ready = names.filter(
      (name) =>
        !placed.has(name) &&
        // Everything that REFERENCES this table has already been emptied.
        names.every(
          (other) => placed.has(other) || other === name || !dependsOn.get(other)!.has(name),
        ),
    );

    if (ready.length === 0) {
      // A foreign-key cycle. Rather than loop forever, empty the rest in any
      // order and let the batch fail loudly if it genuinely cannot be done.
      order.push(...names.filter((n) => !placed.has(n)));
      break;
    }

    for (const name of ready) {
      order.push(name);
      placed.add(name);
    }
  }

  deleteOrder = order;
  return order;
}

export async function reset(db: D1Database): Promise<void> {
  const order = await tableDeleteOrder(db);
  await db.batch(order.map((t) => db.prepare(`DELETE FROM ${t}`)));
}

export async function seed(db: D1Database, options: SeedOptions = {}): Promise<void> {
  const {
    onHand = 1,
    reserved = 0,
    price = 3990,
    allowBackorder = false,
    paymentMethodActive = true,
  } = options;

  await reset(db);

  /*
   * Every merchant setting, created EMPTY.
   *
   * This mirrors what `scripts/import/seed.mjs` does on a real installation:
   * the rows exist so the storefront's feature gates have something to read,
   * and every value is blank because no merchant information is invented.
   *
   * The fixture previously created no settings at all, which quietly made a
   * whole class of behaviour untestable — the save path, the gates and the
   * setup checklist all read this table, and against an empty one they were
   * being exercised against a state no real installation is ever in.
   */
  await db.batch(
    Object.values(SETTING_KEYS).map((key) =>
      db
        .prepare(
          `INSERT INTO store_settings
             (id, key, value, value_type, category, gates_feature, created_at, updated_at)
           VALUES (?1, ?2, '', 'string', ?3, 0, ?4, ?4)
           ON CONFLICT(key) DO NOTHING`,
        )
        .bind(`set_${key.replace(".", "_")}`, key, key.split(".")[0], NOW),
    ),
  );

  await db.batch([
    db
      .prepare(
        `INSERT INTO inventory_locations (id, code, name, location_type, sellable_online, sellable_in_store, active, sort_order, created_at, updated_at)
         VALUES (?1,'shop','Sulmona','shop',1,1,1,0,?2,?2)`,
      )
      .bind(IDS.location, NOW),

    db
      .prepare(
        `INSERT INTO brands (id, slug, name, sort_order, created_at, updated_at) VALUES (?1,'generic','Generic',0,?2,?2)`,
      )
      .bind(IDS.brand, NOW),

    db
      .prepare(
        `INSERT INTO categories (id, slug, path, depth, accessory_type, sort_order, visible, created_at, updated_at)
         VALUES (?1,'cover','cover',0,'case',0,1,?2,?2)`,
      )
      .bind(IDS.category, NOW),

    db
      .prepare(
        `INSERT INTO products (id, slug, status, brand_id, primary_category_id, accessory_type, is_featured, is_new, is_bestseller, published_at, created_at, updated_at)
         VALUES (?1,'cover-test','active',?2,?3,'case',0,0,0,?4,?4,?4)`,
      )
      .bind(IDS.product, IDS.brand, IDS.category, NOW),

    db
      .prepare(
        `INSERT INTO product_translations (id, product_id, locale, name, short_description)
         VALUES ('ptr_it',?1,'it','Cover di prova','Una cover di prova')`,
      )
      .bind(IDS.product),

    db
      .prepare(
        `INSERT INTO product_variants (id, product_id, sku, variant_label, colour, pack_size, active, is_default, available_online, available_for_pickup, allow_backorder, sort_order, created_at, updated_at)
         VALUES (?1,?2,'SKU-BLACK','Nero','Nero',1,1,1,1,1,?3,0,?4,?4)`,
      )
      .bind(IDS.variant, IDS.product, allowBackorder ? 1 : 0, NOW),

    db
      .prepare(
        `INSERT INTO price_lists (id, code, name, channel, is_default, active, created_at, updated_at)
         VALUES (?1,'online','Online','online',1,1,?2,?2)`,
      )
      .bind(IDS.priceList, NOW),

    db
      .prepare(
        `INSERT INTO variant_prices (id, variant_id, price_list_id, amount, currency, created_at, updated_at)
         VALUES ('vp_1',?1,?2,?3,'EUR',?4,?4)`,
      )
      .bind(IDS.variant, IDS.priceList, price, NOW),

    db
      .prepare(
        `INSERT INTO inventory_levels (id, variant_id, location_id, on_hand, reserved, incoming, allow_backorder, created_at, updated_at)
         VALUES ('il_1',?1,?2,?3,?4,0,?5,?6,?6)`,
      )
      .bind(IDS.variant, IDS.location, onHand, reserved, allowBackorder ? 1 : 0, NOW),

    db
      .prepare(
        `INSERT INTO payment_methods (id, code, method_type, name_it, name_en, active, sort_order, reservation_minutes, eligible_for_shipping, eligible_for_pickup, created_at, updated_at)
         VALUES (?1,'bank_transfer','bank_transfer','Bonifico bancario','Bank transfer',?2,0,1440,1,1,?3,?3)`,
      )
      .bind(IDS.paymentMethod, paymentMethodActive ? 1 : 0, NOW),

    db
      .prepare(
        `INSERT INTO device_brands (id, handle, name, sort_order, active, created_at, updated_at)
         VALUES (?1,'apple','Apple',0,1,?2,?2)`,
      )
      .bind(IDS.deviceBrand, NOW),

    db
      .prepare(
        `INSERT INTO device_families (id, device_brand_id, handle, name, sort_order, active, created_at, updated_at)
         VALUES (?1,?2,'iphone-16','iPhone 16',0,1,?3,?3)`,
      )
      .bind(IDS.deviceFamily, IDS.deviceBrand, NOW),

    db
      .prepare(
        `INSERT INTO device_models (id, device_brand_id, device_family_id, handle, name, is_popular, sort_order, active, created_at, updated_at)
         VALUES (?1,?2,?3,'iphone-16-pro','iPhone 16 Pro',1,0,1,?4,?4)`,
      )
      .bind(IDS.deviceModel, IDS.deviceBrand, IDS.deviceFamily, NOW),

    db
      .prepare(
        `INSERT INTO device_models (id, device_brand_id, device_family_id, handle, name, is_popular, sort_order, active, created_at, updated_at)
         VALUES (?1,?2,?3,'iphone-16-pro-max','iPhone 16 Pro Max',1,1,1,?4,?4)`,
      )
      .bind(IDS.deviceModelOther, IDS.deviceBrand, IDS.deviceFamily, NOW),

    db
      .prepare(
        `INSERT INTO product_compatibility (id, product_id, variant_id, device_model_id, compatibility_level, verified, created_at, updated_at)
         VALUES ('pc_1',?1,NULL,?2,'exact_fit',1,?3,?3)`,
      )
      .bind(IDS.product, IDS.deviceModel, NOW),
  ]);
}

export function orderInput(over: Record<string, unknown> = {}) {
  return {
    cartToken: "cart_test",
    idempotencyKey: `idem_${Math.random().toString(36).slice(2)}`,
    customerFirstName: "Mario",
    customerLastName: "Rossi",
    customerEmail: "mario@example.test",
    deliveryMethod: "pickup" as const,
    paymentMethodId: IDS.paymentMethod,
    lines: [{ variantId: IDS.variant, quantity: 1 }],
    ...over,
  };
}
