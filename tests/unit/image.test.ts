import { describe, it, expect } from "vitest";
import {
  inspectImage,
  imageObjectKey,
  MAX_IMAGE_BYTES,
  MIN_IMAGE_DIMENSION,
} from "~/domain/media/image";

/**
 * Header parsing, tested against hand-built bytes.
 *
 * Dimensions are read from the file rather than asked for, because a merchant
 * cannot be expected to know them and the storefront needs them to reserve
 * space before the image loads. That makes this parser load-bearing for layout
 * stability, so its edge cases are worth pinning down.
 */

// ── Builders ────────────────────────────────────────────────────────────────

function png(width: number, height: number): ArrayBuffer {
  const bytes = new Uint8Array(24);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  const view = new DataView(bytes.buffer);
  view.setUint32(16, width, false);
  view.setUint32(20, height, false);
  return bytes.buffer;
}

/** A minimal JPEG: SOI, one skippable segment, then an SOF0 frame header. */
function jpeg(width: number, height: number, marker = 0xc0): ArrayBuffer {
  const bytes = new Uint8Array(40);
  const view = new DataView(bytes.buffer);

  bytes.set([0xff, 0xd8], 0); // SOI
  // An APP0 segment of length 6, to prove the walker skips rather than assumes
  // the frame header is first.
  bytes.set([0xff, 0xe0], 2);
  view.setUint16(4, 6, false);

  const sof = 10;
  bytes.set([0xff, marker], sof);
  view.setUint16(sof + 2, 17, false); // segment length
  bytes[sof + 4] = 8; // precision
  view.setUint16(sof + 5, height, false);
  view.setUint16(sof + 7, width, false);

  return bytes.buffer;
}

function webpLossy(width: number, height: number): ArrayBuffer {
  const bytes = new Uint8Array(40);
  const view = new DataView(bytes.buffer);
  bytes.set([0x52, 0x49, 0x46, 0x46], 0); // RIFF
  bytes.set([0x57, 0x45, 0x42, 0x50], 8); // WEBP
  bytes.set([0x56, 0x50, 0x38, 0x20], 12); // "VP8 "
  view.setUint16(26, width, true);
  view.setUint16(28, height, true);
  return bytes.buffer;
}

function webpExtended(width: number, height: number): ArrayBuffer {
  const bytes = new Uint8Array(40);
  bytes.set([0x52, 0x49, 0x46, 0x46], 0);
  bytes.set([0x57, 0x45, 0x42, 0x50], 8);
  bytes.set([0x56, 0x50, 0x38, 0x58], 12); // "VP8X"
  const w = width - 1;
  const h = height - 1;
  bytes.set([w & 0xff, (w >> 8) & 0xff, (w >> 16) & 0xff], 24);
  bytes.set([h & 0xff, (h >> 8) & 0xff, (h >> 16) & 0xff], 27);
  return bytes.buffer;
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe("reading dimensions", () => {
  it("reads a PNG", () => {
    const result = inspectImage(png(1200, 900));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.facts).toMatchObject({ type: "image/png", width: 1200, height: 900 });
  });

  it("reads a JPEG, skipping segments before the frame header", () => {
    const result = inspectImage(jpeg(800, 600));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.facts).toMatchObject({ type: "image/jpeg", width: 800, height: 600 });
  });

  it("reads a progressive JPEG, whose frame marker differs", () => {
    // SOF2. A parser that only looks for SOF0 silently fails on every
    // progressive photo, which is most of what a modern phone produces.
    const result = inspectImage(jpeg(1024, 768, 0xc2));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.facts).toMatchObject({ width: 1024, height: 768 });
  });

  it("does not mistake a Huffman table for a frame header", () => {
    // DHT (0xC4) sits inside the SOF marker range and is not a frame header.
    // Treating it as one yields nonsense dimensions from table data.
    const bytes = new Uint8Array(jpeg(640, 480));
    // Turn the APP0 segment into a DHT before the real frame header.
    bytes[3] = 0xc4;
    const result = inspectImage(bytes.buffer);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.facts).toMatchObject({ width: 640, height: 480 });
  });

  it("reads a lossy WebP", () => {
    const result = inspectImage(webpLossy(1000, 1000));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.facts).toMatchObject({ type: "image/webp", width: 1000, height: 1000 });
  });

  it("reads an extended WebP, where dimensions are stored minus one", () => {
    const result = inspectImage(webpExtended(2048, 1536));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.facts).toMatchObject({ width: 2048, height: 1536 });
  });
});

describe("refusals explain themselves", () => {
  it("refuses an empty file", () => {
    const result = inspectImage(new ArrayBuffer(0));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("vuoto");
  });

  it("refuses an unknown format, and says SVG is refused on purpose", () => {
    // An SVG is a script-execution vector dressed as a picture. Being explicit
    // stops someone "fixing" the omission later.
    const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"></svg>');
    const result = inspectImage(svg.buffer as ArrayBuffer);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("SVG");
  });

  it("trusts the file's own bytes, not a claimed type", () => {
    // The point of sniffing: a file named .png containing something else must
    // not be stored under a name that lies about its contents.
    const notAnImage = new TextEncoder().encode("PNG? no.");
    expect(inspectImage(notAnImage.buffer as ArrayBuffer).ok).toBe(false);
  });

  it("refuses a file that is too large, naming both sizes", () => {
    const oversized = new Uint8Array(MAX_IMAGE_BYTES + 1);
    oversized.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
    const result = inspectImage(oversized.buffer);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("8 MB");
  });

  it("refuses a thumbnail, and guesses why it happened", () => {
    const result = inspectImage(png(120, 120));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("120×120");
    expect(result.error).toContain(String(MIN_IMAGE_DIMENSION));
    expect(result.error).toContain("miniatura");
  });

  it("refuses a truncated file rather than guessing", () => {
    const truncated = new Uint8Array(10);
    truncated.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
    const result = inspectImage(truncated.buffer);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/incompleto|corrotto/);
  });

  it("accepts an image exactly at the minimum", () => {
    // Off-by-one at a boundary a merchant will actually hit.
    expect(inspectImage(png(MIN_IMAGE_DIMENSION, MIN_IMAGE_DIMENSION)).ok).toBe(true);
    expect(inspectImage(png(MIN_IMAGE_DIMENSION - 1, MIN_IMAGE_DIMENSION)).ok).toBe(false);
  });
});

describe("object keys", () => {
  it("groups by product and carries the content hash", () => {
    // The hash in the key means the same file uploaded twice lands on one
    // object, and a changed image can never be served from cache under an old
    // name.
    expect(imageObjectKey("prod_1", "abc123", "jpg")).toBe("products/prod_1/abc123.jpg");
  });
});
