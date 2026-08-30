import { sqliteTable, text, integer, index, uniqueIndex } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";
import { pk, ts, bool, stamps, archivable, locale, sortOrder } from "./_shared";
import { products, productVariants } from "./catalogue";

/**
 * Device compatibility.
 *
 * Brand -> Family -> Model, with compatibility attaching to the exact MODEL.
 * iPhone 16 and iPhone 16 Pro are different sizes; a case for one does not fit
 * the other, so family-level compatibility would be a lie for cases.
 *
 * Brands are rows, not code. This list changes every year and a new brand must
 * not require a deployment.
 */

export const deviceBrands = sqliteTable(
  "device_brands",
  {
    id: pk(),
    handle: text("handle").notNull(),
    name: text("name").notNull(),
    logoKey: text("logo_key"),
    sortOrder: sortOrder(),
    active: bool("active").notNull().default(true),
    ...stamps(),
    ...archivable(),
  },
  (t) => [uniqueIndex("device_brands_handle_unique").on(t.handle)],
);

export const deviceBrandTranslations = sqliteTable(
  "device_brand_translations",
  {
    id: pk(),
    deviceBrandId: text("device_brand_id")
      .notNull()
      .references(() => deviceBrands.id, { onDelete: "cascade" }),
    locale: locale(),
    description: text("description"),
  },
  (t) => [uniqueIndex("device_brand_translations_unique").on(t.deviceBrandId, t.locale)],
);

export const deviceFamilies = sqliteTable(
  "device_families",
  {
    id: pk(),
    deviceBrandId: text("device_brand_id")
      .notNull()
      .references(() => deviceBrands.id, { onDelete: "restrict" }),
    handle: text("handle").notNull(),
    name: text("name").notNull(),
    releaseYear: integer("release_year"),
    sortOrder: sortOrder(),
    active: bool("active").notNull().default(true),
    ...stamps(),
    ...archivable(),
  },
  (t) => [
    uniqueIndex("device_families_handle_unique").on(t.handle),
    index("device_families_brand_idx").on(t.deviceBrandId, t.sortOrder),
  ],
);

export const deviceFamilyTranslations = sqliteTable(
  "device_family_translations",
  {
    id: pk(),
    deviceFamilyId: text("device_family_id")
      .notNull()
      .references(() => deviceFamilies.id, { onDelete: "cascade" }),
    locale: locale(),
    description: text("description"),
  },
  (t) => [uniqueIndex("device_family_translations_unique").on(t.deviceFamilyId, t.locale)],
);

export const deviceModels = sqliteTable(
  "device_models",
  {
    id: pk(),
    deviceBrandId: text("device_brand_id")
      .notNull()
      .references(() => deviceBrands.id, { onDelete: "restrict" }),
    deviceFamilyId: text("device_family_id")
      .notNull()
      .references(() => deviceFamilies.id, { onDelete: "restrict" }),
    /** Canonical, URL-safe: `iphone-16-pro`. */
    handle: text("handle").notNull(),
    /** Canonical display name: `iPhone 16 Pro`. */
    name: text("name").notNull(),
    releaseYear: integer("release_year"),
    imageKey: text("image_key"),
    /** usb_c | lightning | micro_usb - drives cable and charger relevance. */
    connector: text("connector"),
    /** Popular devices lead the finder so most customers pick in one tap. */
    isPopular: bool("is_popular").notNull().default(false),
    sortOrder: sortOrder(),
    active: bool("active").notNull().default(true),
    ...stamps(),
    ...archivable(),
  },
  (t) => [
    uniqueIndex("device_models_handle_unique").on(t.handle),
    index("device_models_family_idx").on(t.deviceFamilyId, t.sortOrder),
    index("device_models_brand_idx").on(t.deviceBrandId),
    index("device_models_popular_idx").on(t.isPopular, t.sortOrder),
  ],
);

export const deviceModelTranslations = sqliteTable(
  "device_model_translations",
  {
    id: pk(),
    deviceModelId: text("device_model_id")
      .notNull()
      .references(() => deviceModels.id, { onDelete: "cascade" }),
    locale: locale(),
    displayName: text("display_name"),
    notes: text("notes"),
  },
  (t) => [uniqueIndex("device_model_translations_unique").on(t.deviceModelId, t.locale)],
);

/**
 * How real people type a model: `iphone16pro`, `ip16 pro`, `16 pro`.
 *
 * Without these, a customer searching the way they actually think gets zero
 * results - which reads as "you do not stock it" rather than "spell it our way".
 */
export const deviceAliases = sqliteTable(
  "device_aliases",
  {
    id: pk(),
    deviceModelId: text("device_model_id")
      .notNull()
      .references(() => deviceModels.id, { onDelete: "cascade" }),
    alias: text("alias").notNull(),
    /** Normalised: lowercase, punctuation and spaces stripped. Matched on this. */
    aliasNormalised: text("alias_normalised").notNull(),
  },
  (t) => [
    uniqueIndex("device_aliases_unique").on(t.deviceModelId, t.aliasNormalised),
    index("device_aliases_lookup_idx").on(t.aliasNormalised),
  ],
);

/**
 * The authoritative compatibility record. Compatibility exists here or it does
 * not exist (invariant 3).
 *
 * `variant_id` null means the record covers the whole product; set means it
 * overrides for that variant. The unique index spans both so one
 * product/variant/device triple cannot carry two contradictory levels.
 */
export const productCompatibility = sqliteTable(
  "product_compatibility",
  {
    id: pk(),
    productId: text("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    variantId: text("variant_id").references(() => productVariants.id, { onDelete: "cascade" }),
    deviceModelId: text("device_model_id")
      .notNull()
      .references(() => deviceModels.id, { onDelete: "restrict" }),
    /**
     * exact_fit | compatible | universal | adapter_required | incompatible |
     * unverified
     */
    compatibilityLevel: text("compatibility_level").notNull(),
    note: text("note"),
    verified: bool("verified").notNull().default(false),
    /** manufacturer_spec | physical_test | supplier_data | staff_judgement */
    verificationSource: text("verification_source"),
    verifiedBy: text("verified_by"),
    verifiedAt: ts("verified_at"),
    ...stamps(),
  },
  (t) => [
    /**
     * TWO partial unique indexes, not one composite index over a nullable
     * column.
     *
     * SQLite treats NULLs as distinct in a unique index, so a single
     * UNIQUE(product_id, variant_id, device_model_id) would happily accept two
     * product-level rows (variant_id NULL) for the same device carrying
     * CONTRADICTORY levels - exactly the thing this constraint exists to stop.
     * Splitting on nullability closes that hole.
     */
    uniqueIndex("product_compatibility_variant_unique")
      .on(t.productId, t.variantId, t.deviceModelId)
      .where(sql`variant_id IS NOT NULL`),
    uniqueIndex("product_compatibility_product_unique")
      .on(t.productId, t.deviceModelId)
      .where(sql`variant_id IS NULL`),
    // The hottest query in the application: the device-filtered catalogue.
    index("product_compatibility_device_idx").on(t.deviceModelId, t.productId),
    index("product_compatibility_product_idx").on(t.productId),
  ],
);

/**
 * History of verification changes. A record entered from a supplier spreadsheet
 * is not the same claim as one where someone put the case on the phone, and the
 * difference must survive later edits.
 */
export const compatibilityVerificationLogs = sqliteTable(
  "compatibility_verification_logs",
  {
    id: pk(),
    compatibilityId: text("compatibility_id")
      .notNull()
      .references(() => productCompatibility.id, { onDelete: "cascade" }),
    previousLevel: text("previous_level"),
    newLevel: text("new_level").notNull(),
    previousVerified: bool("previous_verified"),
    newVerified: bool("new_verified").notNull(),
    source: text("source"),
    note: text("note"),
    changedBy: text("changed_by").notNull(),
    createdAt: ts("created_at").notNull(),
  },
  (t) => [index("compatibility_logs_compat_idx").on(t.compatibilityId, t.createdAt)],
);

/**
 * Links the same accessory across device sizes: "Premium Clear Case" for
 * iPhone 16 Pro and 16 Pro Max are separate products, correctly, and this is how
 * a customer who landed on the wrong one gets to the right one.
 */
export const productFamilies = sqliteTable(
  "product_families",
  {
    id: pk(),
    handle: text("handle").notNull(),
    nameIt: text("name_it").notNull(),
    nameEn: text("name_en").notNull(),
    ...stamps(),
    ...archivable(),
  },
  (t) => [uniqueIndex("product_families_handle_unique").on(t.handle)],
);

export const productFamilyMembers = sqliteTable(
  "product_family_members",
  {
    id: pk(),
    productFamilyId: text("product_family_id")
      .notNull()
      .references(() => productFamilies.id, { onDelete: "cascade" }),
    productId: text("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    sortOrder: sortOrder(),
  },
  (t) => [
    uniqueIndex("product_family_members_unique").on(t.productFamilyId, t.productId),
    index("product_family_members_product_idx").on(t.productId),
  ],
);
