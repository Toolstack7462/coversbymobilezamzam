import { deflateSync } from "node:zlib";

/**
 * A real PNG, built byte by byte.
 *
 * ── WHY NOT A FILE IN THE REPOSITORY ────────────────────────────────────────
 *
 * A committed test image is a binary blob nobody can review, whose dimensions
 * and byte count are invisible in a diff, and which every clone downloads
 * whether or not it runs the browser suite.
 *
 * ── WHY NOT A ONE-PIXEL PNG ─────────────────────────────────────────────────
 *
 * Because the upload path REJECTS one, correctly: `MIN_IMAGE_DIMENSION` is 200,
 * on the reasoning that anything smaller is a thumbnail somebody saved by
 * mistake. A fixture that cannot pass validation tests only the error message.
 *
 * So this is a genuine PNG at whatever size is asked for, with a real IHDR, a
 * real deflate-compressed IDAT and real CRCs — which matters because the
 * application does not trust the browser's MIME type and reads the format from
 * the file's own magic bytes.
 */

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([length, body, crc]);
}

/**
 * @param width  pixels; must be at least MIN_IMAGE_DIMENSION to pass upload
 * @param height pixels
 * @param rgb    a flat colour, so two fixtures of different colours produce
 *               different content hashes and therefore different object keys
 */
export function pngFixture(width = 400, height = 400, rgb: [number, number, number] = [8, 8, 8]) {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type: truecolour
  ihdr[10] = 0; // deflate
  ihdr[11] = 0; // adaptive filtering
  ihdr[12] = 0; // no interlace

  // One filter byte (0 = None) per scanline, then three bytes per pixel.
  const stride = width * 3 + 1;
  const raw = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y += 1) {
    const row = y * stride;
    raw[row] = 0;
    for (let x = 0; x < width; x += 1) {
      const at = row + 1 + x * 3;
      raw[at] = rgb[0];
      raw[at + 1] = rgb[1];
      raw[at + 2] = rgb[2];
    }
  }

  return Buffer.concat([
    signature,
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}
