import { createContext, createRequestHandler, RouterContextProvider } from "react-router";
import { expireReservations } from "~/application/commands/expire-reservations";
import { systemClock, cryptoIds } from "~/infrastructure/primitives";
import {
  CSP_DEVELOPMENT,
  CSP_PRODUCTION,
  LOCAL_ENVIRONMENTS,
  NON_INDEXABLE_ENVIRONMENTS,
  PERMISSIONS_POLICY,
  cacheControlFor,
} from "./response-policy";

/**
 * The Worker entry point.
 *
 * `fetch` hands every request to React Router, which owns routing and SSR.
 * `scheduled` runs the reservation sweeper.
 *
 * React Router v8 replaced the old `AppLoadContext` object with typed contexts:
 * a loader reads the bindings with `context.get(cloudflareContext)` rather than
 * destructuring an untyped bag.
 */

export interface CloudflareContext {
  env: Env;
  ctx: ExecutionContext;
}

/** Read in loaders and actions via `context.get(cloudflareContext)`. */
export const cloudflareContext = createContext<CloudflareContext>();

const requestHandler = createRequestHandler(
  () => import("virtual:react-router/server-build"),
  import.meta.env.MODE,
);

/**
 * Applied at the WORKER level, not per route.
 *
 * Per-route protection is correct until somebody adds a route. This covers every
 * response the Worker produces — HTML, JSON, redirects, 404s and 500s alike —
 * and there is nothing for a new route to remember.
 *
 * It does NOT cover static assets. Cloudflare serves everything under
 * `build/client` without invoking the Worker at all, so those responses are
 * unreachable from here; they are handled by `public/_headers`. The previous
 * version of this comment claimed static assets were covered. They were not:
 * not one `.js` or `.css` file ever carried the noindex header.
 */
function applyResponseHeaders(response: Response, env: Env, request: Request): Response {
  const appEnv = env.APP_ENV ?? "development";

  // A new Response, because the one React Router returns may have immutable
  // headers — notably any response constructed from a cached asset.
  const headers = new Headers(response.headers);

  headers.set(
    "content-security-policy",
    LOCAL_ENVIRONMENTS.has(appEnv) ? CSP_DEVELOPMENT : CSP_PRODUCTION,
  );
  // Redundant with frame-ancestors for any browser released this decade, and
  // still the only one some corporate proxies and older clients honour.
  headers.set("x-frame-options", "DENY");
  headers.set("x-content-type-options", "nosniff");
  // Send the origin cross-site, never the path: an order-tracking URL carries a
  // token, and a referrer is the easiest way to hand one to a third party.
  headers.set("referrer-policy", "strict-origin-when-cross-origin");
  headers.set("permissions-policy", PERMISSIONS_POLICY);
  headers.set("cross-origin-opener-policy", "same-origin");

  /*
   * A `Content-Type` of bare `text/html` leaves the encoding to whatever the
   * client decides to guess. This shop is Italian: every other product name has
   * an accent in it, and a client that guesses Latin-1 renders `città` as
   * mojibake. React Router sets the type without a charset, so it is appended
   * here rather than at each of the places a response can be constructed.
   */
  const contentType = headers.get("content-type");
  if (contentType && /^text\//i.test(contentType) && !/charset=/i.test(contentType)) {
    headers.set("content-type", `${contentType}; charset=utf-8`);
  }

  const url = new URL(request.url);
  if (url.protocol === "https:") {
    // No `preload`. Preloading is submitted to a browser-maintained list and is
    // slow and awkward to undo; not a decision to make on a preview.
    headers.set("strict-transport-security", "max-age=31536000; includeSubDomains");
  }

  // Only when the route has not already decided. `/api/health` sets `no-store`
  // for its own reasons and knows better than a path prefix does.
  if (!headers.has("cache-control")) {
    headers.set("cache-control", cacheControlFor(url.pathname));
  }

  if (NON_INDEXABLE_ENVIRONMENTS.has(appEnv)) {
    headers.set("x-robots-tag", "noindex, nofollow, noarchive, nosnippet");
  }

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export default {
  async fetch(request, env, ctx) {
    const context = new RouterContextProvider();
    context.set(cloudflareContext, { env, ctx });

    const response = await requestHandler(request, context);
    return applyResponseHeaders(response, env, request);
  },

  /**
   * Cron, UTC — always UTC, Cloudflare crons have no timezone. Every five
   * minutes in the base configuration, every fifteen in preview; both are
   * declared in wrangler.jsonc and neither is read here.
   *
   * The handler is idempotent, so an overlapping or repeated run is harmless -
   * which matters because Cloudflare gives at-least-once delivery, not exactly
   * once.
   */
  async scheduled(_event, env, _ctx) {
    await expireReservations({
      d1: env.DB,
      clock: systemClock,
      ids: cryptoIds,
    });
  },
} satisfies ExportedHandler<Env>;
