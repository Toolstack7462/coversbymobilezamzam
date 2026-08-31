import { createHmac } from "node:crypto";

/**
 * TOTP (RFC 6238), for tests only.
 *
 * The admin forces two-factor enrolment on any privileged account, which is
 * correct and which also means a browser test cannot reach a single admin
 * screen without producing a real code. The options were to weaken the
 * application for testing or to implement the algorithm here. Weakening the
 * thing under test to make the test pass defeats the point of the test.
 *
 * This lives under `tests/` and is never imported by `app/` — the application
 * uses Better Auth's implementation. It is verified against the published
 * RFC 6238 test vectors in `tests/unit/totp.test.ts`, so a broken helper fails
 * loudly rather than making every browser test mysteriously red.
 */

/** Decodes RFC 4648 base32, which is how authenticator secrets are exchanged. */
export function base32Decode(input: string): Buffer {
  const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  // Padding and lower case both appear in the wild; neither carries meaning.
  const clean = input.toUpperCase().replace(/=+$/, "").replace(/\s+/g, "");

  let bits = 0;
  let value = 0;
  const out: number[] = [];

  for (const char of clean) {
    const index = ALPHABET.indexOf(char);
    if (index === -1) throw new Error(`Not base32: "${char}" in "${input}"`);

    value = (value << 5) | index;
    bits += 5;

    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }

  return Buffer.from(out);
}

export interface TotpOptions {
  /** Seconds per code. Thirty is the universal default. */
  period?: number;
  digits?: number;
  algorithm?: "sha1" | "sha256" | "sha512";
  /** Unix seconds. Defaults to now. */
  at?: number;
}

/**
 * The current code for a base32 secret.
 *
 * The counter is the number of whole periods since the epoch, written as an
 * 8-byte big-endian integer — the step most implementations get wrong by using
 * a 4-byte counter that breaks after 2038.
 */
export function totp(secretBase32: string, options: TotpOptions = {}): string {
  const { period = 30, digits = 6, algorithm = "sha1" } = options;
  const at = options.at ?? Math.floor(Date.now() / 1000);

  const counter = Math.floor(at / period);
  const buffer = Buffer.alloc(8);
  buffer.writeBigUInt64BE(BigInt(counter));

  const digest = createHmac(algorithm, base32Decode(secretBase32)).update(buffer).digest();

  // Dynamic truncation: the low nibble of the last byte picks the offset.
  const offset = digest[digest.length - 1]! & 0x0f;
  const binary =
    ((digest[offset]! & 0x7f) << 24) |
    ((digest[offset + 1]! & 0xff) << 16) |
    ((digest[offset + 2]! & 0xff) << 8) |
    (digest[offset + 3]! & 0xff);

  return String(binary % 10 ** digits).padStart(digits, "0");
}

/**
 * A code guaranteed not to be at the very end of its window.
 *
 * A code generated at second 29 of a 30-second period expires before the form
 * submits, which produces a test that fails roughly one run in thirty and
 * teaches everyone to re-run rather than to look. Waiting for the next window
 * costs a few seconds and removes the flake entirely.
 */
export async function stableTotp(secretBase32: string, minSecondsLeft = 5): Promise<string> {
  const secondsIntoPeriod = Math.floor(Date.now() / 1000) % 30;
  const remaining = 30 - secondsIntoPeriod;

  if (remaining < minSecondsLeft) {
    await new Promise((resolve) => setTimeout(resolve, remaining * 1000 + 500));
  }

  const code = totp(secretBase32);
  lastIssued = code;
  return code;
}

/** The last code `stableTotp` handed out, so a replay can be avoided. */
let lastIssued: string | null = null;

/**
 * A code that has NOT been used before.
 *
 * A TOTP code is single-use: the server remembers the last one accepted and
 * refuses it a second time, which is the whole point of the scheme. Enrolling
 * and then immediately answering the login challenge happens well inside one
 * thirty-second window, so both steps would otherwise submit the SAME digits
 * and the second would be rejected as a replay — indistinguishable, from the
 * outside, from a wrong code.
 *
 * So when the current code matches the last one issued, this waits for the next
 * window. It costs up to thirty seconds once per run, which is the correct
 * price for not weakening replay protection to make a test convenient.
 */
export async function freshTotp(secretBase32: string): Promise<string> {
  const current = totp(secretBase32);
  if (lastIssued !== null && current === lastIssued) {
    const secondsIntoPeriod = Math.floor(Date.now() / 1000) % 30;
    await new Promise((resolve) => setTimeout(resolve, (30 - secondsIntoPeriod) * 1000 + 500));
  }
  return stableTotp(secretBase32);
}
