import { createContext, createRequestHandler, RouterContextProvider } from "react-router";
import { expireReservations } from "~/application/commands/expire-reservations";
import { systemClock, cryptoIds } from "~/infrastructure/primitives";

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
 * Environments whose responses must never be indexed.
 *
 * A preview is a working copy of a real shop on a public HTTPS address. If a
 * crawler finds it, the merchant ends up with two versions of their catalogue
 * competing in search results — and the one with the demo prices and the
 * `[DEMO]` names is the one that outranks nothing but confuses everyone.
 *
 * Worse, an indexed preview leaks order-confirmation and tracking URLs, which
 * carry order numbers and tracking tokens.
 */
const NON_INDEXABLE_ENVIRONMENTS = new Set(["preview", "staging", "development", "test"]);

/**
 * Content Security Policy.
 *
 * Built once at module scope: this runs on every response, and the Worker
 * already spends 4-7ms of the free plan's 10ms CPU budget rendering a page.
 *
 * ── About `script-src 'unsafe-inline'` ───────────────────────────────────────
 *
 * It is there because this application server-renders with streaming, and React
 * emits inline scripts to deliver each chunk of loader data as it resolves —
 * five of them on the homepage. Without `'unsafe-inline'` the page renders and
 * then never hydrates, and nothing on the site is interactive.
 *
 * The proper fix is a nonce, and it is not a small one. `<Scripts nonce>` covers
 * the two scripts React Router emits, but the streaming chunks come from React
 * itself and take their nonce from `renderToReadableStream({ nonce })` — which
 * means owning `app/entry.server.tsx`, a file this project deliberately does not
 * have. That is a change to make on purpose with the browser suite watching, not
 * a side effect of adding headers.
 *
 * So this policy does not stop injected inline script. It does stop the more
 * common half of the same attack — `<script src="https://evil.example/x.js">` —
 * which `'self'` refuses.
 *
 * The directives that cost nothing and are worth the most here:
 *
 *   frame-ancestors  the admin can verify a payment and change the IBAN that
 *                    customers are told to pay into. Those pages must not be
 *                    frameable by anyone, ever.
 *   form-action      a form silently retargeted at another origin is how
 *                    credentials and payment details leave.
 *   base-uri         an injected <base> rewrites every relative URL on the page,
 *                    including the ones the forms post to.
 *   object-src       no plugin content is used, so none should be permitted.
 */
const CSP_DIRECTIVES = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "frame-src 'none'",
  "form-action 'self'",
  // Inline styles: the layout uses a handful of `style=` attributes, which no
  // nonce can ever cover — a nonce applies to <style> elements, not attributes.
  "style-src 'self' 'unsafe-inline'",
  "script-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "manifest-src 'self'",
];

/**
 * Development additionally needs a websocket to itself, for hot reload.
 *
 * Browsers disagree about whether `'self'` covers `ws:` on the same host, and a
 * policy that breaks `npm run dev` would be deleted by the next person who hit
 * it rather than fixed.
 */
export const CSP_PRODUCTION = [...CSP_DIRECTIVES, "connect-src 'self'"].join("; ");
export const CSP_DEVELOPMENT = [...CSP_DIRECTIVES, "connect-src 'self' ws: wss:"].join("; ");

const LOCAL_ENVIRONMENTS = new Set(["development", "test"]);

/** Hardware and browser features this shop has no use for. */
const PERMISSIONS_POLICY = [
  "accelerometer=()",
  "autoplay=()",
  "camera=()",
  "display-capture=()",
  "geolocation=()",
  "gyroscope=()",
  "magnetometer=()",
  "microphone=()",
  "midi=()",
  "payment=()",
  "usb=()",
].join(", ");

/**
 * How long a response may be kept, and by whom.
 *
 * Everything here is `private`, and that word is load-bearing rather than a
 * default. These pages vary by cookie — the cart is a session — so a response
 * marked `public` may be stored by a shared cache and handed to the next person
 * who asks for the same URL. That is one customer's basket shown to another.
 *
 * Nothing carried any `Cache-Control` at all before this, which left the
 * decision to each browser's heuristics.
 */
export function cacheControlFor(pathname: string): string {
  // Staff pages and API responses carry order details, customer names, payment
  // state and sessions. Not merely revalidated — never written down.
  if (pathname === "/admin" || pathname.startsWith("/admin/") || pathname.startsWith("/api/")) {
    return "private, no-store, max-age=0, must-revalidate";
  }

  // Storefront HTML may be kept by the browser that fetched it, but must be
  // revalidated before reuse: prices and stock change, and there is no
  // invalidation path that could reach a copy already handed out.
  return "private, no-cache, must-revalidate";
}

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
