import type { Clock, IdGenerator, Encryptor } from "~/application/ports";

/**
 * Small infrastructure primitives. These are the only place the real clock and
 * real randomness are touched, which is what makes everything above them
 * deterministic under test.
 */

export const systemClock: Clock = {
  now: () => Date.now(),
  nowDate: () => new Date(),
};

/** Freezes time. Reservation expiry and DST behaviour are untestable without it. */
export function fixedClock(fixedMs: number): Clock {
  return {
    now: () => fixedMs,
    nowDate: () => new Date(fixedMs),
  };
}

const ULID_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/**
 * ULID-style ids: 10 characters of timestamp then 16 of randomness.
 *
 * Monotonic, so rows insert in key order and the index stays dense - unlike a
 * UUIDv4, which scatters writes across the B-tree. And unlike a sequential
 * integer, it leaks neither a count nor the next value.
 */
export const cryptoIds: IdGenerator = {
  generate(): string {
    const now = Date.now();
    let timePart = "";
    let remaining = now;
    for (let i = 0; i < 10; i++) {
      timePart = ULID_ALPHABET[remaining % 32]! + timePart;
      remaining = Math.floor(remaining / 32);
    }

    const bytes = crypto.getRandomValues(new Uint8Array(16));
    let randomPart = "";
    for (const byte of bytes) randomPart += ULID_ALPHABET[byte % 32];

    return timePart + randomPart;
  },

  randomBytes(length: number): Uint8Array {
    return crypto.getRandomValues(new Uint8Array(length));
  },
};

/** Deterministic ids for tests. Never used in production. */
export function sequentialIds(prefix = "id"): IdGenerator {
  let counter = 0;
  return {
    generate: () => `${prefix}_${String(++counter).padStart(6, "0")}`,
    randomBytes: (length: number) => new Uint8Array(length).map((_, i) => (counter + i) % 256),
  };
}

/**
 * AES-GCM encryption for merchant payment identifiers.
 *
 * The IBAN is the highest-value target in this application: an attacker who can
 * quietly change it redirects every future payment. It is encrypted at rest,
 * never logged, and a masked form is stored separately so ordinary admin
 * screens never decrypt at all.
 *
 * Format: base64(iv ‖ ciphertext). A fresh 12-byte IV per encryption - reusing
 * an IV with GCM is catastrophic, not merely weak.
 */
export function aesGcmEncryptor(base64Key: string): Encryptor {
  let keyPromise: Promise<CryptoKey> | null = null;

  const getKey = (): Promise<CryptoKey> => {
    keyPromise ??= (async () => {
      const raw = Uint8Array.from(atob(base64Key), (c) => c.charCodeAt(0));
      if (raw.byteLength !== 32) {
        throw new Error(
          "SETTINGS_ENCRYPTION_KEY must be 32 bytes, base64 encoded. Generate with: openssl rand -base64 32",
        );
      }
      return crypto.subtle.importKey("raw", raw, { name: "AES-GCM" }, false, [
        "encrypt",
        "decrypt",
      ]);
    })();
    return keyPromise;
  };

  return {
    async encrypt(plaintext: string): Promise<string> {
      const key = await getKey();
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const encoded = new TextEncoder().encode(plaintext);
      const cipher = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, encoded);

      const combined = new Uint8Array(iv.byteLength + cipher.byteLength);
      combined.set(iv, 0);
      combined.set(new Uint8Array(cipher), iv.byteLength);
      return btoa(String.fromCharCode(...combined));
    },

    async decrypt(ciphertext: string): Promise<string> {
      const key = await getKey();
      const combined = Uint8Array.from(atob(ciphertext), (c) => c.charCodeAt(0));
      const iv = combined.slice(0, 12);
      const data = combined.slice(12);
      const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, data);
      return new TextDecoder().decode(plain);
    },
  };
}

/**
 * The display form of a sensitive identifier.
 *
 * Keeps the country prefix and the last four characters, which is enough for a
 * human to confirm they are looking at the right account without the value ever
 * being decrypted on an ordinary screen.
 */
export function maskIdentifier(value: string): string {
  const clean = value.replace(/\s+/g, "").toUpperCase();
  if (clean.length <= 8) return "*".repeat(clean.length);
  return `${clean.slice(0, 2)}${"*".repeat(clean.length - 6)}${clean.slice(-4)}`;
}

/**
 * Values that must never reach a log, an audit row, an error or an export.
 * Used by the logger and by the audit adapter.
 */
const REDACTED_KEYS = [
  "password",
  "token",
  "secret",
  "iban",
  "accountidentifier",
  "account_identifier",
  "cookie",
  "authorization",
  "sessionid",
  "session_id",
  "backupcodes",
  "backup_codes",
];

export function redact(value: unknown): unknown {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(redact);

  const out: Record<string, unknown> = {};
  for (const [key, inner] of Object.entries(value as Record<string, unknown>)) {
    out[key] = REDACTED_KEYS.some((r) => key.toLowerCase().includes(r))
      ? "[REDACTED]"
      : redact(inner);
  }
  return out;
}
