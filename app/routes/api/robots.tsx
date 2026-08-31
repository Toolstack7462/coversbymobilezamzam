import type { Route } from "./+types/robots";
import { cloudflareContext } from "../../../workers/app";

/**
 * `/robots.txt`, written from the environment rather than shipped as a file.
 *
 * A static robots.txt in `public/` would be one file serving every environment,
 * and the only way to make the preview safe would be to make production wrong.
 * Generating it means the preview can disallow everything while production
 * still says something sensible, from one reviewable place.
 *
 * This is the SECOND layer. The Worker already sets `X-Robots-Tag: noindex` on
 * every preview response, which is the one that actually binds — robots.txt is
 * a request not to crawl, while the header is an instruction not to index, and
 * a page linked from elsewhere can be indexed without ever being crawled. Both
 * are here because they fail differently.
 */

export async function loader({ context }: Route.LoaderArgs) {
  const { env } = context.get(cloudflareContext);
  const isPublic = (env.APP_ENV ?? "development") === "production";

  const body = isPublic
    ? [
        "User-agent: *",
        "Allow: /",
        "",
        // Never indexable, in any environment: these carry an order number or a
        // tracking token in the path.
        "Disallow: /admin/",
        "Disallow: /api/",
        "Disallow: /ordine/",
        "Disallow: /traccia/",
        "Disallow: /cassa",
        "Disallow: /carrello",
        "",
        // No sitemap line until a real domain exists and the merchant has
        // decided to be indexed. Advertising one from a preview would be an
        // invitation to crawl exactly what must not be crawled.
      ].join("\n")
    : [
        "# Ambiente di prova — non indicizzare.",
        "# This is a preview deployment. It is not the shop.",
        "User-agent: *",
        "Disallow: /",
      ].join("\n");

  return new Response(`${body}\n`, {
    headers: {
      "content-type": "text/plain; charset=utf-8",
      // Short: a preview that later becomes indexable must not be held to this
      // by a year-old cached copy.
      "cache-control": "public, max-age=300",
    },
  });
}
