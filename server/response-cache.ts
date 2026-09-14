/**
 * A micro-cache for anonymous storefront HTML.
 *
 * ── WHAT PROBLEM THIS SOLVES ────────────────────────────────────────────────
 *
 * Measured before it was written (docs/hostinger/performance-baseline.md): the
 * homepage costs twelve database round trips and a full React server render,
 * p50 86 ms unloaded and 732 ms at eight concurrent clients. Six of those
 * twelve queries are the shell — settings, category rail, footer pages, extra
 * navigation, legal documents — and are byte-for-byte identical for every
 * anonymous visitor. Rendering them again per request is work with a knowable
 * answer.
 *
 * ── THE ONE RULE THAT MATTERS ───────────────────────────────────────────────
 *
 * This is a SHARED cache. A response stored here can be handed to a different
 * person. Everything below exists to make that safe, and the rule is not
 * "cache carefully" — it is:
 *
 *      A REQUEST THAT CARRIES A COOKIE IS NEVER READ FROM OR WRITTEN TO
 *      THIS CACHE, AND A RESPONSE THAT SETS A COOKIE IS NEVER STORED.
 *
 * Not "no session cookie" — no cookie at all. Distinguishing a harmless cookie
 * from a session one means maintaining a list of cookie names that is correct
 * today and silently wrong the day something adds one. The strict rule cannot
 * rot: a signed-in member of staff, a customer with a cart, and anyone Better
 * Auth has ever issued a cookie to all bypass the cache completely and get a
 * freshly rendered page.
 *
 * The cost of the strict rule is real and is accepted: a returning visitor who
 * has a `__Host-cart` cookie never gets a cached page. They also must not,
 * because the pages they see are allowed to differ.
 *
 * ── WHAT IT DELIBERATELY DOES NOT DO ────────────────────────────────────────
 *
 * It does not cache `/admin`, `/api`, the cart, the checkout, an order
 * confirmation, a tracking page or `/media`. Those are enumerated below rather
 * than inferred, and the enumeration is tested. It does not cache a non-200,
 * a non-HTML response, or a body over the size cap. It never becomes a second
 * source of truth: every entry is a copy of something the application rendered,
 * and dropping the whole cache is always correct.
 *
 * ── INVALIDATION ────────────────────────────────────────────────────────────
 *
 * Two independent mechanisms, because either one alone is a way to serve a
 * stale price:
 *
 *   1. A VERSION, bumped by any successful mutation that could change public
 *      content. Every key embeds the version it was stored under, so a bump
 *      makes the whole cache unreachable at once. Deliberately coarse: a rule
 *      that tries to work out which pages a given admin save affected is a rule
 *      that will one day miss one, and the miss shows a customer a price that
 *      is not the price.
 *   2. A TTL, as a backstop for anything the version did not catch — a
 *      scheduled job, a row changed by hand, another worker process.
 *
 * See docs/hostinger/cache-invalidation.md.
 */

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import fs from "node:fs/promises";

/** Path prefixes that are never cached, matched after the `/en` mirror is stripped. */
export const NEVER_CACHE_PREFIXES = [
  // Staff. Every page carries order details, customer names and payment state.
  "/admin",
  // Health, auth, sitemap generation. `/api/auth` in particular issues cookies.
  "/api",
  // The cart is the session.
  "/carrello",
  "/cassa",
  // An order confirmation and a tracking page are addressed by a secret in the
  // URL. Caching them by URL would be correct and is still refused: a shared
  // cache holding somebody's order is a shared cache that can leak it.
  "/ordine",
  "/traccia",
  // Images. Bytes belong on disk and in the browser's cache, not in the heap
  // of a process with a memory allowance.
  "/media",
] as const;

/** Response bodies larger than this are served but not stored. */
export const DEFAULT_MAX_ENTRY_BYTES = 512 * 1024;

/** Total body bytes held. Chosen against the measured 105 MB idle RSS. */
export const DEFAULT_MAX_TOTAL_BYTES = 24 * 1024 * 1024;

export const DEFAULT_TTL_MS = 60_000;

/**
 * Response headers copied into the cache and replayed.
 *
 * An allowlist, not a denylist. `set-cookie` is the one that must never be
 * replayed, and a denylist is one forgotten header away from replaying it.
 * `content-encoding` and `content-length` are absent on purpose: this cache
 * stores identity bytes and sits INSIDE the compression middleware, so the
 * replay is compressed on its way out exactly like a fresh render.
 */
const REPLAYED_HEADERS = new Set([
  "content-type",
  "content-language",
  "cache-control",
  "link",
  "vary",
  "x-robots-tag",
]);

export interface CacheRequest {
  method: string;
  /** Pathname only, no query string. */
  path: string;
  /** Query string including `?`, or "". */
  search: string;
  host: string | undefined;
  cookie: string | undefined;
  authorization: string | undefined;
}

export interface CacheResponse {
  status: number;
  headers: Record<string, string | string[] | number | undefined>;
  bytes: number;
}

export type Refusal =
  | "method"
  | "path"
  | "cookie"
  | "authorization"
  | "status"
  | "set-cookie"
  | "content-type"
  | "no-store"
  | "too-large"
  | "stale-render"
  | "unreadable-chunk"
  | "disabled";

/** Strips the `/en` mirror prefix so one prefix list covers both languages. */
export function withoutLocalePrefix(path: string): string {
  if (path === "/en") return "/";
  return path.startsWith("/en/") ? path.slice(3) : path;
}

/**
 * May this REQUEST use the cache at all — for reading or for writing?
 *
 * GET only. HEAD is refused rather than special-cased: serving a HEAD from a
 * stored entry means replaying headers without a body, storing one means
 * storing an empty body under a key a GET will later ask for, and the traffic
 * that would benefit is a monitor rather than a customer.
 *
 * One function for both directions on purpose. Two functions is how a cache
 * ends up storing something it would never have served, and then serving it
 * after the rule that would have refused it is relaxed.
 */
export function requestRefusal(request: CacheRequest): Refusal | null {
  if (request.method !== "GET") return "method";
  if (request.cookie !== undefined && request.cookie !== "") return "cookie";
  if (request.authorization !== undefined && request.authorization !== "") return "authorization";

  const path = withoutLocalePrefix(request.path);
  for (const prefix of NEVER_CACHE_PREFIXES) {
    if (path === prefix || path.startsWith(`${prefix}/`)) return "path";
  }
  return null;
}

/** May this RESPONSE be stored? Called once the headers are known. */
export function responseRefusal(response: CacheResponse, maxEntryBytes: number): Refusal | null {
  if (response.status !== 200) return "status";

  const header = (name: string): string | string[] | undefined => {
    const value = response.headers[name] ?? response.headers[name.toLowerCase()];
    return typeof value === "number" ? String(value) : value;
  };

  if (header("set-cookie") !== undefined) return "set-cookie";

  const contentType = header("content-type");
  const type = Array.isArray(contentType) ? contentType[0] : contentType;
  if (typeof type !== "string" || !/^text\/html\b/i.test(type)) return "content-type";

  const control = header("cache-control");
  const controlText = Array.isArray(control) ? control.join(",") : control;
  if (typeof controlText === "string" && /\bno-store\b/i.test(controlText)) return "no-store";

  if (response.bytes > maxEntryBytes) return "too-large";
  return null;
}

/**
 * Turns whatever a stream handed us into bytes, without inventing any.
 *
 * React Router's SSR stream writes `Uint8Array` chunks, and a `Uint8Array` is
 * NOT a `Buffer`. A `Buffer.isBuffer` test alone therefore falls through to the
 * string branch, `String(chunk)` renders it as `"60,33,68,79,..."`, and the
 * cache stores a comma-separated list of byte values that it later replays as
 * the page. It is served with a 200, the right content type and the right
 * security headers, and it is not HTML.
 *
 * That is exactly what happened the first time this cache was run against a
 * real server, and it is why the case has a name and a test rather than a
 * one-line ternary.
 *
 * Returns null for anything that is not a chunk of body — a callback passed in
 * the chunk position, an object with no byte representation — so the caller
 * can decline to store rather than guess.
 */
export function chunkToBuffer(chunk: unknown, encoding?: unknown): Buffer | null {
  if (chunk === undefined || chunk === null) return null;
  if (Buffer.isBuffer(chunk)) return chunk;
  if (ArrayBuffer.isView(chunk)) {
    return Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength);
  }
  if (chunk instanceof ArrayBuffer) return Buffer.from(chunk);
  if (typeof chunk === "string") {
    const enc = typeof encoding === "string" ? (encoding as BufferEncoding) : "utf8";
    return Buffer.from(chunk, Buffer.isEncoding(enc) ? enc : "utf8");
  }
  return null;
}

/**
 * The invalidation version.
 *
 * A timestamp rather than a counter, because the counter would have to be read
 * before it could be incremented and two workers doing that at once produce the
 * same number. `Date.now()` needs no read, so a bump is a single write that
 * cannot lose to a concurrent one.
 *
 * ── WHY A FILE ──────────────────────────────────────────────────────────────
 *
 * Passenger may run more than one Node worker for the same application, each
 * with its own heap and therefore its own cache. A bump in worker A has to
 * reach worker B or B keeps serving the old price until its TTL expires. The
 * workers share a filesystem and share nothing else, so the file is the signal.
 *
 * The read is off the request path: `current()` returns the value it already
 * has and refreshes in the background at most once a second. A worker can
 * therefore be up to one second behind a bump made by another worker, which is
 * a bound worth stating rather than a bug worth hiding.
 */
export class CacheVersion {
  #value = 0;
  #file: string | null;
  #refreshedAt = 0;
  #refreshing = false;
  readonly refreshIntervalMs: number;

  constructor(options: { file?: string | undefined; refreshIntervalMs?: number } = {}) {
    this.#file = options.file ?? null;
    this.refreshIntervalMs = options.refreshIntervalMs ?? 1_000;

    /*
     * Read once, synchronously, at construction.
     *
     * This is the only synchronous read in the whole mechanism and it happens
     * at startup, not on a request. Without it the first request computes a key
     * under version 0, the background refresh then moves the version, and the
     * page it rendered is discarded as a stale render — every worker throws
     * away its first page after every restart for no reason.
     */
    if (this.#file !== null) {
      try {
        const value = Number(readFileSync(this.#file, "utf8").trim());
        if (Number.isFinite(value) && value > 0) this.#value = value;
        this.#refreshedAt = Date.now();
      } catch {
        // Nothing has been bumped yet. Not an error.
      }
    }
  }

  /** Never blocks, never throws. */
  current(now = Date.now()): number {
    if (this.#file !== null && now - this.#refreshedAt >= this.refreshIntervalMs) {
      this.#refreshedAt = now;
      void this.#refresh();
    }
    return this.#value;
  }

  /** Makes every entry stored under the previous version unreachable. */
  async bump(now = Date.now()): Promise<void> {
    // Strictly increasing even when two bumps land inside the same millisecond,
    // otherwise the second one is a no-op and its write is never invalidated.
    this.#value = Math.max(now, this.#value + 1);
    this.#refreshedAt = now;
    if (this.#file === null) return;
    try {
      await fs.writeFile(this.#file, String(this.#value), "utf8");
    } catch {
      // A cache that cannot write its signal is still a correct cache, because
      // the TTL bounds the staleness. Failing the merchant's save because an
      // optimisation could not write a file would not be.
    }
  }

  async #refresh(): Promise<void> {
    if (this.#refreshing || this.#file === null) return;
    this.#refreshing = true;
    try {
      const text = await fs.readFile(this.#file, "utf8");
      const value = Number(text.trim());
      if (Number.isFinite(value) && value > this.#value) this.#value = value;
    } catch {
      // No file yet: nothing has been bumped. Not an error.
    } finally {
      this.#refreshing = false;
    }
  }
}

export interface CacheEntry {
  key: string;
  status: number;
  headers: Record<string, string>;
  body: Buffer;
  storedAt: number;
  version: number;
}

export interface CacheStats {
  hits: number;
  misses: number;
  stores: number;
  evictions: number;
  expired: number;
  invalidated: number;
  entries: number;
  bytes: number;
  refusals: Record<string, number>;
}

/**
 * A bounded store with least-recently-used eviction.
 *
 * A `Map` in insertion order IS an LRU once a read re-inserts the key, which is
 * why there is no list here. The bound is on BYTES as well as entries: a
 * thousand small pages and twenty large ones are the same risk to a process
 * with a memory allowance, and only the byte bound sees both.
 */
export class ResponseCacheStore {
  readonly #entries = new Map<string, CacheEntry>();
  readonly maxEntries: number;
  readonly maxTotalBytes: number;
  readonly maxEntryBytes: number;
  readonly ttlMs: number;
  #bytes = 0;

  readonly stats: CacheStats = {
    hits: 0,
    misses: 0,
    stores: 0,
    evictions: 0,
    expired: 0,
    invalidated: 0,
    entries: 0,
    bytes: 0,
    refusals: {},
  };

  constructor(
    options: {
      maxEntries?: number;
      maxTotalBytes?: number;
      maxEntryBytes?: number;
      ttlMs?: number;
    } = {},
  ) {
    this.maxEntries = options.maxEntries ?? 500;
    this.maxTotalBytes = options.maxTotalBytes ?? DEFAULT_MAX_TOTAL_BYTES;
    this.maxEntryBytes = options.maxEntryBytes ?? DEFAULT_MAX_ENTRY_BYTES;
    this.ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
  }

  get size(): number {
    return this.#entries.size;
  }

  get bytes(): number {
    return this.#bytes;
  }

  refuse(reason: Refusal): void {
    this.stats.refusals[reason] = (this.stats.refusals[reason] ?? 0) + 1;
  }

  get(key: string, version: number, now = Date.now()): CacheEntry | null {
    const entry = this.#entries.get(key);
    if (entry === undefined) {
      this.stats.misses += 1;
      return null;
    }

    if (entry.version !== version) {
      this.#drop(entry);
      this.stats.invalidated += 1;
      this.stats.misses += 1;
      return null;
    }

    if (now - entry.storedAt >= this.ttlMs) {
      this.#drop(entry);
      this.stats.expired += 1;
      this.stats.misses += 1;
      return null;
    }

    // Re-insert to move it to the young end of the iteration order.
    this.#entries.delete(key);
    this.#entries.set(key, entry);
    this.stats.hits += 1;
    return entry;
  }

  set(
    key: string,
    value: { status: number; headers: Record<string, string>; body: Buffer; version: number },
    now = Date.now(),
  ): void {
    if (value.body.byteLength > this.maxEntryBytes) {
      this.refuse("too-large");
      return;
    }

    const existing = this.#entries.get(key);
    if (existing !== undefined) this.#drop(existing);

    const entry: CacheEntry = { key, ...value, storedAt: now };
    this.#entries.set(key, entry);
    this.#bytes += entry.body.byteLength;
    this.stats.stores += 1;

    while (this.#entries.size > this.maxEntries || this.#bytes > this.maxTotalBytes) {
      const oldest = this.#entries.values().next().value;
      if (oldest === undefined) break;
      this.#drop(oldest);
      this.stats.evictions += 1;
    }

    this.stats.entries = this.#entries.size;
    this.stats.bytes = this.#bytes;
  }

  clear(): void {
    this.#entries.clear();
    this.#bytes = 0;
    this.stats.entries = 0;
    this.stats.bytes = 0;
  }

  #drop(entry: CacheEntry): void {
    if (this.#entries.delete(entry.key)) {
      this.#bytes -= entry.body.byteLength;
      this.stats.entries = this.#entries.size;
      this.stats.bytes = this.#bytes;
    }
  }
}

/**
 * The cache key.
 *
 * Host is in it because a deployment that answers to two names must not serve
 * one name's absolute URLs under the other. The version is in it so a bump
 * orphans every entry without walking the map. The query string is included
 * whole and unsorted: `?a=1&b=2` and `?b=2&a=1` render the same page and get
 * two entries, which wastes a little memory and cannot serve a wrong one —
 * the right way round for a mistake of this kind.
 *
 * Hashed because a key is held for as long as its entry and a long URL held a
 * thousand times is memory spent on strings rather than on pages.
 */
export function cacheKey(request: CacheRequest, version: number): string {
  const raw = `${version}\n${request.host ?? ""}\n${request.path}\n${request.search}`;
  return createHash("sha1").update(raw).digest("base64url");
}

/** Copies the headers that may be replayed. Everything else is dropped. */
export function replayableHeaders(
  headers: Record<string, string | string[] | number | undefined>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers)) {
    const lower = name.toLowerCase();
    if (!REPLAYED_HEADERS.has(lower)) continue;
    if (value === undefined) continue;
    out[lower] = Array.isArray(value) ? value.join(", ") : String(value);
  }
  return out;
}

/**
 * Mutations that cannot change what an anonymous visitor sees.
 *
 * The default for a mutation is to invalidate. This list is the exception, and
 * it is short on purpose: adding a path here is a promise that no write behind
 * it ever changes a public page, and getting that promise wrong shows a
 * customer a stale price. Adding to a cart does not — reservations are created
 * by orders, not by carts (docs/inventory-and-reservations.md).
 */
const NON_INVALIDATING_PREFIXES = ["/carrello", "/api/auth"] as const;

export interface Mutation {
  method: string;
  path: string;
  status: number;
  /**
   * Did the request carry something that could authorise a write — a cookie, an
   * Authorization header, the scheduled-job secret?
   *
   * Without this, an anonymous `POST /admin/prodotti` invalidates the cache. It
   * changes nothing (it is redirected to the login page, and a 302 is a
   * success), but it empties the cache, and anything on the internet can send
   * one in a loop. Every write in this application needs either a session
   * cookie, a cart cookie or the job secret, so a request carrying none of them
   * cannot have changed a row and must not be allowed to invalidate anything.
   */
  credentialed: boolean;
}

export function mutationInvalidates(mutation: Mutation): boolean {
  const { method, path, status, credentialed } = mutation;
  if (method === "GET" || method === "HEAD" || method === "OPTIONS") return false;
  if (status >= 400) return false;
  if (!credentialed) return false;
  const normalised = withoutLocalePrefix(path);
  return !NON_INVALIDATING_PREFIXES.some(
    (prefix) => normalised === prefix || normalised.startsWith(`${prefix}/`),
  );
}
