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
 * Applied at the WORKER level, not per route.
 *
 * A `<meta name="robots">` tag covers HTML that renders successfully. This
 * covers everything: static assets, JSON, redirects, 404s and 500s alike. There
 * is no route anyone can add later that forgets it, which is the property that
 * matters — the failure mode of per-route protection is that it is correct
 * until someone adds a route.
 */
function applyPreviewHeaders(response: Response, env: Env): Response {
  if (!NON_INDEXABLE_ENVIRONMENTS.has(env.APP_ENV ?? "development")) return response;

  // A new Response, because the one React Router returns may have immutable
  // headers — notably any response constructed from a cached asset.
  const headers = new Headers(response.headers);
  headers.set("x-robots-tag", "noindex, nofollow, noarchive, nosnippet");

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
    return applyPreviewHeaders(response, env);
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
