import { describe, it, expect } from "vitest";
import { totp, base32Decode } from "../helpers/totp";

/**
 * The TOTP helper, checked against the published RFC 6238 test vectors.
 *
 * A test helper that is silently wrong makes every browser test fail for a
 * reason nobody can see. Pinning it to the standard's own vectors means a break
 * here says "the helper is broken", not "the admin is broken".
 */

/** The RFC's secret: the ASCII string "12345678901234567890", base32-encoded. */
const RFC_SECRET = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";

describe("base32Decode", () => {
  it("decodes the RFC's secret back to its ASCII form", () => {
    expect(base32Decode(RFC_SECRET).toString("ascii")).toBe("12345678901234567890");
  });

  it("tolerates padding, lower case and spaces", () => {
    // All three appear in secrets copied out of an authenticator app or typed
    // by hand from a screen.
    expect(base32Decode("mzxw6===").toString("ascii")).toBe("foo");
    expect(base32Decode("MZXW 6===").toString("ascii")).toBe("foo");
  });

  it("refuses input that is not base32", () => {
    expect(() => base32Decode("not-base32!")).toThrow(/base32/);
  });
});

describe("RFC 6238 test vectors", () => {
  // The published SHA-1 vectors, at 8 digits.
  const VECTORS: [seconds: number, code: string][] = [
    [59, "94287082"],
    [1_111_111_109, "07081804"],
    [1_111_111_111, "14050471"],
    [1_234_567_890, "89005924"],
    [2_000_000_000, "69279037"],
    [20_000_000_000, "65353130"],
  ];

  for (const [at, expected] of VECTORS) {
    it(`matches the vector at T=${at}`, () => {
      expect(totp(RFC_SECRET, { at, digits: 8 })).toBe(expected);
    });
  }

  it("handles a counter beyond 32 bits", () => {
    // T=20000000000 is past the point where a 4-byte counter overflows — the
    // single most common implementation bug, and invisible until 2038.
    expect(totp(RFC_SECRET, { at: 20_000_000_000, digits: 8 })).toBe("65353130");
  });
});

describe("behaviour", () => {
  it("produces six digits by default", () => {
    expect(totp(RFC_SECRET, { at: 59 })).toMatch(/^\d{6}$/);
  });

  it("gives the same code throughout one period", () => {
    // Codes change on period boundaries, not continuously. A code read at the
    // start of a window must still be valid moments later.
    expect(totp(RFC_SECRET, { at: 30 })).toBe(totp(RFC_SECRET, { at: 59 }));
  });

  it("changes at the period boundary", () => {
    expect(totp(RFC_SECRET, { at: 59 })).not.toBe(totp(RFC_SECRET, { at: 60 }));
  });

  it("pads a short code rather than dropping a digit", () => {
    // A code whose numeric value is small must still be six characters, or the
    // form receives five and rejects it.
    for (let at = 0; at < 3000; at += 30) {
      expect(totp(RFC_SECRET, { at }), `T=${at}`).toHaveLength(6);
    }
  });
});
