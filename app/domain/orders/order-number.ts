/**
 * Public order numbers: ITA-YYYYMMDD-XXXXXX
 *
 * This number is read aloud on the phone, written into a bank transfer causale,
 * and typed by hand. Every decision below serves that.
 */

/**
 * Crockford-style alphabet with I, L, O and U removed.
 *
 * O/0 and I/1 are confused every time a number is dictated or handwritten, and
 * a wrong causale means a transfer that cannot be matched to an order. U is
 * dropped because random strings occasionally spell something unfortunate.
 */
const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const SUFFIX_LENGTH = 6;
const PREFIX = "ITA";

export const ORDER_NUMBER_PATTERN = /^ITA-\d{8}-[0-9A-HJKMNP-TV-Z]{6}$/;

export interface OrderNumberParts {
  readonly prefix: string;
  readonly datePart: string;
  readonly suffix: string;
}

/**
 * @param date - order creation instant, supplied by the Clock port
 * @param randomBytes - CSPRNG bytes from the caller; the domain layer does not
 *   reach for randomness itself, so tests can make this deterministic
 */
export function generateOrderNumber(date: Date, randomBytes: Uint8Array): string {
  if (randomBytes.length < SUFFIX_LENGTH) {
    throw new Error(`Need at least ${SUFFIX_LENGTH} random bytes for an order number.`);
  }

  // Europe/Rome, so an order placed at 00:30 Italian time carries that day's
  // date rather than the previous day's UTC date. Staff match orders to a
  // working day, not to UTC.
  const datePart = formatDatePartInRome(date);

  let suffix = "";
  for (let i = 0; i < SUFFIX_LENGTH; i++) {
    // Modulo bias across 32 symbols and 256 values is exactly zero: 256 is a
    // multiple of 32, so every symbol is equally likely.
    suffix += ALPHABET[randomBytes[i]! % ALPHABET.length];
  }

  return `${PREFIX}-${datePart}-${suffix}`;
}

function formatDatePartInRome(date: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Rome",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);

  const get = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((p) => p.type === type)?.value ?? "";

  return `${get("year")}${get("month")}${get("day")}`;
}

export function isValidOrderNumber(value: string): boolean {
  return ORDER_NUMBER_PATTERN.test(value);
}

export function parseOrderNumber(value: string): OrderNumberParts | null {
  if (!isValidOrderNumber(value)) return null;
  const [prefix, datePart, suffix] = value.split("-") as [string, string, string];
  return { prefix, datePart, suffix };
}

/**
 * Normalises what a customer typed: strips spaces, uppercases, and maps the
 * characters people substitute for the ones this alphabet omits.
 *
 * Someone reading "ITA-20260830-AB12CD" aloud will produce O for 0 and I for 1
 * often enough that refusing it would just generate support calls.
 */
export function normaliseOrderNumberInput(input: string): string {
  const cleaned = input.trim().toUpperCase().replace(/\s+/g, "");

  // Substitutions must NOT touch the literal prefix: "ITA" contains an I, and
  // blindly mapping I to 1 turns every pasted order number into "1TA-..." and
  // breaks the lookup it was meant to rescue.
  const withoutPrefix = cleaned.startsWith(`${PREFIX}-`)
    ? cleaned.slice(PREFIX.length + 1)
    : cleaned;

  const normalised = withoutPrefix.replace(/[OQ]/g, "0").replace(/[IL]/g, "1").replace(/U/g, "V");

  return cleaned.startsWith(`${PREFIX}-`) ? `${PREFIX}-${normalised}` : normalised;
}

/**
 * The tracking token. 32 characters from the same alphabet is about 160 bits of
 * entropy - not guessable, and not derivable from an order number, which is
 * partly predictable because the date is right there in it.
 */
export const TRACKING_TOKEN_LENGTH = 32;

export function generateTrackingToken(randomBytes: Uint8Array): string {
  if (randomBytes.length < TRACKING_TOKEN_LENGTH) {
    throw new Error(`Need at least ${TRACKING_TOKEN_LENGTH} random bytes for a tracking token.`);
  }
  let token = "";
  for (let i = 0; i < TRACKING_TOKEN_LENGTH; i++) {
    token += ALPHABET[randomBytes[i]! % ALPHABET.length];
  }
  return token;
}
