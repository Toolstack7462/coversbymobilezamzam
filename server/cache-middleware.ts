/**
 * Wiring for the response cache: where it sits in the middleware stack, and
 * why it sits there.
 *
 * ── ORDER IS THE WHOLE DESIGN ───────────────────────────────────────────────
 *
 * It must be mounted AFTER `compression()` and AFTER the response-policy
 * middleware. Both of those patch the response object, and the order of the
 * patches decides what this cache stores and whether a replay is safe.
 *
 * AFTER compression: compression patches `res.write`/`res.end` when it runs, so
 * whichever middleware patches LAST sees the bytes first. Mounted after, this
 * cache captures the application's identity bytes and hands its replay to
 * compression, which gzips it exactly as it would a fresh render. Mounted
 * before, it would capture gzipped bytes and replay them with no
 * `content-encoding` — a page of binary rubbish for any client that had not
 * asked for gzip.
 *
 * AFTER the response policy: the policy patches `res.writeHead`. A cache hit
 * ends the response without calling `next()`, so anything mounted after this
 * never runs. Sitting behind the policy means a replayed page still gets its
 * CSP, `X-Frame-Options` and the rest — a cached page with no security headers
 * is a hole that opens under load and closes when the cache is cold, which is
 * the worst kind.
 */

import type { Request, Response, NextFunction, RequestHandler } from "express";

import {
  cacheKey,
  chunkToBuffer,
  mutationInvalidates,
  replayableHeaders,
  requestRefusal,
  responseRefusal,
  type CacheRequest,
  type CacheVersion,
  type ResponseCacheStore,
} from "./response-cache";

export interface ResponseCacheOptions {
  enabled: boolean;
  store: ResponseCacheStore;
  version: CacheVersion;
  /** Set the `x-cache` header. Off in production: it tells a visitor nothing. */
  reveal: boolean;
}

function describe(req: Request): CacheRequest {
  const query = req.originalUrl.indexOf("?");
  return {
    method: req.method,
    path: req.path,
    search: query >= 0 ? req.originalUrl.slice(query) : "",
    host: req.headers.host,
    cookie: req.headers.cookie,
    authorization: req.headers.authorization,
  };
}

/**
 * Serves a stored page, or captures the one about to be rendered.
 *
 * The capture is deliberately narrow. It buffers the body ONLY when the
 * response has already passed `responseRefusal`, so a 500, an admin page or a
 * redirect streams straight through untouched and costs nothing — a cache that
 * buffers everything in order to decide afterwards is a memory amplifier on
 * exactly the requests that are already going badly.
 */
export function responseCache(options: ResponseCacheOptions): RequestHandler {
  const { store, version, reveal } = options;

  return function cacheMiddleware(req: Request, res: Response, next: NextFunction): void {
    if (!options.enabled) {
      store.refuse("disabled");
      return next();
    }

    const request = describe(req);
    const refusal = requestRefusal(request);
    if (refusal !== null) {
      store.refuse(refusal);
      if (reveal) res.setHeader("x-cache", `BYPASS-${refusal}`);
      return next();
    }

    const currentVersion = version.current();
    const key = cacheKey(request, currentVersion);

    const hit = store.get(key, currentVersion);
    if (hit !== null) {
      for (const [name, value] of Object.entries(hit.headers)) res.setHeader(name, value);
      if (reveal) res.setHeader("x-cache", "HIT");
      res.status(hit.status);
      // `res.end` here is compression's, so the replay is compressed on the way
      // out. Nothing below this line runs: a hit does not call `next()`.
      res.end(hit.body);
      return;
    }

    if (reveal) res.setHeader("x-cache", "MISS");

    const originalWrite = res.write.bind(res);
    const originalEnd = res.end.bind(res);

    let chunks: Buffer[] | null = null;
    let captured = 0;
    let decided = false;

    /**
     * Decided once, at the first byte, when the headers are final.
     *
     * Not at `writeHead`: React Router streams, so `writeHead` fires before the
     * body exists and before anything is known about its size. The first write
     * is the earliest point at which the status and content type are settled.
     */
    const decide = (): void => {
      if (decided) return;
      decided = true;
      const verdict = responseRefusal(
        { status: res.statusCode, headers: res.getHeaders(), bytes: 0 },
        store.maxEntryBytes,
      );
      if (verdict !== null) {
        store.refuse(verdict);
        return;
      }
      chunks = [];
    };

    const collect = (chunk: unknown, encoding?: unknown): void => {
      if (chunks === null) return;
      if (chunk === undefined || chunk === null) return;

      const buffer = chunkToBuffer(chunk, encoding);
      if (buffer === null) {
        // Something was written that has no byte representation we recognise.
        // Storing a guess at it is how a page becomes a list of numbers.
        store.refuse("unreadable-chunk");
        chunks = null;
        return;
      }

      captured += buffer.byteLength;
      if (captured > store.maxEntryBytes) {
        // Stop holding it the moment it cannot be stored, rather than
        // discovering that at the end with the whole body in memory.
        store.refuse("too-large");
        chunks = null;
        return;
      }
      chunks.push(buffer);
    };

    res.write = function patchedWrite(
      this: Response,
      chunk: unknown,
      ...rest: unknown[]
    ): ReturnType<Response["write"]> {
      decide();
      collect(chunk, rest[0]);
      return (originalWrite as (...args: unknown[]) => ReturnType<Response["write"]>)(
        chunk,
        ...rest,
      );
    } as Response["write"];

    res.end = function patchedEnd(
      this: Response,
      chunk?: unknown,
      ...rest: unknown[]
    ): ReturnType<Response["end"]> {
      // A body sent in one call reaches `end` without ever touching `write`.
      if (typeof chunk !== "function") {
        decide();
        collect(chunk, rest[0]);
      }

      if (chunks !== null) {
        const body = Buffer.concat(chunks);
        const verdict = responseRefusal(
          { status: res.statusCode, headers: res.getHeaders(), bytes: body.byteLength },
          store.maxEntryBytes,
        );
        /*
         * A mutation that landed WHILE this page was rendering discards it.
         *
         * The render may have read its data before the write committed, so the
         * page in hand is possibly already stale. Storing it under the old
         * version would be pointless and storing it under the new one would
         * publish the stale copy as though it were fresh. Neither: throw it
         * away and let the next request render again.
         */
        if (version.current() !== currentVersion) {
          store.refuse("stale-render");
        } else if (verdict === null) {
          store.set(key, {
            status: res.statusCode,
            headers: replayableHeaders(res.getHeaders()),
            body,
            version: currentVersion,
          });
        } else {
          store.refuse(verdict);
        }
        chunks = null;
      }

      return (originalEnd as (...args: unknown[]) => ReturnType<Response["end"]>)(chunk, ...rest);
    } as Response["end"];

    next();
  };
}

/**
 * Invalidates on any successful mutation that could change a public page.
 *
 * Mounted before the request handler and acting on `finish`, so it sees the
 * status the application actually returned rather than the one it intended.
 * A failed save must not invalidate: throwing the cache away because somebody
 * mistyped a price is a self-inflicted cold cache.
 */
export function invalidateOnMutation(version: CacheVersion): RequestHandler {
  return function invalidator(req: Request, res: Response, next: NextFunction): void {
    res.on("finish", () => {
      const credentialed =
        (req.headers.cookie ?? "") !== "" ||
        (req.headers.authorization ?? "") !== "" ||
        req.headers["x-job-secret"] !== undefined;

      if (
        mutationInvalidates({
          method: req.method,
          path: req.path,
          status: res.statusCode,
          credentialed,
        })
      ) {
        void version.bump();
      }
    });
    next();
  };
}
