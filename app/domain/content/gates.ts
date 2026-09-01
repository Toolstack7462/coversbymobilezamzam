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
  /**
   * The line under the wordmark — a store identity beneath the trading name.
   * Optional: most shops have one name, and an empty second line is worse than
   * none. See app/domain/content/brand.ts.
   */
  brandSecondary: "business.brand_secondary",
  shopName: "store.name",
  tagline: "business.tagline",
  legalName: "business.legal_name",
  vatNumber: "business.vat_number",
  reaNumber: "business.rea_number",
  shareCapital: "business.share_capital",

  storeStreet: "store.street",
  storePostcode: "store.postcode",
  heroImage: "media.hero_image",
  storeImage: "media.store_image",
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
/**
 * What each gate actually switches off, in the merchant's words.
 *
 * The dashboard used to print the gate CODE and the raw setting keys —
 * "legal_identity — mancano: business.legal_name, business.vat_number". That is
 * developer output on a shop owner's screen: it names an internal identifier
 * and three database keys, and answers none of "what is missing, where does it
 * show, and does it matter?".
 *
 * The labels live here, beside the checks they describe, so a gate cannot be
 * added without somewhere to say what it does.
 */
export const GATE_LABELS: Record<string, { what: string; where: string }> = {
  legal_identity: {
    what: "Dati dell'azienda",
    where: "La riga legale in fondo al sito, obbligatoria per vendere online",
  },
  store_section: {
    what: "Il negozio fisico",
    where: "La fascia «vieni a trovarci» e la pagina negozio",
  },
  opening_hours: { what: "Orari di apertura", where: "Pagina negozio e piè di pagina" },
  structured_hours: {
    what: "Orari per i motori di ricerca",
    where: "La scheda che Google mostra accanto al negozio",
  },
  whatsapp: { what: "Contatto WhatsApp", where: "Piè di pagina e pagina contatti" },
  phone: { what: "Numero di telefono", where: "Piè di pagina, pagina negozio e contatti" },
  email: { what: "Indirizzo email", where: "Piè di pagina e pagina contatti" },
  pickup: { what: "Ritiro in negozio", where: "La scelta alla cassa e i tempi di preparazione" },
  local_business_schema: {
    what: "Posizione sulla mappa",
    where: "Indicazioni stradali e risultati di ricerca locali",
  },
};

/**
 * The settings themselves, named as the merchant sees them in Impostazioni.
 *
 * A key with no entry falls back to the key, which is ugly on purpose: it is
 * how a missing label announces itself rather than hiding.
 */
export const SETTING_LABELS: Record<string, string> = {
  [SETTING_KEYS.legalName]: "ragione sociale",
  [SETTING_KEYS.vatNumber]: "partita IVA",
  [SETTING_KEYS.reaNumber]: "numero REA",
  [SETTING_KEYS.storeStreet]: "via e numero civico",
  [SETTING_KEYS.storePostcode]: "CAP",
  [SETTING_KEYS.storeCity]: "comune",
  [SETTING_KEYS.shopName]: "nome del negozio",
  [SETTING_KEYS.storeHoursDisplay]: "orari di apertura",
  [SETTING_KEYS.storeHoursStructured]: "orari in formato strutturato",
  [SETTING_KEYS.whatsappNumber]: "numero WhatsApp",
  [SETTING_KEYS.phone]: "telefono",
  [SETTING_KEYS.email]: "email",
  [SETTING_KEYS.pickupPreparationTime]: "tempo di preparazione del ritiro",
  [SETTING_KEYS.storeLatitude]: "latitudine",
  [SETTING_KEYS.storeLongitude]: "longitudine",
};

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
