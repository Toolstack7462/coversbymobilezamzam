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

export default {
  fetch(request, env, ctx) {
    const context = new RouterContextProvider();
    context.set(cloudflareContext, { env, ctx });
    return requestHandler(request, context);
  },

  /**
   * Cron: every five minutes, UTC. See wrangler.jsonc.
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
