import { PassThrough } from "node:stream";

import type { EntryContext, RouterContextProvider } from "react-router";
import { createReadableStreamFromReadable } from "@react-router/node";
import { ServerRouter } from "react-router";
import { isbot } from "isbot";
import type { RenderToPipeableStreamOptions } from "react-dom/server";
import { renderToPipeableStream } from "react-dom/server";

/**
 * Server rendering for NODE — the Hostinger deployment.
 *
 * The twin of `entry.server.tsx`, which handles the Cloudflare runtime. Read
 * that file's header for why both are explicit rather than generated: in
 * short, React Router picks its default entry from the dependency list, so
 * installing an Express adapter silently changed how the WORKER rendered and
 * broke it at runtime while the build stayed green.
 *
 * `vite.node.config.ts` aliases `entry.server.tsx` to this file, so the Node
 * build gets Node streams and the Cloudflare build gets Web Streams, and
 * neither depends on what happens to be in package.json.
 *
 * Behaviour is identical to its twin — same timeout, same bot handling, same
 * HEAD short-circuit. Only the streaming API differs. A change to one belongs
 * in both.
 */

export const streamTimeout = 5_000;

export default function handleRequest(
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

  return new Promise<Response>((resolve, reject) => {
    let shellRendered = false;
    const userAgent = request.headers.get("user-agent");

    /*
     * Crawlers and SPA-mode renders wait for everything.
     *
     * Product and collection pages must be crawlable with their content in the
     * first response; a streamed shell with the catalogue arriving later is an
     * empty page to anything that does not run JavaScript.
     */
    const readyOption: keyof RenderToPipeableStreamOptions =
      (userAgent && isbot(userAgent)) || routerContext.isSpaMode ? "onAllReady" : "onShellReady";

    // Abort after the timeout so rejected boundaries still have time to flush.
    let timeoutId: ReturnType<typeof setTimeout> | undefined = setTimeout(
      () => abort(),
      streamTimeout + 1000,
    );

    const { pipe, abort } = renderToPipeableStream(
      <ServerRouter context={routerContext} url={request.url} />,
      {
        [readyOption]() {
          shellRendered = true;
          const body = new PassThrough({
            final(callback) {
              // Clearing it releases the closure; without this the timer holds
              // a reference to the whole render for its full duration, which on
              // a long-lived process is a slow leak rather than a one-off.
              clearTimeout(timeoutId);
              timeoutId = undefined;
              callback();
            },
          });
          const stream = createReadableStreamFromReadable(body);

          responseHeaders.set("Content-Type", "text/html");

          pipe(body);

          resolve(
            new Response(stream, {
              headers: responseHeaders,
              status: responseStatusCode,
            }),
          );
        },
        onShellError(error: unknown) {
          reject(error instanceof Error ? error : new Error(String(error)));
        },
        onError(error: unknown) {
          responseStatusCode = 500;
          // Streaming errors from inside the shell only; a shell error rejects
          // above and is logged by handleDocumentRequest.
          if (shellRendered) {
            console.error(error);
          }
        },
      },
    );
  });
}
