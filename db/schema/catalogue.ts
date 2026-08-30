import { sqliteTable, text, integer, index, uniqueIndex } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";
import { pk, ts, bool, stamps, archivable, locale, sortOrder } from "./_shared";

/**
 * Catalogue.
 *
 * A product is a commercial concept; a variant is a sellable SKU. Cases and
 * exact-fit screen protectors for differently sized devices are SEPARATE
 * products - "Premium Clear Case - iPhone 16 Pro" and "... 16 Pro Max" - because
 * they are not interchangeable choices. They are linked through a product family
 * (see compatibility.ts) so a customer can move between them.
 *
 * Variants are for genuine sellable choices: colour, length, capacity,
 * connector, pack size.
 */

export const brands = sqliteTable(
  "brands",
  {
    id: pk(),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    logoKey: text("logo_key"),
    websiteUrl: text("website_url"),
    sortOrder: sortOrder(),
    ...stamps(),
    ...archivable(),
  },
  (t) => [uniqueIndex("brands_slug_unique").on(t.slug)],
);

export const brandTranslations = sqliteTable(
  "brand_translations",
  {
    id: pk(),
    brandId: text("brand_id")
      .notNull()
      .references(() => brands.id, { onDelete: "cascade" }),
    locale: locale(),
    description: text("description"),
  },
  (t) => [uniqueIndex("brand_translations_unique").on(t.brandId, t.locale)],
);

/**
 * Self-referencing tree. `path` is materialised ("cover/apple/iphone-16-pro") so
 * breadcrumbs and descendant queries are a prefix match rather than recursion at
 * request time.
 */
export const categories = sqliteTable(
  "categories",
  {
    id: pk(),
    slug: text("slug").notNull(),
    parentId: text("parent_id"),
    path: text("path").notNull(),
    depth: integer("depth").notNull().default(0),
    /** Drives which specification rows and filters appear. */
    accessoryType: text("accessory_type"),
    imageKey: text("image_key"),
    sortOrder: sortOrder(),
    visible: bool("visible").notNull().default(true),
    ...stamps(),
    ...archivable(),
  },
  (t) => [
    uniqueIndex("categories_slug_unique").on(t.slug),
    index("categories_parent_idx").on(t.parentId),
    index("categories_path_idx").on(t.path),
  ],
);

export const categoryTranslations = sqliteTable(
  "category_translations",
  {
    id: pk(),
    categoryId: text("category_id")
      .notNull()
      .references(() => categories.id, { onDelete: "cascade" }),
    locale: locale(),
    name: text("name").notNull(),
    description: text("description"),
    seoTitle: text("seo_title"),
    seoDescription: text("seo_description"),
  },
  (t) => [uniqueIndex("category_translations_unique").on(t.categoryId, t.locale)],
);

export const products = sqliteTable(
  "products",
  {
    id: pk(),
    slug: text("slug").notNull(),
    /** draft | active | archived */
    status: text("status").notNull().default("draft"),
    brandId: text("brand_id").references(() => brands.id, { onDelete: "restrict" }),
    primaryCategoryId: text("primary_category_id").references(() => categories.id, {
      onDelete: "restrict",
    }),
    accessoryType: text("accessory_type"),
    productFamilyId: text("product_family_id"),
    /**
     * "Più venduto" is a claim about real sales. It is a deliberate merchant
     * decision, never a default (invariant 11).
     */
    isFeatured: bool("is_featured").notNull().default(false),
    isNew: bool("is_new").notNull().default(false),
    isBestseller: bool("is_bestseller").notNull().default(false),
    publishedAt: ts("published_at"),
    ...stamps(),
    ...archivable(),
  },
  (t) => [
    uniqueIndex("products_slug_unique").on(t.slug),
    // Every storefront listing filters on exactly this pair.
    index("products_status_idx").on(t.status, t.archivedAt),
    index("products_brand_idx").on(t.brandId),
    index("products_family_idx").on(t.productFamilyId),
  ],
);

export const productTranslations = sqliteTable(
  "product_translations",
  {
    id: pk(),
    productId: text("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    locale: locale(),
    name: text("name").notNull(),
    shortDescription: text("short_description"),
    fullDescription: text("full_description"),
    seoTitle: text("seo_title"),
    seoDescription: text("seo_description"),
  },
  (t) => [uniqueIndex("product_translations_unique").on(t.productId, t.locale)],
);

export const productVariants = sqliteTable(
  "product_variants",
  {
    id: pk(),
    productId: text("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "restrict" }),
    sku: text("sku").notNull(),
    barcode: text("barcode"),
    /** Human-readable summary, e.g. "Nero / 2 m". Snapshotted onto order items. */
    variantLabel: text("variant_label"),
    colour: text("colour"),
    lengthMm: integer("length_mm"),
    capacityMah: integer("capacity_mah"),
    connector: text("connector"),
    packSize: integer("pack_size").notNull().default(1),
    weightGrams: integer("weight_grams"),
    dimensionsMm: text("dimensions_mm"),
    active: bool("active").notNull().default(true),
    isDefault: bool("is_default").notNull().default(false),
    availableOnline: bool("available_online").notNull().default(true),
    availableForPickup: bool("available_for_pickup").notNull().default(true),
    allowBackorder: bool("allow_backorder").notNull().default(false),
    sortOrder: sortOrder(),
    ...stamps(),
    ...archivable(),
  },
  (t) => [
    uniqueIndex("product_variants_sku_unique").on(t.sku),
    uniqueIndex("product_variants_barcode_unique").on(t.barcode),
    index("product_variants_product_idx").on(t.productId),
  ],
);

export const variantOptionGroups = sqliteTable(
  "variant_option_groups",
  {
    id: pk(),
    productId: text("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    /** colour | length | capacity | connector | pack_size */
    code: text("code").notNull(),
    nameIt: text("name_it").notNull(),
    nameEn: text("name_en").notNull(),
    sortOrder: sortOrder(),
  },
  (t) => [uniqueIndex("variant_option_groups_unique").on(t.productId, t.code)],
);

export const variantOptionValues = sqliteTable(
  "variant_option_values",
  {
    id: pk(),
    groupId: text("group_id")
      .notNull()
      .references(() => variantOptionGroups.id, { onDelete: "cascade" }),
    value: text("value").notNull(),
    labelIt: text("label_it").notNull(),
    labelEn: text("label_en").notNull(),
    /** Swatch colour for colour options. Presentational only. */
    swatchHex: text("swatch_hex"),
    sortOrder: sortOrder(),
  },
  (t) => [uniqueIndex("variant_option_values_unique").on(t.groupId, t.value)],
);

export const variantOptionAssignments = sqliteTable(
  "variant_option_assignments",
  {
    id: pk(),
    variantId: text("variant_id")
      .notNull()
      .references(() => productVariants.id, { onDelete: "cascade" }),
    optionValueId: text("option_value_id")
      .notNull()
      .references(() => variantOptionValues.id, { onDelete: "restrict" }),
  },
  (t) => [uniqueIndex("variant_option_assignments_unique").on(t.variantId, t.optionValueId)],
);

export const productImages = sqliteTable(
  "product_images",
  {
    id: pk(),
    productId: text("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    /** Optional: an image that belongs to one variant only. */
    variantId: text("variant_id").references(() => productVariants.id, { onDelete: "set null" }),
    /** R2 object key in the PUBLIC media bucket. Random, never the upload name. */
    objectKey: text("object_key").notNull(),
    altIt: text("alt_it"),
    altEn: text("alt_en"),
    /** Stored so the markup can reserve space and avoid layout shift. */
    width: integer("width").notNull(),
    height: integer("height").notNull(),
    mimeType: text("mime_type").notNull(),
    fileSize: integer("file_size").notNull(),
    /** Content hash, for de-duplication and for the media inventory check. */
    fileHash: text("file_hash").notNull(),
    isPrimary: bool("is_primary").notNull().default(false),
    sortOrder: sortOrder(),
    createdAt: ts("created_at").notNull(),
  },
  (t) => [
    index("product_images_product_idx").on(t.productId, t.sortOrder),
    index("product_images_variant_idx").on(t.variantId),
  ],
);

export const productCategoryAssignments = sqliteTable(
  "product_category_assignments",
  {
    id: pk(),
    productId: text("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    categoryId: text("category_id")
      .notNull()
      .references(() => categories.id, { onDelete: "restrict" }),
  },
  (t) => [
    uniqueIndex("product_category_assignments_unique").on(t.productId, t.categoryId),
    index("product_category_category_idx").on(t.categoryId),
  ],
);

/** related | accessory | replaces | requires | bundle_with */
export const productRelationships = sqliteTable(
  "product_relationships",
  {
    id: pk(),
    productId: text("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    relatedProductId: text("related_product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    relationshipType: text("relationship_type").notNull(),
    sortOrder: sortOrder(),
  },
  (t) => [
    uniqueIndex("product_relationships_unique").on(
      t.productId,
      t.relatedProductId,
      t.relationshipType,
    ),
  ],
);

/**
 * Key/value rather than sixty mostly-null columns. A charger has wattage; a case
 * does not. Rows with no value are simply absent, so a spec table is never
 * half-empty on screen.
 */
export const productSpecifications = sqliteTable(
  "product_specifications",
  {
    id: pk(),
    productId: text("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    variantId: text("variant_id").references(() => productVariants.id, { onDelete: "cascade" }),
    /** e.g. `wattage_total`, `connector_a`, `protection_level`. */
    specKey: text("spec_key").notNull(),
    valueText: text("value_text"),
    valueNumber: integer("value_number"),
    valueBool: bool("value_bool"),
    unit: text("unit"),
    sortOrder: sortOrder(),
  },
  (t) => [
    index("product_specifications_product_idx").on(t.productId),
    // Split on nullability for the same reason as product_compatibility: SQLite
    // treats NULLs as distinct, so one composite index would allow two
    // product-level rows for the same spec key.
    uniqueIndex("product_specifications_variant_unique")
      .on(t.productId, t.variantId, t.specKey)
      .where(sql`variant_id IS NOT NULL`),
    uniqueIndex("product_specifications_product_unique")
      .on(t.productId, t.specKey)
      .where(sql`variant_id IS NULL`),
  ],
);

/**
 * GPSR (EU) 2023/988 data.
 *
 * There is no `has_ce_mark` boolean, deliberately. A compliance mark drawn from
 * a flag is a false declaration; `certification` is recorded text the merchant
 * is accountable for (invariant 11).
 */
export const productSafetyInformation = sqliteTable(
  "product_safety_information",
  {
    id: pk(),
    productId: text("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    manufacturerName: text("manufacturer_name"),
    manufacturerAddress: text("manufacturer_address"),
    manufacturerContact: text("manufacturer_contact"),
    productIdentifier: text("product_identifier"),
    /** Required when the manufacturer is outside the EU. */
    responsiblePersonName: text("responsible_person_name"),
    responsiblePersonAddress: text("responsible_person_address"),
    responsiblePersonContact: text("responsible_person_contact"),
    warningsIt: text("warnings_it"),
    warningsEn: text("warnings_en"),
    manualUrl: text("manual_url"),
    recallNotice: text("recall_notice"),
    disposalInfoIt: text("disposal_info_it"),
    disposalInfoEn: text("disposal_info_en"),
    certification: text("certification"),
    batteryNotes: text("battery_notes"),
    ...stamps(),
  },
  (t) => [uniqueIndex("product_safety_product_unique").on(t.productId)],
);
