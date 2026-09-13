/**
 * The R2 adapter.
 *
 * Kept, not deleted. Until cutover is approved the Cloudflare deployment has to
 * keep working exactly as it does today, and the way to guarantee that is for
 * the Worker to run the same application code through this adapter rather than
 * a divergent branch of it.
 *
 * After cutover this file is one of the two that get removed (the other is
 * app/infrastructure/db/d1.ts), and nothing else has to change — which is the
 * test of whether the port was drawn in the right place.
 */

import type {
  ListedObject,
  ObjectMetadata,
  ObjectStore,
  PutOptions,
  StoredObject,
} from "./object-store";
import { assertSafeObjectKey } from "./object-store";

export class R2ObjectStore implements ObjectStore {
  private readonly bucket: R2Bucket;

  constructor(bucket: R2Bucket) {
    this.bucket = bucket;
  }

  async head(key: string): Promise<ObjectMetadata | null> {
    assertSafeObjectKey(key);
    const object = await this.bucket.head(key);
    return object ? toMetadata(object) : null;
  }

  async get(key: string): Promise<StoredObject | null> {
    assertSafeObjectKey(key);
    const object = await this.bucket.get(key);
    if (object === null) return null;

    return {
      ...toMetadata(object),
      body: object.body,
      arrayBuffer: () => object.arrayBuffer(),
    };
  }

  async put(key: string, body: ArrayBuffer | Uint8Array, options: PutOptions): Promise<void> {
    assertSafeObjectKey(key);
    await this.bucket.put(key, body, {
      httpMetadata: {
        contentType: options.contentType,
        ...(options.cacheControl === undefined ? {} : { cacheControl: options.cacheControl }),
      },
    });
  }

  async delete(key: string): Promise<void> {
    assertSafeObjectKey(key);
    await this.bucket.delete(key);
  }

  async *list(prefix = ""): AsyncIterable<ListedObject> {
    let cursor: string | undefined;
    do {
      const page = await this.bucket.list({
        prefix,
        limit: 500,
        ...(cursor === undefined ? {} : { cursor }),
      });
      for (const object of page.objects) {
        yield {
          key: object.key,
          size: object.size,
          uploadedAt: object.uploaded.getTime(),
        };
      }
      cursor = page.truncated ? page.cursor : undefined;
    } while (cursor !== undefined);
  }
}

function toMetadata(object: R2Object): ObjectMetadata {
  return {
    size: object.size,
    /*
     * `httpEtag` is R2's quoted etag, which is what the conditional-request
     * comparison needs.
     *
     * It is NOT treated as a content hash anywhere. R2 returns the MD5 of the
     * body for a single-part upload and a composite value for a multipart one,
     * so the media migration computes its own SHA-256 over the bytes rather
     * than comparing etags between the two stores.
     */
    etag: object.httpEtag,
    contentType: object.httpMetadata?.contentType ?? null,
    cacheControl: object.httpMetadata?.cacheControl ?? null,
    uploadedAt: object.uploaded.getTime(),
  };
}
