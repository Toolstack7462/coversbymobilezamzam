import { createRequestHandler, RouterContextProvider } from "react-router";
import { expireReservations } from "~/application/commands/expire-reservations";
import { systemClock, cryptoIds } from "~/infrastructure/primitives";
import { appContext, type AppEnv } from "~/runtime/context";
import { D1SqlDatabase } from "~/infrastructure/db/d1";
import { R2ObjectStore } from "~/infrastructure/storage/r2";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { createD1Db } from "~/infrastructure/db/client";
import { user, session, account, verification, twoFactor } from "@db/schema";
import { setAuthDatabaseFactory } from "~/infrastructure/auth/database";
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
 * a loader reads what it needs with `context.get(appContext)` rather than
 * destructuring an untyped bag.
 *
 * That context is defined in app/runtime/context.ts, NOT here. It used to live
 * in this file, which meant all sixty-six route modules imported the Worker
 * entry point — and so could not be built for any other runtime.
 */

/**
 * Wraps the Cloudflare bindings in the runtime-neutral ports.
 *
 * The rest of the application sees a `SqlDatabase` and two `ObjectStore`s and
 * cannot tell it is on Workers. That is what lets the Node server run the same
 * routes, and what keeps "does this still work on Cloudflare?" a question the
 * test suite answers rather than a claim.
 *
 * Built per request: the adapters wrap bindings that workerd hands in per
 * request anyway, so there is nothing to cache, and a module-level instance
 * would outlive the isolate's binding.
 */
function toAppEnv(env: Env): AppEnv {
  /*
   * `APP_BASE_URL` is OPTIONAL in the generated `Env` and required here.
   *
   * Wrangler makes a var optional across every environment if any one of them
   * omits it, and `restore-test` does. The application cannot work without it:
   * Better Auth signs cookies and validates request origins against this value,
   * and an absent one does not degrade — it rejects every sign-in with an
   * origin error that never reproduces locally. The wrangler.jsonc comment
   * records the deploy where exactly that happened.
   *
   * So it is asserted here, once, at the boundary, rather than defaulted to
   * something plausible.
   */
  if (!env.APP_BASE_URL) {
    throw new Error(
      "APP_BASE_URL is not set for this environment. Set it in wrangler.jsonc vars " +
        "(or .dev.vars locally) — authentication cannot work without it.",
    );
  }

  return {
    ...env,
    APP_BASE_URL: env.APP_BASE_URL,
    DB: new D1SqlDatabase(env.DB),
    MEDIA: new R2ObjectStore(env.MEDIA),
    PRIVATE_FILES: new R2ObjectStore(env.PRIVATE_FILES),
  };
}

/**
 * Better Auth's database, in the D1 dialect.
 *
 * Set per request because the binding is per request: workerd hands `env` to
 * `fetch`, and a module-level adapter would close over the first request's
 * binding and keep using it after the isolate was reused.
 *
 * The schema passed is EXPLICIT and covers Better Auth's own five tables only,
 * so the auth layer cannot reach orders or inventory even by mistake.
 */
function d1AuthDatabase(env: Env) {
  return drizzleAdapter(createD1Db(env.DB), {
    provider: "sqlite",
    schema: { user, session, account, verification, twoFactor },
  });
}

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
    setAuthDatabaseFactory(() => d1AuthDatabase(env));

    const context = new RouterContextProvider();
    context.set(appContext, {
      env: toAppEnv(env),
      waitUntil: (promise) => ctx.waitUntil(promise),
      platform: "cloudflare",
    });

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
      db: new D1SqlDatabase(env.DB),
      clock: systemClock,
      ids: cryptoIds,
    });
  },
} satisfies ExportedHandler<Env>;
