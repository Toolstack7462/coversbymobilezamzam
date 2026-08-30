import { sqliteTable, text, index, uniqueIndex } from "drizzle-orm/sqlite-core";
import { pk, ts, bool, stamps, archivable, locale, sortOrder } from "./_shared";

/**
 * Merchant-editable content.
 *
 * Interface strings are NOT here - they live in app/locales/ and are reviewed
 * like code. This is the merchant's own content: pages, navigation, homepage
 * composition, legal documents and settings (ADR 0009).
 */

export const pages = sqliteTable(
  "pages",
  {
    id: pk(),
    slug: text("slug").notNull(),
    /** draft | scheduled | published | archived */
    status: text("status").notNull().default("draft"),
    /** Scheduled publication instant, UTC (invariant 10). */
    publishAt: ts("publish_at"),
    /** page | guide | legal */
    pageType: text("page_type").notNull().default("page"),
    sortOrder: sortOrder(),
    ...stamps(),
    ...archivable(),
  },
  (t) => [
    uniqueIndex("pages_slug_unique").on(t.slug),
    index("pages_status_idx").on(t.status, t.publishAt),
  ],
);

export const pageTranslations = sqliteTable(
  "page_translations",
  {
    id: pk(),
    pageId: text("page_id")
      .notNull()
      .references(() => pages.id, { onDelete: "cascade" }),
    locale: locale(),
    title: text("title").notNull(),
    excerpt: text("excerpt"),
    /** Sanitised on WRITE with an allowlist, not on render. */
    body: text("body"),
    seoTitle: text("seo_title"),
    seoDescription: text("seo_description"),
  },
  (t) => [uniqueIndex("page_translations_unique").on(t.pageId, t.locale)],
);

export const navigationMenus = sqliteTable(
  "navigation_menus",
  {
    id: pk(),
    /** main | footer_shop | footer_support | footer_legal | mobile */
    code: text("code").notNull(),
    name: text("name").notNull(),
    ...stamps(),
  },
  (t) => [uniqueIndex("navigation_menus_code_unique").on(t.code)],
);

export const navigationItems = sqliteTable(
  "navigation_items",
  {
    id: pk(),
    menuId: text("menu_id")
      .notNull()
      .references(() => navigationMenus.id, { onDelete: "cascade" }),
    parentId: text("parent_id"),
    labelIt: text("label_it").notNull(),
    labelEn: text("label_en").notNull(),
    url: text("url").notNull(),
    /** Optional icon key from the project icon set. Never an emoji. */
    iconName: text("icon_name"),
    /** Nesting drives the mega menu: level 1 tab, level 2 heading, level 3 link. */
    depth: sortOrder("depth"),
    sortOrder: sortOrder(),
    visible: bool("visible").notNull().default(true),
    ...stamps(),
  },
  (t) => [
    index("navigation_items_menu_idx").on(t.menuId, t.sortOrder),
    index("navigation_items_parent_idx").on(t.parentId),
  ],
);

/**
 * Homepage composition. Order and visibility are merchant-controlled.
 *
 * A section whose data is missing renders NOTHING - not an empty frame, not a
 * heading over a blank space. An empty section looks broken; an absent one looks
 * finished (invariant 12).
 */
export const homepageSections = sqliteTable(
  "homepage_sections",
  {
    id: pk(),
    /** hero | device_finder | categories | bestsellers | brands | campaign | ... */
    sectionType: text("section_type").notNull(),
    sortOrder: sortOrder(),
    visible: bool("visible").notNull().default(true),
    /** JSON: section-specific settings such as selected product ids. */
    config: text("config"),
    ...stamps(),
  },
  (t) => [index("homepage_sections_order_idx").on(t.sortOrder)],
);

export const homepageSectionTranslations = sqliteTable(
  "homepage_section_translations",
  {
    id: pk(),
    sectionId: text("section_id")
      .notNull()
      .references(() => homepageSections.id, { onDelete: "cascade" }),
    locale: locale(),
    heading: text("heading"),
    subheading: text("subheading"),
    bodyText: text("body_text"),
    ctaLabel: text("cta_label"),
    ctaUrl: text("cta_url"),
  },
  (t) => [uniqueIndex("homepage_section_translations_unique").on(t.sectionId, t.locale)],
);

export const banners = sqliteTable(
  "banners",
  {
    id: pk(),
    /** utility_bar | category | product */
    placement: text("placement").notNull(),
    messageIt: text("message_it").notNull(),
    messageEn: text("message_en").notNull(),
    linkUrl: text("link_url"),
    imageKey: text("image_key"),
    startsAt: ts("starts_at"),
    endsAt: ts("ends_at"),
    active: bool("active").notNull().default(false),
    sortOrder: sortOrder(),
    ...stamps(),
  },
  (t) => [index("banners_placement_idx").on(t.placement, t.active)],
);

/**
 * Key/value merchant settings.
 *
 * Every value the merchant has not supplied lives here as an EMPTY string, and
 * the storefront gates on emptiness. A blank phone number renders no phone
 * number - never a placeholder, never a guess (invariant 12, CLAUDE.md §4).
 */
export const storeSettings = sqliteTable(
  "store_settings",
  {
    id: pk(),
    /** e.g. `business.vat_number`, `store.phone`, `whatsapp.number`. */
    key: text("key").notNull(),
    value: text("value").notNull().default(""),
    /** string | number | boolean | json | url | email | phone */
    valueType: text("value_type").notNull().default("string"),
    /** Grouping for the admin UI. */
    category: text("category").notNull(),
    descriptionIt: text("description_it"),
    /** True when a storefront feature is hidden while this is empty. */
    gatesFeature: bool("gates_feature").notNull().default(false),
    /** Encrypted at rest, and never rendered in full. */
    isSensitive: bool("is_sensitive").notNull().default(false),
    ...stamps(),
  },
  (t) => [
    uniqueIndex("store_settings_key_unique").on(t.key),
    index("store_settings_category_idx").on(t.category),
  ],
);

export const legalDocuments = sqliteTable(
  "legal_documents",
  {
    id: pk(),
    /** privacy | cookies | terms | shipping | returns | withdrawal | ... */
    code: text("code").notNull(),
    nameIt: text("name_it").notNull(),
    nameEn: text("name_en").notNull(),
    currentVersionId: text("current_version_id"),
    ...stamps(),
  },
  (t) => [uniqueIndex("legal_documents_code_unique").on(t.code)],
);

/**
 * Versioned, because "which terms did this customer accept?" must be answerable
 * months later. The accepted version id is recorded on the order.
 */
export const legalDocumentVersions = sqliteTable(
  "legal_document_versions",
  {
    id: pk(),
    documentId: text("document_id")
      .notNull()
      .references(() => legalDocuments.id, { onDelete: "cascade" }),
    version: text("version").notNull(),
    bodyIt: text("body_it"),
    bodyEn: text("body_en"),
    effectiveFrom: ts("effective_from").notNull(),
    publishedAt: ts("published_at"),
    publishedBy: text("published_by"),
    /**
     * Set only when a lawyer has actually reviewed this version. The system
     * never claims generated legal text is reviewed.
     */
    reviewedByLawyer: bool("reviewed_by_lawyer").notNull().default(false),
    reviewNote: text("review_note"),
    createdAt: ts("created_at").notNull(),
  },
  (t) => [
    uniqueIndex("legal_document_versions_unique").on(t.documentId, t.version),
    index("legal_document_versions_effective_idx").on(t.documentId, t.effectiveFrom),
  ],
);
