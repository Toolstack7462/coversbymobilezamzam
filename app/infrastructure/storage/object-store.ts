/**
 * The object-storage port.
 *
 * Shaped after the small slice of R2 the application actually uses — `get`,
 * `put`, `delete`, and enough metadata to answer a conditional request — rather
 * than after R2's full surface. A port that mirrors one vendor's API is a
 * vendor dependency with an interface in front of it.
 *
 * Two stores, never one. `MEDIA` holds product photography and is served to
 * anyone; `PRIVATE_FILES` holds payment proofs and is served to nobody without
 * a permission check on every single read. Keeping them as separate instances
 * rather than one store with a flag makes the separation structural: the media
 * route is handed the public store and physically cannot reach a proof.
 */

export interface ObjectMetadata {
  /** Bytes. */
  size: number;
  /**
   * An HTTP entity tag, quoted, ready for an `ETag` header.
   *
   * NOT assumed to be a content hash. R2 returns MD5 for a single-part upload
   * and something else entirely for a multipart one, and a filesystem store has
   * no natural etag at all. Anything that needs to compare CONTENT computes a
   * SHA-256 and says so — see scripts/hostinger/migrate-media.mjs.
   */
  etag: string;
  contentType: string | null;
  cacheControl: string | null;
  /** Epoch milliseconds. */
  uploadedAt: number;
}

export interface StoredObject extends ObjectMetadata {
  /**
   * The bytes, as a stream.
   *
   * A stream rather than a buffer because the library is served through the
   * application on Hostinger, and reading a 5 MB image fully into memory per
   * request on a 2 GB plan with several workers is how a shop runs out of RAM
   * serving photographs.
   */
  body: ReadableStream<Uint8Array> | null;
  arrayBuffer(): Promise<ArrayBuffer>;
}

export interface PutOptions {
  contentType: string;
  cacheControl?: string;
}

export interface ListedObject {
  key: string;
  size: number;
  uploadedAt: number;
}

export interface ObjectStore {
  get(key: string): Promise<StoredObject | null>;
  head(key: string): Promise<ObjectMetadata | null>;
  put(key: string, body: ArrayBuffer | Uint8Array, options: PutOptions): Promise<void>;
  delete(key: string): Promise<void>;
  /**
   * Enumerates the store.
   *
   * Never reachable from a request. It exists for the migration tooling and the
   * media-inventory reconciliation; a listable media endpoint is an invitation
   * to scrape the whole catalogue, which is why the media route requires an
   * exact key and has no listing at all.
   */
  list(prefix?: string): AsyncIterable<ListedObject>;
}

/**
 * Rejects a key that is not one this application wrote.
 *
 * On R2 the keyspace is flat and `..` means nothing, so the original check was
 * belt-and-braces. On a filesystem it is the difference between serving a
 * product photo and serving `/etc/passwd`, so the rule moves here where BOTH
 * stores enforce it and no future store can forget to.
 *
 * The allowed shape is deliberately narrow — lowercase segments of
 * `[A-Za-z0-9._-]`, separated by single slashes — because every key this
 * application generates is `products/<nanoid>-<hash>.webp` or
 * `proofs/<order>/<id>.<ext>`. Anything else is either a bug or an attack, and
 * there is no legitimate third case to accommodate.
 */
export function isSafeObjectKey(key: string): boolean {
  if (key === "" || key.length > 512) return false;
  if (key.startsWith("/") || key.endsWith("/")) return false;
  // NUL and control characters: a filesystem truncates at NUL, so `a.webp\0.php`
  // is one name to the check and another on disk.
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(key)) return false;
  if (key.includes("//")) return false;

  return key.split("/").every((segment) => {
    if (segment === "" || segment === "." || segment === "..") return false;
    // A leading dot would let a key address a dotfile; a trailing one is a
    // Windows filename hazard and a way to smuggle an extension past a check.
    if (segment.startsWith(".") || segment.endsWith(".")) return false;
    return /^[A-Za-z0-9._-]+$/.test(segment);
  });
}

export class UnsafeObjectKeyError extends Error {
  readonly key: string;

  constructor(key: string) {
    super(`Refusing an unsafe object key: ${JSON.stringify(key.slice(0, 120))}`);
    this.name = "UnsafeObjectKeyError";
    this.key = key;
  }
}

export function assertSafeObjectKey(key: string): void {
  if (!isSafeObjectKey(key)) throw new UnsafeObjectKeyError(key);
}

/**
 * The content types the public media store will accept.
 *
 * An allowlist, not a denylist. The store holds merchant uploads, and the
 * failure mode of a denylist is a type nobody thought of — an SVG with a script
 * in it, an HTML file with an image extension — being served from the shop's
 * own origin, where the site's CSP would trust it.
 *
 * The media route additionally sends `nosniff` and a `sandbox` CSP, so this is
 * the second of three independent defences rather than the only one.
 */
export const ALLOWED_MEDIA_TYPES = new Set(["image/webp", "image/jpeg", "image/png", "image/avif"]);

/** Extension for a content type, for a filesystem store that stores them apart. */
export const MEDIA_TYPE_EXTENSIONS: Record<string, string> = {
  "image/webp": ".webp",
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/avif": ".avif",
  "application/pdf": ".pdf",
};
