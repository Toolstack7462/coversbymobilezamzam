/**
 * Minimal fixture data for integration tests.
 *
 * Deliberately small and explicit: a test that fails should point at one rule,
 * not at a hundred rows of scenery.
 */

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
const TABLES_IN_DELETE_ORDER = [
  "audit_logs",
  "bootstrap_attempts",
  "installation_state",
  "step_up_sessions",
  "user_roles",
  "role_permissions",
  // roles and permissions come AFTER their join tables, which reference them.
  "roles",
  "permissions",
  "staff_profiles",
  "session",
  "account",
  "user",
  "order_events",
  "order_status_history",
  "order_addresses",
  "order_items",
  "payment_status_history",
  "order_payments",
  "orders",
  "stock_movements",
  "stock_reservations",
  "inventory_levels",
  "idempotency_keys",
  "scheduled_job_runs",
  "product_compatibility",
  "device_models",
  "device_families",
  "device_brands",
  "variant_prices",
  "price_lists",
  "product_variants",
  "product_translations",
  "products",
  "categories",
  "brands",
  "payment_methods",
  "inventory_locations",
] as const;

export async function reset(db: D1Database): Promise<void> {
  await db.batch(TABLES_IN_DELETE_ORDER.map((t) => db.prepare(`DELETE FROM ${t}`)));
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
