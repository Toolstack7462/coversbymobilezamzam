/**
 * Device compatibility resolution (invariant 3).
 *
 * A pure function. Given the compatibility records a product actually has, and
 * the device a customer selected, it returns exactly one state.
 *
 * Nothing here reads a title, a tag, a category, a URL, a brand or a collection.
 * Inference from those looks right most of the time and is wrong exactly when it
 * costs money - a bulk import titled "Cover per iPhone 16" that fits only the
 * base model, sold to someone with a Pro Max.
 */

export const COMPATIBILITY_LEVELS = [
  "exact_fit",
  "compatible",
  "universal",
  "adapter_required",
  "incompatible",
  "unverified",
] as const;

export type CompatibilityLevel = (typeof COMPATIBILITY_LEVELS)[number];

/** What the customer is shown. `prompt` means "no device chosen yet". */
export const COMPATIBILITY_STATES = [
  "exact",
  "compatible",
  "universal",
  "adapter",
  "mismatch",
  "unverified",
  "prompt",
] as const;

export type CompatibilityState = (typeof COMPATIBILITY_STATES)[number];

export interface CompatibilityRecord {
  readonly deviceModelId: string;
  /** Null means the record applies to the whole product. */
  readonly variantId: string | null;
  readonly level: CompatibilityLevel;
  readonly verified: boolean;
  readonly note?: string | null;
}

export interface ResolveInput {
  readonly records: readonly CompatibilityRecord[];
  /** The device the customer selected, or null if none. */
  readonly selectedDeviceModelId: string | null;
  /** The variant being viewed, if any. Variant records override product ones. */
  readonly variantId?: string | null;
}

export interface ResolveResult {
  readonly state: CompatibilityState;
  /** The record the decision came from, for surfacing its note. */
  readonly matchedRecord: CompatibilityRecord | null;
  /** True when the product carries a universal record. */
  readonly isUniversal: boolean;
}

export function isCompatibilityLevel(value: string): value is CompatibilityLevel {
  return (COMPATIBILITY_LEVELS as readonly string[]).includes(value);
}

/**
 * Resolution order. Each step exists for a reason stated inline; changing the
 * order changes what customers are told about fit.
 */
export function resolveCompatibility(input: ResolveInput): ResolveResult {
  const { records, selectedDeviceModelId, variantId = null } = input;

  const universalRecord = records.find((r) => r.level === "universal") ?? null;
  const isUniversal = universalRecord !== null;

  // No device selected: say nothing rather than guessing. A badge with no
  // device behind it is noise, and "universal" shown unprompted reads as a
  // claim about the customer's phone.
  if (!selectedDeviceModelId) {
    return {
      state: isUniversal ? "universal" : "prompt",
      matchedRecord: universalRecord,
      isUniversal,
    };
  }

  const forDevice = records.filter((r) => r.deviceModelId === selectedDeviceModelId);

  // 1. A variant-level record beats a product-level one. A colour that only
  //    exists for one model is variant-level, and it is more specific.
  const variantRecord = variantId
    ? (forDevice.find((r) => r.variantId === variantId) ?? null)
    : null;
  const productRecord = forDevice.find((r) => r.variantId === null) ?? null;
  const applicable = variantRecord ?? productRecord;

  // 2. An explicit incompatible beats any broader compatibility, including a
  //    universal record. "This specifically does not fit" is knowledge, and it
  //    outranks a general statement.
  if (applicable?.level === "incompatible") {
    return { state: "mismatch", matchedRecord: applicable, isUniversal };
  }
  const universalIncompatible = forDevice.find((r) => r.level === "incompatible");
  if (universalIncompatible) {
    return { state: "mismatch", matchedRecord: universalIncompatible, isUniversal };
  }

  if (applicable) {
    switch (applicable.level) {
      case "exact_fit":
        // 3. Unverified surfaces as unverified even at exact_fit. An unchecked
        //    claim of exact fit is the most expensive kind to be wrong about.
        return {
          state: applicable.verified ? "exact" : "unverified",
          matchedRecord: applicable,
          isUniversal,
        };
      case "compatible":
        return {
          state: applicable.verified ? "compatible" : "unverified",
          matchedRecord: applicable,
          isUniversal,
        };
      case "adapter_required":
        return { state: "adapter", matchedRecord: applicable, isUniversal };
      case "unverified":
        return { state: "unverified", matchedRecord: applicable, isUniversal };
      case "universal":
        // 4. Universal NEVER becomes exact fit, even with a device-specific
        //    row. A 20W USB-C charger works with an iPhone 16 Pro but is not
        //    made for it, and claiming otherwise is a false precision that
        //    erodes trust in every other badge on the site.
        return { state: "universal", matchedRecord: applicable, isUniversal };
      // No `incompatible` case: step 2 above returns before reaching here, and
      // the compiler confirms it by narrowing that member out of the union.
    }
  }

  // 5. A universal product with no record for this device is still universal.
  if (isUniversal) {
    return { state: "universal", matchedRecord: universalRecord, isUniversal };
  }

  // 6. The product names specific devices and this is not one of them. That is
  //    a genuine mismatch: the data says what it fits, and this is not it.
  if (records.length > 0) {
    return { state: "mismatch", matchedRecord: null, isUniversal };
  }

  // 7. No records at all. Unknown, NOT compatible. Absence of evidence is not
  //    evidence of fit, and the honest answer is that nobody has checked.
  return { state: "unverified", matchedRecord: null, isUniversal };
}

/**
 * Whether a mismatch should be surfaced as a warning near the buy button.
 * A mismatch never blocks the purchase - the customer may be buying for someone
 * else, and refusing a sale because our data might be incomplete is arrogant.
 */
export function shouldWarn(state: CompatibilityState): boolean {
  return state === "mismatch";
}

/** Whether the state is a positive fit claim, for badge styling. */
export function isPositiveFit(state: CompatibilityState): boolean {
  return state === "exact" || state === "compatible";
}

/** The locale key for a state. Never build these by concatenation elsewhere. */
export function compatibilityLabelKey(state: CompatibilityState): string {
  switch (state) {
    case "exact":
      return "compatibility.exact";
    case "compatible":
      return "compatibility.compatible";
    case "universal":
      return "compatibility.universal";
    case "adapter":
      return "compatibility.adapter";
    case "mismatch":
      return "compatibility.mismatch";
    case "unverified":
      return "compatibility.unverified";
    case "prompt":
      return "compatibility.prompt";
  }
}
