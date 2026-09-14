import { describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  CacheVersion,
  NEVER_CACHE_PREFIXES,
  ResponseCacheStore,
  cacheKey,
  chunkToBuffer,
  mutationInvalidates,
  replayableHeaders,
  requestRefusal,
  responseRefusal,
  withoutLocalePrefix,
  type CacheRequest,
} from "../../server/response-cache";

/**
 * The response cache is a SHARED cache: an entry stored for one visitor can be
 * handed to the next. Every test in the first two blocks is therefore an
 * isolation test, and each one describes a way one person's page could reach
 * somebody else. They are pinned here rather than left to the end-to-end proof
 * because these run on every `npm run verify`, in a second, with no server.
 *
 * The end-to-end counterpart — the same rules against a real Node + MariaDB
 * server over real HTTP — is `npm run test:cache-isolation`.
 */

const anonymous: CacheRequest = {
  method: "GET",
  path: "/",
  search: "",
  host: "shop.example",
  cookie: undefined,
  authorization: undefined,
};

describe("which requests may touch the cache", () => {
  it("admits a plain anonymous GET", () => {
    expect(requestRefusal(anonymous)).toBeNull();
  });

  it("refuses ANY request carrying ANY cookie", () => {
    // Not "any session cookie". A name-based rule is correct until something
    // adds a cookie nobody added to the list.
    for (const cookie of [
      "__Host-cart=abc",
      "better-auth.session_token=xyz",
      "consent=1",
      "anything=at-all",
    ]) {
      expect(requestRefusal({ ...anonymous, cookie })).toBe("cookie");
    }
  });

  it("treats an empty cookie header as no cookie", () => {
    expect(requestRefusal({ ...anonymous, cookie: "" })).toBeNull();
  });

  it("refuses a request with an Authorization header", () => {
    expect(requestRefusal({ ...anonymous, authorization: "Bearer x" })).toBe("authorization");
  });

  it("refuses every method but GET", () => {
    for (const method of ["POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]) {
      expect(requestRefusal({ ...anonymous, method })).toBe("method");
    }
  });

  it("refuses every never-cache prefix, and its children", () => {
    for (const prefix of NEVER_CACHE_PREFIXES) {
      expect(requestRefusal({ ...anonymous, path: prefix })).toBe("path");
      expect(requestRefusal({ ...anonymous, path: `${prefix}/anything/deeper` })).toBe("path");
    }
  });

  it("refuses the English mirror of every never-cache prefix", () => {
    // `/en/carrello` is the same cart as `/carrello`. A prefix list that only
    // knows the Italian paths caches the English checkout.
    for (const prefix of NEVER_CACHE_PREFIXES) {
      expect(requestRefusal({ ...anonymous, path: `/en${prefix}` })).toBe("path");
      expect(requestRefusal({ ...anonymous, path: `/en${prefix}/deeper` })).toBe("path");
    }
  });

  it("does not refuse a path that merely starts with the same letters", () => {
    // `/ordinamento` is not `/ordine`. A `startsWith` with no boundary check
    // would refuse it, which is only a performance bug — but the same missing
    // boundary in the other direction is how `/adminx` becomes cacheable.
    expect(requestRefusal({ ...anonymous, path: "/ordinamento" })).toBeNull();
    expect(requestRefusal({ ...anonymous, path: "/mediateca" })).toBeNull();
  });

  it("admits the storefront pages this exists for", () => {
    for (const path of [
      "/",
      "/shop",
      "/prodotti/cover-iphone-15",
      "/trova-dispositivo",
      "/negozio",
      "/pagine/chi-siamo",
      "/legale/privacy",
      "/en",
      "/en/shop",
    ]) {
      expect(requestRefusal({ ...anonymous, path })).toBeNull();
    }
  });

  it("strips only a whole /en segment", () => {
    expect(withoutLocalePrefix("/en")).toBe("/");
    expect(withoutLocalePrefix("/en/shop")).toBe("/shop");
    expect(withoutLocalePrefix("/energia")).toBe("/energia");
  });
});

describe("which responses may be stored", () => {
  const html = { "content-type": "text/html; charset=utf-8" };

  it("stores a 200 HTML page", () => {
    expect(responseRefusal({ status: 200, headers: html, bytes: 1000 }, 4096)).toBeNull();
  });

  it("never stores a response that sets a cookie", () => {
    // The one that matters most: a stored Set-Cookie is one visitor's session
    // handed to everybody who asks for the page next.
    expect(
      responseRefusal(
        { status: 200, headers: { ...html, "set-cookie": ["__Host-cart=abc"] }, bytes: 10 },
        4096,
      ),
    ).toBe("set-cookie");
  });

  it("never stores anything but a 200", () => {
    for (const status of [301, 302, 304, 400, 401, 403, 404, 500, 503]) {
      expect(responseRefusal({ status, headers: html, bytes: 10 }, 4096)).toBe("status");
    }
  });

  it("never stores a non-HTML body", () => {
    for (const type of ["application/json", "image/webp", "text/plain", "text/x-script"]) {
      expect(
        responseRefusal({ status: 200, headers: { "content-type": type }, bytes: 10 }, 4096),
      ).toBe("content-type");
    }
  });

  it("never stores a response with no content type", () => {
    expect(responseRefusal({ status: 200, headers: {}, bytes: 10 }, 4096)).toBe("content-type");
  });

  it("honours no-store even on an HTML 200", () => {
    expect(
      responseRefusal(
        { status: 200, headers: { ...html, "cache-control": "private, no-store" }, bytes: 10 },
        4096,
      ),
    ).toBe("no-store");
  });

  it("does not confuse no-cache with no-store", () => {
    // `no-cache` means revalidate before reuse by the BROWSER. It says nothing
    // about a server-side store, and the storefront sends it on every page —
    // reading it as no-store would disable the cache entirely.
    expect(
      responseRefusal(
        { status: 200, headers: { ...html, "cache-control": "private, no-cache" }, bytes: 10 },
        4096,
      ),
    ).toBeNull();
  });

  it("refuses a body over the entry cap", () => {
    expect(responseRefusal({ status: 200, headers: html, bytes: 4097 }, 4096)).toBe("too-large");
  });
});

describe("what is replayed", () => {
  it("copies only the allowlisted headers", () => {
    const copied = replayableHeaders({
      "content-type": "text/html; charset=utf-8",
      "cache-control": "private, no-cache",
      "set-cookie": ["a=1", "b=2"],
      "x-request-id": "abc",
      authorization: "Bearer x",
      etag: 'W/"1"',
    });
    expect(copied).toEqual({
      "content-type": "text/html; charset=utf-8",
      "cache-control": "private, no-cache",
    });
  });

  it("drops content-encoding and content-length", () => {
    // The cache stores identity bytes and sits inside the compression
    // middleware. Replaying either header would describe bytes that no longer
    // exist by the time the client sees them.
    const copied = replayableHeaders({
      "content-type": "text/html",
      "content-encoding": "gzip",
      "content-length": 1234,
    });
    expect(Object.keys(copied)).toEqual(["content-type"]);
  });
});

describe("reading a chunk of body", () => {
  const html = '<!DOCTYPE html><html lang="it">';

  it("passes a Buffer through", () => {
    expect(chunkToBuffer(Buffer.from(html))?.toString()).toBe(html);
  });

  it("reads a Uint8Array as bytes, not as a list of numbers", () => {
    /*
     * The regression this file exists for.
     *
     * React Router's SSR stream writes Uint8Arrays, and a Uint8Array is not a
     * Buffer. A `Buffer.isBuffer` test that falls through to `String(chunk)`
     * turns the homepage into "60,33,68,79,67,84,89,80,69,..." — stored,
     * replayed with a 200 and the right content type, and not HTML. It reached
     * a running server before it was caught.
     */
    const bytes = new Uint8Array(Buffer.from(html));
    expect(chunkToBuffer(bytes)?.toString()).toBe(html);
    expect(chunkToBuffer(bytes)?.toString()).not.toContain(",60,");
  });

  it("respects a view's offset and length", () => {
    const backing = Buffer.from("XXXhelloYYY");
    const view = new Uint8Array(backing.buffer, backing.byteOffset + 3, 5);
    expect(chunkToBuffer(view)?.toString()).toBe("hello");
  });

  it("reads a string in the encoding it was written with", () => {
    expect(chunkToBuffer("città")?.toString()).toBe("città");
    expect(chunkToBuffer(Buffer.from("città").toString("base64"), "base64")?.toString()).toBe(
      "città",
    );
  });

  it("falls back to utf8 for an encoding Node does not know", () => {
    expect(chunkToBuffer("città", "not-an-encoding")?.toString()).toBe("città");
  });

  it("returns null rather than guessing at anything else", () => {
    expect(chunkToBuffer(null)).toBeNull();
    expect(chunkToBuffer(undefined)).toBeNull();
    expect(chunkToBuffer(() => {})).toBeNull();
    expect(chunkToBuffer({ toString: () => "not really a chunk" })).toBeNull();
  });
});

describe("keys", () => {
  it("separates two paths, two query strings, two hosts and two versions", () => {
    const base = cacheKey(anonymous, 1);
    expect(cacheKey({ ...anonymous, path: "/shop" }, 1)).not.toBe(base);
    expect(cacheKey({ ...anonymous, search: "?q=cover" }, 1)).not.toBe(base);
    expect(cacheKey({ ...anonymous, host: "other.example" }, 1)).not.toBe(base);
    expect(cacheKey(anonymous, 2)).not.toBe(base);
  });

  it("is stable for the same request", () => {
    expect(cacheKey(anonymous, 7)).toBe(cacheKey({ ...anonymous }, 7));
  });

  it("does not let a path and a query string be confused for each other", () => {
    // `/a` + `?b` and `/a?b` + `` must not collide: a separator-free key would
    // serve a search result as the page it searched.
    expect(cacheKey({ ...anonymous, path: "/a", search: "?b" }, 1)).not.toBe(
      cacheKey({ ...anonymous, path: "/a?b", search: "" }, 1),
    );
  });
});

describe("the store", () => {
  const entry = (body: string) => ({
    status: 200,
    headers: { "content-type": "text/html" },
    body: Buffer.from(body),
    version: 1,
  });

  it("returns what it stored", () => {
    const store = new ResponseCacheStore();
    store.set("k", entry("hello"));
    expect(store.get("k", 1)?.body.toString()).toBe("hello");
    expect(store.stats.hits).toBe(1);
  });

  it("misses on a different version and forgets the entry", () => {
    const store = new ResponseCacheStore();
    store.set("k", entry("old"));
    expect(store.get("k", 2)).toBeNull();
    expect(store.stats.invalidated).toBe(1);
    expect(store.size).toBe(0);
  });

  it("expires an entry at the TTL", () => {
    const store = new ResponseCacheStore({ ttlMs: 1000 });
    store.set("k", entry("x"), 10_000);
    expect(store.get("k", 1, 10_999)).not.toBeNull();
    expect(store.get("k", 1, 11_000)).toBeNull();
    expect(store.stats.expired).toBe(1);
  });

  it("evicts the least recently used when the entry cap is reached", () => {
    const store = new ResponseCacheStore({ maxEntries: 2 });
    store.set("a", entry("a"));
    store.set("b", entry("b"));
    store.get("a", 1); // `a` is now the most recently used
    store.set("c", entry("c"));
    expect(store.get("a", 1)).not.toBeNull();
    expect(store.get("b", 1)).toBeNull();
    expect(store.get("c", 1)).not.toBeNull();
  });

  it("evicts on the byte budget as well as the entry count", () => {
    // Twenty large pages and a thousand small ones are the same risk to a
    // process with a memory allowance, and only a byte bound sees both.
    const store = new ResponseCacheStore({ maxEntries: 1000, maxTotalBytes: 300 });
    for (let i = 0; i < 10; i += 1) store.set(`k${i}`, entry("x".repeat(100)));
    expect(store.bytes).toBeLessThanOrEqual(300);
    expect(store.size).toBeLessThanOrEqual(3);
    expect(store.stats.evictions).toBeGreaterThan(0);
  });

  it("refuses an entry over the per-entry cap without disturbing the rest", () => {
    const store = new ResponseCacheStore({ maxEntryBytes: 10 });
    store.set("small", entry("12345"));
    store.set("big", entry("x".repeat(50)));
    expect(store.get("small", 1)).not.toBeNull();
    expect(store.get("big", 1)).toBeNull();
    expect(store.stats.refusals["too-large"]).toBe(1);
  });

  it("keeps the byte total honest when a key is overwritten", () => {
    const store = new ResponseCacheStore();
    store.set("k", entry("x".repeat(100)));
    store.set("k", entry("y"));
    expect(store.size).toBe(1);
    expect(store.bytes).toBe(1);
  });
});

describe("the version", () => {
  it("advances on every bump even within one millisecond", async () => {
    const version = new CacheVersion();
    const first = version.current();
    await version.bump(1_000);
    await version.bump(1_000);
    expect(version.current()).toBe(1_001);
    expect(version.current()).toBeGreaterThan(first);
  });

  it("never goes backwards when the clock does", async () => {
    const version = new CacheVersion();
    await version.bump(5_000);
    await version.bump(4_000);
    expect(version.current()).toBe(5_001);
  });

  it("publishes a bump to another process through the shared file", async () => {
    // The multi-worker case: Passenger may run more than one Node worker, each
    // with its own heap and therefore its own cache. Without this, a save in
    // worker A leaves worker B serving the old page until its TTL expires.
    const file = join(mkdtempSync(join(tmpdir(), "cache-version-")), "v");
    const workerA = new CacheVersion({ file, refreshIntervalMs: 0 });
    const workerB = new CacheVersion({ file, refreshIntervalMs: 0 });

    expect(workerB.current()).toBe(0);
    await workerA.bump(9_000);

    // `current()` refreshes in the background rather than blocking a request.
    workerB.current();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(workerB.current()).toBe(9_000);
  });

  it("survives a missing or unwritable file", async () => {
    const version = new CacheVersion({ file: "/definitely/not/a/directory/v" });
    expect(() => version.current()).not.toThrow();
    await expect(version.bump()).resolves.toBeUndefined();
  });
});

describe("what invalidates", () => {
  const mutation = (over: Partial<Parameters<typeof mutationInvalidates>[0]>) =>
    mutationInvalidates({
      method: "POST",
      path: "/admin/prodotti/p1",
      status: 200,
      credentialed: true,
      ...over,
    });

  it("invalidates on any successful admin mutation", () => {
    for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
      expect(mutation({ method })).toBe(true);
      expect(mutation({ method, path: "/admin/impostazioni", status: 302 })).toBe(true);
    }
  });

  it("invalidates on checkout, because an order reserves stock", () => {
    expect(mutation({ path: "/cassa", status: 302 })).toBe(true);
    expect(mutation({ path: "/en/cassa", status: 302 })).toBe(true);
  });

  it("does not invalidate on a cart change or a sign-in", () => {
    // A cart holds nothing; reservations come from orders. Invalidating on
    // every add-to-cart would empty the cache under exactly the traffic it
    // exists to serve.
    expect(mutation({ path: "/carrello", status: 302 })).toBe(false);
    expect(mutation({ path: "/en/carrello", status: 302 })).toBe(false);
    expect(mutation({ path: "/api/auth/sign-in/email" })).toBe(false);
  });

  it("does not invalidate on a failed mutation", () => {
    expect(mutation({ status: 400 })).toBe(false);
    expect(mutation({ status: 500 })).toBe(false);
  });

  it("does not invalidate on a read", () => {
    expect(mutation({ method: "GET" })).toBe(false);
    expect(mutation({ method: "HEAD", path: "/" })).toBe(false);
  });

  it("does not let an anonymous request empty the cache", () => {
    // `POST /admin/prodotti` with no session is redirected to the login page,
    // and a 302 is a success. Without the credential check, anything on the
    // internet could hold the cache permanently cold with a loop of those.
    expect(mutation({ credentialed: false, status: 302 })).toBe(false);
    expect(mutation({ credentialed: false, path: "/cassa", status: 302 })).toBe(false);
  });

  it("invalidates on an unknown mutation path", () => {
    // The default direction is over-invalidation. A route added later that
    // changes a price must not need anybody to remember this file.
    expect(mutation({ path: "/something/new" })).toBe(true);
  });
});
