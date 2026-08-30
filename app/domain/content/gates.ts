/**
 * Configuration gates (invariant 12).
 *
 * A feature whose merchant data is missing is DISABLED and renders NOTHING.
 * Never a placeholder, never a guess.
 *
 * `[PHONE]` on a live storefront is worse than no phone number, and an invented
 * opening time sends a real person to a closed door. This module is the single
 * place that decides what is safe to show.
 */

export type SettingsMap = Readonly<Record<string, string>>;

/** Blank, whitespace-only, or an obvious placeholder someone pasted in. */
export function isConfigured(settings: SettingsMap, key: string): boolean {
  const value = settings[key];
  if (value == null) return false;
  const trimmed = value.trim();
  if (trimmed === "") return false;
  // Catches "[PHONE]", "TODO", "xxx", "n/a" and friends reaching production.
  if (/^(\[.*\]|todo|tbd|x{2,}|n\/?a|placeholder|-{2,})$/i.test(trimmed)) return false;
  return true;
}

export function allConfigured(settings: SettingsMap, keys: readonly string[]): boolean {
  return keys.every((k) => isConfigured(settings, k));
}

/** The configured value, or null. Components render nothing for null. */
export function settingValue(settings: SettingsMap, key: string): string | null {
  return isConfigured(settings, key) ? settings[key]!.trim() : null;
}

// ── Setting keys ─────────────────────────────────────────────────────────────

export const SETTING_KEYS = {
  brandName: "business.brand_name",
  shopName: "store.name",
  legalName: "business.legal_name",
  vatNumber: "business.vat_number",
  reaNumber: "business.rea_number",
  shareCapital: "business.share_capital",

  storeStreet: "store.street",
  storePostcode: "store.postcode",
  storeCity: "store.city",
  storeProvince: "store.province",
  storeCountry: "store.country",
  storeLatitude: "store.latitude",
  storeLongitude: "store.longitude",
  storeHoursDisplay: "store.hours_display",
  storeHoursStructured: "store.hours_structured",
  storeDirectionsUrl: "store.directions_url",
  storeParkingInfo: "store.parking_info",
  storeAccessibilityInfo: "store.accessibility_info",

  phone: "contact.phone",
  email: "contact.email",
  whatsappNumber: "contact.whatsapp_number",
  returnAddress: "contact.return_address",

  pickupEnabled: "pickup.enabled",
  pickupPreparationTime: "pickup.preparation_time",
  pickupInstructions: "pickup.instructions",

  shippingEnabled: "shipping.enabled",
  freeShippingThreshold: "shipping.free_threshold",
} as const;

// ── Gates ────────────────────────────────────────────────────────────────────

/**
 * The trader-identification block required by D.Lgs. 70/2003.
 *
 * All or nothing: a partial legal footer is arguably worse than none, because it
 * looks like compliance without being it.
 */
export function canShowLegalIdentity(settings: SettingsMap): boolean {
  return allConfigured(settings, [
    SETTING_KEYS.legalName,
    SETTING_KEYS.vatNumber,
    SETTING_KEYS.storeStreet,
    SETTING_KEYS.storePostcode,
    SETTING_KEYS.storeCity,
  ]);
}

/** The address is known from the brief, so this gate usually passes. */
export function canShowStoreAddress(settings: SettingsMap): boolean {
  return allConfigured(settings, [
    SETTING_KEYS.storeStreet,
    SETTING_KEYS.storePostcode,
    SETTING_KEYS.storeCity,
  ]);
}

/** The shop's public name is separate from the legal name and often differs. */
export function canShowStoreSection(settings: SettingsMap): boolean {
  return isConfigured(settings, SETTING_KEYS.shopName) && canShowStoreAddress(settings);
}

export function canShowOpeningHours(settings: SettingsMap): boolean {
  return isConfigured(settings, SETTING_KEYS.storeHoursDisplay);
}

/**
 * Structured hours are gated SEPARATELY from displayed hours.
 *
 * A wrong schema.org opening time appears in Google's results and sends someone
 * to a closed door, so if the merchant is unsure of the format it stays blank
 * while the human-readable text still shows.
 */
export function canEmitStructuredHours(settings: SettingsMap): boolean {
  return isConfigured(settings, SETTING_KEYS.storeHoursStructured);
}

export function canShowWhatsApp(settings: SettingsMap): boolean {
  return isConfigured(settings, SETTING_KEYS.whatsappNumber);
}

export function canShowPhone(settings: SettingsMap): boolean {
  return isConfigured(settings, SETTING_KEYS.phone);
}

export function canShowEmail(settings: SettingsMap): boolean {
  return isConfigured(settings, SETTING_KEYS.email);
}

/** True only when at least one channel exists, so support links never dead-end. */
export function hasAnyContactChannel(settings: SettingsMap): boolean {
  return canShowWhatsApp(settings) || canShowPhone(settings) || canShowEmail(settings);
}

export function canOfferPickup(settings: SettingsMap): boolean {
  return (
    settings[SETTING_KEYS.pickupEnabled] === "true" &&
    canShowStoreAddress(settings) &&
    isConfigured(settings, SETTING_KEYS.pickupPreparationTime)
  );
}

export function canOfferShipping(settings: SettingsMap): boolean {
  return settings[SETTING_KEYS.shippingEnabled] === "true";
}

/**
 * LocalBusiness structured data requires verified NAP details. Emitting it from
 * partial data publishes a wrong address to search engines.
 */
export function canEmitLocalBusinessSchema(settings: SettingsMap): boolean {
  return (
    canShowStoreSection(settings) &&
    allConfigured(settings, [SETTING_KEYS.storeLatitude, SETTING_KEYS.storeLongitude])
  );
}

/** A free-shipping bar needs a real threshold, and it must be a number. */
export function canShowFreeShippingProgress(settings: SettingsMap): boolean {
  const raw = settings[SETTING_KEYS.freeShippingThreshold];
  if (!raw) return false;
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed > 0;
}

// ── Summary for the admin ────────────────────────────────────────────────────

export interface GateStatus {
  readonly feature: string;
  readonly enabled: boolean;
  readonly missingKeys: readonly string[];
}

/**
 * Drives the admin's "what is still hidden, and why" panel. The merchant should
 * be able to see the reason a feature is absent without reading source.
 */
export function gateStatuses(settings: SettingsMap): readonly GateStatus[] {
  const check = (feature: string, keys: readonly string[]): GateStatus => ({
    feature,
    enabled: allConfigured(settings, keys),
    missingKeys: keys.filter((k) => !isConfigured(settings, k)),
  });

  return [
    check("legal_identity", [
      SETTING_KEYS.legalName,
      SETTING_KEYS.vatNumber,
      SETTING_KEYS.reaNumber,
      SETTING_KEYS.storeStreet,
      SETTING_KEYS.storePostcode,
      SETTING_KEYS.storeCity,
    ]),
    check("store_section", [SETTING_KEYS.shopName, SETTING_KEYS.storeStreet]),
    check("opening_hours", [SETTING_KEYS.storeHoursDisplay]),
    check("structured_hours", [SETTING_KEYS.storeHoursStructured]),
    check("whatsapp", [SETTING_KEYS.whatsappNumber]),
    check("phone", [SETTING_KEYS.phone]),
    check("email", [SETTING_KEYS.email]),
    check("pickup", [SETTING_KEYS.pickupPreparationTime, SETTING_KEYS.storeStreet]),
    check("local_business_schema", [SETTING_KEYS.storeLatitude, SETTING_KEYS.storeLongitude]),
  ];
}
