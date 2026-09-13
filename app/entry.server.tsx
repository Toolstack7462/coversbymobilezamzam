import type { EntryContext, RouterContextProvider } from "react-router";
import { ServerRouter } from "react-router";
import { isbot } from "isbot";
import { renderToReadableStream } from "react-dom/server";

/**
 * Server rendering for the WEB runtime — Cloudflare Workers.
 *
 * ── WHY THIS FILE EXISTS AT ALL ─────────────────────────────────────────────
 *
 * It did not, until the Hostinger migration added `@react-router/node` and
 * `@react-router/express` to package.json. React Router generates a default
 * entry when the application does not supply one, and it chooses which default
 * by looking at the DEPENDENCY LIST:
 *
 *     hasNodeDependency = @react-router/node || @react-router/express || @react-router/serve
 *
 * Installing an Express adapter therefore silently switched the CLOUDFLARE
 * build's renderer to `renderToPipeableStream`, which does not exist in
 * `react-dom/server.edge`. The build succeeded, `npm run verify` stayed green —
 * it type-checks and builds but never SERVES a page — and every request to the
 * deployed Worker would have been a 500:
 *
 *     TypeError: (0 , import_server_edge.renderToPipeableStream) is not a function
 *
 * The browser suite caught it. Nothing else would have.
 *
 * So both entries are now explicit. A user entry always wins over the
 * generated default, which means adding or removing an adapter package can no
 * longer change how either runtime renders.
 *
 * ── THE PAIR ────────────────────────────────────────────────────────────────
 *
 *   entry.server.tsx        this file — Web Streams, for workerd
 *   entry.server.node.tsx   Node streams, for Express
 *
 * `vite.node.config.ts` aliases this module to the Node one. Keep them in step:
 * the timeout, the bot handling and the HEAD short-circuit are behaviour, not
 * boilerplate, and a change to one belongs in both.
 *
 * Both are derived from React Router 8.3.1's own defaults so that upgrading the
 * framework is a diff against a known original rather than an archaeology
 * exercise.
 */

export const streamTimeout = 5_000;

export default async function handleRequest(
  request: Request,
  responseStatusCode: number,
  responseHeaders: Headers,
  routerContext: EntryContext,
  _loadContext: RouterContextProvider,
) {
  // https://httpwg.org/specs/rfc9110.html#HEAD
  if (request.method.toUpperCase() === "HEAD") {
    return new Response(null, {
      status: responseStatusCode,
      headers: responseHeaders,
    });
  }

  let shellRendered = false;
  const userAgent = request.headers.get("user-agent");

  const body = await renderToReadableStream(
    <ServerRouter context={routerContext} url={request.url} />,
    {
      signal: AbortSignal.timeout(streamTimeout + 1000),
      onError(error: unknown) {
        responseStatusCode = 500;
        // Streaming errors from inside the shell only. An error during initial
        // shell rendering rejects and is logged by handleDocumentRequest, and
        // logging it here as well produces two entries for one failure.
        if (shellRendered) {
          console.error(error);
        }
      },
    },
  );
  shellRendered = true;

  /*
   * Crawlers and SPA-mode renders wait for everything.
   *
   * This shop's product and collection pages must be crawlable with their
   * content in the first response — a streamed shell with the catalogue
   * arriving later is an empty page to anything that does not run JavaScript.
   */
  if ((userAgent && isbot(userAgent)) || routerContext.isSpaMode) {
    await body.allReady;
  }

  responseHeaders.set("Content-Type", "text/html");
  return new Response(body, {
    headers: responseHeaders,
    status: responseStatusCode,
  });
}
