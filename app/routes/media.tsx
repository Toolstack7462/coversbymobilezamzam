import type { Route } from "./+types/media";
import { appContext } from "~/runtime/context";

/**
 * Serves product images from the public object store.
 *
 * Only used when `PUBLIC_MEDIA_BASE_URL` is unset. With a CDN or a public
 * bucket domain configured, the storefront links straight there and this route
 * is never hit — which is the better arrangement, because a Worker invocation
 * per image is a cost with no benefit.
 *
 * It exists anyway because the alternative is a shop that cannot show a photo
 * until someone has configured a CDN, and "images do not work yet" is not an
 * acceptable state for an accessories shop.
 *
 * Three things this deliberately does NOT do:
 *
 *   - **No resizing or transformation.** That belongs in Cloudflare Images or
 *     a build step, not in a request path with a CPU budget.
 *   - **No listing.** A key is required. An enumerable media bucket is an
 *     invitation to scrape the whole catalogue.
 *   - **No access to PRIVATE_FILES.** Payment proofs live in that store and
 *     must never be reachable by URL. This route is bound to MEDIA alone, so
 *     the separation is structural rather than a check that could be edited
 *     away.
 */

export async function loader({ params, request, context }: Route.LoaderArgs) {
  const { env } = context.get(appContext);

  const key = params["*"];
  if (!key || key.includes("..")) {
    // `..` cannot escape an R2 keyspace — it is a flat namespace, not a
    // filesystem — but a key containing it is never one this app wrote, so
    // refusing costs nothing and removes the question.
    return new Response("Not found", { status: 404 });
  }

  const object = await env.MEDIA.get(key);
  if (object === null) return new Response("Not found", { status: 404 });

  const headers = new Headers();
  /*
   * Set explicitly rather than through R2's `writeHttpMetadata`.
   *
   * That helper belongs to the R2 object and copies whatever metadata the
   * bucket happens to hold, which is convenient on Cloudflare and unavailable
   * on a filesystem. Naming the two headers this route actually needs is also
   * the safer version: it cannot copy across a `content-disposition` or a
   * `content-encoding` that somebody set on an object years ago.
   */
  if (object.contentType) headers.set("content-type", object.contentType);
  headers.set("etag", object.etag);

  // Keys contain a content hash, so an object at a given key never changes.
  // That makes an immutable year-long cache correct rather than optimistic: a
  // changed image gets a new key and a new URL.
  headers.set("cache-control", "public, max-age=31536000, immutable");

  // The bucket holds merchant-uploaded files. Even though only images pass
  // validation on the way in, telling the browser never to re-interpret the
  // type means a file that somehow got in some other way cannot execute.
  headers.set("x-content-type-options", "nosniff");
  headers.set("content-security-policy", "default-src 'none'; sandbox");

  // A conditional request from a browser that already holds the object.
  const ifNoneMatch = request.headers.get("if-none-match");
  if (ifNoneMatch === object.etag) {
    return new Response(null, { status: 304, headers });
  }

  return new Response(object.body, { headers });
}
