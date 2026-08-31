/**
 * Image validation and dimension reading.
 *
 * Pure: takes bytes, returns facts. No R2, no database, no network — so every
 * rule here is testable against a handful of hand-built byte arrays.
 *
 * **Why dimensions are read from the file rather than asked for.**
 *
 * `product_images.width` and `height` are NOT NULL, and they exist so the
 * storefront can reserve the exact space an image will occupy before it loads.
 * Without that the page reflows as each photo arrives, which is the largest
 * single contributor to a bad CLS score and, more to the point, makes a
 * customer tap the wrong thing.
 *
 * A merchant cannot be asked for pixel dimensions. So they are parsed out of
 * the file header — a few dozen bytes, no decoding, no image library, which
 * matters when this runs inside a Worker's CPU budget.
 *
 * **Why the format list is short.** JPEG, PNG and WebP cover every phone camera
 * and every export from every tool a shop will use. Accepting more would mean
 * accepting formats that browsers render inconsistently, and SVG in particular
 * is a script-execution vector dressed as a picture — it is refused
 * deliberately, not overlooked.
 */

export const ACCEPTED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
export type AcceptedImageType = (typeof ACCEPTED_IMAGE_TYPES)[number];

/**
 * 8 MB. Generous for a photo of a phone case and far below the point where a
 * Worker request starts being at risk; a modern phone photo is 2-5 MB.
 */
export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

/** Below this, an image is too small to be a product photo — usually a thumbnail
 *  someone saved by mistake, or an icon. */
export const MIN_IMAGE_DIMENSION = 200;

export interface ImageFacts {
  type: AcceptedImageType;
  width: number;
  height: number;
  bytes: number;
  /** Content hash, for detecting the same file uploaded twice. */
  extension: string;
}

export type ImageCheck = { ok: true; facts: ImageFacts } | { ok: false; error: string };

const EXTENSIONS: Record<AcceptedImageType, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

/**
 * Identifies the format from the file's own magic bytes.
 *
 * The browser-supplied MIME type is NOT trusted: it comes from the client, it
 * is trivially wrong, and a file claiming to be a PNG while containing
 * something else should be refused rather than stored under a misleading name.
 */
function sniffType(bytes: Uint8Array): AcceptedImageType | null {
  // JPEG: FF D8 FF
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }

  // PNG: 89 50 4E 47 0D 0A 1A 0A
  const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (bytes.length >= 8 && PNG_SIGNATURE.every((b, i) => bytes[i] === b)) {
    return "image/png";
  }

  // WebP: "RIFF" .... "WEBP"
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return "image/webp";
  }

  return null;
}

function readPngDimensions(bytes: Uint8Array): { width: number; height: number } | null {
  // IHDR is always the first chunk: width and height are big-endian uint32 at
  // offsets 16 and 20.
  if (bytes.length < 24) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { width: view.getUint32(16, false), height: view.getUint32(20, false) };
}

function readJpegDimensions(bytes: Uint8Array): { width: number; height: number } | null {
  // Walk the segment markers looking for a Start Of Frame. There are several
  // SOF variants (baseline, progressive, and others); all carry height and
  // width at the same offsets within the segment.
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 2; // skip SOI

  while (offset + 9 < bytes.length) {
    if (bytes[offset] !== 0xff) {
      // Not aligned on a marker. A malformed or truncated file, not something
      // to guess at.
      offset += 1;
      continue;
    }

    const marker = bytes[offset + 1]!;
    // SOF0-SOF15, excluding DHT (C4), JPGA (C8) and DAC (CC), which are not
    // frame headers despite sitting in the same range.
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return {
        height: view.getUint16(offset + 5, false),
        width: view.getUint16(offset + 7, false),
      };
    }

    const segmentLength = view.getUint16(offset + 2, false);
    if (segmentLength < 2) return null;
    offset += 2 + segmentLength;
  }

  return null;
}

function readWebpDimensions(bytes: Uint8Array): { width: number; height: number } | null {
  if (bytes.length < 30) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  // The chunk type at offset 12 says which of the three WebP layouts this is.
  const chunk = String.fromCharCode(bytes[12]!, bytes[13]!, bytes[14]!, bytes[15]!);

  if (chunk === "VP8 ") {
    // Lossy: 14-bit dimensions, little-endian, after the 3-byte start code.
    return {
      width: view.getUint16(26, true) & 0x3fff,
      height: view.getUint16(28, true) & 0x3fff,
    };
  }

  if (chunk === "VP8L") {
    // Lossless: 14 bits each, packed into 4 bytes after the signature byte.
    const bits = view.getUint32(21, true);
    return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
  }

  if (chunk === "VP8X") {
    // Extended: 24-bit dimensions minus one, little-endian.
    const width = (bytes[24]! | (bytes[25]! << 8) | (bytes[26]! << 16)) + 1;
    const height = (bytes[27]! | (bytes[28]! << 8) | (bytes[29]! << 16)) + 1;
    return { width, height };
  }

  return null;
}

/**
 * Checks an uploaded file and reads its dimensions.
 *
 * Every refusal names what is wrong and what would be acceptable. "File non
 * valido" tells a shopkeeper nothing and produces a support call.
 */
export function inspectImage(buffer: ArrayBuffer): ImageCheck {
  const bytes = new Uint8Array(buffer);

  if (bytes.length === 0) return { ok: false, error: "Il file è vuoto." };

  if (bytes.length > MAX_IMAGE_BYTES) {
    const mb = (bytes.length / (1024 * 1024)).toFixed(1);
    return {
      ok: false,
      error: `L'immagine pesa ${mb} MB, il massimo è ${MAX_IMAGE_BYTES / (1024 * 1024)} MB. Ridimensionatela prima di caricarla.`,
    };
  }

  const type = sniffType(bytes);
  if (type === null) {
    return {
      ok: false,
      error:
        "Formato non riconosciuto. Sono accettati JPG, PNG e WebP — i formati che escono da qualsiasi telefono. I file SVG non sono accettati per motivi di sicurezza.",
    };
  }

  const dimensions =
    type === "image/png"
      ? readPngDimensions(bytes)
      : type === "image/jpeg"
        ? readJpegDimensions(bytes)
        : readWebpDimensions(bytes);

  if (dimensions === null || dimensions.width === 0 || dimensions.height === 0) {
    return {
      ok: false,
      error: "Non è stato possibile leggere le dimensioni: il file sembra incompleto o corrotto.",
    };
  }

  if (dimensions.width < MIN_IMAGE_DIMENSION || dimensions.height < MIN_IMAGE_DIMENSION) {
    return {
      ok: false,
      error: `L'immagine è ${dimensions.width}×${dimensions.height} pixel, troppo piccola: serve almeno ${MIN_IMAGE_DIMENSION} pixel per lato. Forse avete caricato una miniatura invece dell'originale.`,
    };
  }

  return {
    ok: true,
    facts: {
      type,
      width: dimensions.width,
      height: dimensions.height,
      bytes: bytes.length,
      extension: EXTENSIONS[type],
    },
  };
}

/**
 * The R2 object key for a product image.
 *
 * Contains the content hash, so the same file uploaded twice lands on the same
 * key rather than accumulating copies, and so a changed image can never be
 * served from a stale cache under an old name.
 */
export function imageObjectKey(productId: string, hash: string, extension: string): string {
  return `products/${productId}/${hash}.${extension}`;
}

/** SHA-256 of the bytes, hex, truncated. Long enough that a collision is not a
 *  practical concern for one shop's photo library. */
export async function hashImage(buffer: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", buffer);
  return [...new Uint8Array(digest)]
    .slice(0, 16)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
