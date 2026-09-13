/**
 * A filesystem object store, for Hostinger.
 *
 * ── WHERE THE FILES GO, AND WHY IT IS NOT OBVIOUS ──────────────────────────
 *
 * Hostinger's Node deployment REPLACES the application directory on every
 * build. Their own documentation says so: "Manual file edits in the File
 * Manager won't persist; source files must be updated and redeployed." A
 * product photo written into the deployment directory is therefore not saved —
 * it is saved until the next `git push`, which is worse than not saving it,
 * because nothing reports an error and the loss is discovered by a customer
 * looking at a broken image.
 *
 * So the roots are configuration, they point OUTSIDE the deployment directory,
 * and the exact paths come from the capability probe rather than from a guess
 * about how Hostinger lays out a home directory. `PUBLIC_MEDIA_ROOT` and
 * `PRIVATE_MEDIA_ROOT` are required in production and the server refuses to
 * start without them — see server/config.ts. A default would be a path that
 * works in testing and silently discards the merchant's uploads in production.
 *
 * ── WHY THE PRIVATE ROOT IS A DIFFERENT TREE, NOT A SUBDIRECTORY ───────────
 *
 * Payment proofs are photographs of somebody's bank transfer. They must be
 * unreachable without a permission check on every read. Keeping them under the
 * public root — even in a subdirectory the web server is told to deny — makes
 * their protection depend on a rule in a configuration file that a future
 * change can relax. Two unrelated trees means one wrong `alias` directive
 * cannot expose them, and the probe in docs/hostinger/capability-audit.md (C-3)
 * verifies anonymously that it does not.
 */

import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { Readable } from "node:stream";
import {
  assertSafeObjectKey,
  type ListedObject,
  type ObjectMetadata,
  type ObjectStore,
  type PutOptions,
  type StoredObject,
} from "./object-store";

/**
 * Sidecar metadata.
 *
 * A filesystem stores bytes and a modification time; it does not store a
 * content type or a cache-control header, and the media route needs both to
 * answer a request the way R2 did. They go in a `.meta.json` beside the object
 * rather than in the database, so that a file and its type cannot disagree
 * after a partial restore.
 */
interface Sidecar {
  contentType: string;
  cacheControl?: string;
  size: number;
  /** SHA-256, hex. A real content hash, unlike an object-store etag. */
  sha256: string;
  uploadedAt: number;
}

const SIDECAR_SUFFIX = ".meta.json";

export class FilesystemObjectStore implements ObjectStore {
  private readonly root: string;

  constructor(root: string) {
    // Resolved once, at construction. Every path check below compares against
    // this, so a relative root cannot be reinterpreted later by a change of
    // working directory.
    this.root = path.resolve(root);
  }

  /**
   * Maps a key to a path, and refuses anything that escapes the root.
   *
   * Two independent checks, because they fail differently. `assertSafeObjectKey`
   * rejects the key SHAPE — `..`, control characters, absolute paths — before
   * any filesystem call. The containment check then re-derives the resolved
   * path and confirms it is still under the root, which catches anything the
   * shape rule did not anticipate, including a root that is itself a symlink
   * into somewhere unexpected.
   */
  private pathFor(key: string): string {
    assertSafeObjectKey(key);
    const resolved = path.resolve(this.root, key);
    if (resolved !== this.root && !resolved.startsWith(this.root + path.sep)) {
      throw new Error(`Object key escapes the storage root: ${key}`);
    }
    return resolved;
  }

  private sidecarFor(key: string): string {
    return this.pathFor(key) + SIDECAR_SUFFIX;
  }

  private async readSidecar(key: string): Promise<Sidecar | null> {
    try {
      return JSON.parse(await fsp.readFile(this.sidecarFor(key), "utf8")) as Sidecar;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
  }

  /**
   * Refuses to follow a symlink.
   *
   * A key never names a symlink in a store this application wrote. If one is
   * there, either the tree has been tampered with or a restore went wrong, and
   * in both cases serving whatever it points at is the wrong response.
   */
  private async statRegularFile(filePath: string): Promise<fs.Stats | null> {
    let stats: fs.Stats;
    try {
      stats = await fsp.lstat(filePath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
    if (stats.isSymbolicLink()) {
      throw new Error(`Refusing to read a symlink in the object store: ${filePath}`);
    }
    if (!stats.isFile()) return null;
    return stats;
  }

  async head(key: string): Promise<ObjectMetadata | null> {
    const filePath = this.pathFor(key);
    const stats = await this.statRegularFile(filePath);
    if (!stats) return null;
    const sidecar = await this.readSidecar(key);

    return {
      size: stats.size,
      // The SHA-256 when we have it. Quoted, because an ETag header is a quoted
      // string and an unquoted one is silently ignored by some caches.
      etag: sidecar
        ? `"${sidecar.sha256}"`
        : `"${stats.size}-${Number(stats.mtimeMs).toString(16)}"`,
      contentType: sidecar?.contentType ?? null,
      cacheControl: sidecar?.cacheControl ?? null,
      uploadedAt: sidecar?.uploadedAt ?? stats.mtimeMs,
    };
  }

  async get(key: string): Promise<StoredObject | null> {
    const filePath = this.pathFor(key);
    const metadata = await this.head(key);
    if (!metadata) return null;

    return {
      ...metadata,
      /*
       * Streamed, not buffered.
       *
       * The library is served through the application, and reading each image
       * fully into memory before writing it out would put the whole response
       * in the heap of a worker on a 2 GB plan. `Readable.toWeb` gives the
       * `ReadableStream` the Fetch `Response` constructor wants.
       */
      get body() {
        return Readable.toWeb(
          fs.createReadStream(filePath),
        ) as unknown as ReadableStream<Uint8Array>;
      },
      arrayBuffer: async () => {
        const buffer = await fsp.readFile(filePath);
        return buffer.buffer.slice(
          buffer.byteOffset,
          buffer.byteOffset + buffer.byteLength,
        ) as ArrayBuffer;
      },
    };
  }

  /**
   * Writes an object.
   *
   * Atomic: the bytes go to a temporary name in the same directory and are then
   * renamed into place. A `rename` within one filesystem is atomic, so a reader
   * sees either the old object or the new one and never a half-written file —
   * which matters because a truncated image is served with a 200 and looks like
   * a corrupt upload rather than a failed one.
   *
   * The sidecar is written FIRST and the object second, so a crash between them
   * leaves metadata with no object (a 404, correct) rather than an object with
   * no metadata (served with no content type, which the browser then sniffs).
   */
  async put(key: string, body: ArrayBuffer | Uint8Array, options: PutOptions): Promise<void> {
    const filePath = this.pathFor(key);
    await fsp.mkdir(path.dirname(filePath), { recursive: true });

    const bytes = body instanceof Uint8Array ? body : new Uint8Array(body);
    const sha256 = crypto.createHash("sha256").update(bytes).digest("hex");

    const sidecar: Sidecar = {
      contentType: options.contentType,
      ...(options.cacheControl === undefined ? {} : { cacheControl: options.cacheControl }),
      size: bytes.byteLength,
      sha256,
      uploadedAt: Date.now(),
    };

    await this.writeAtomic(this.sidecarFor(key), Buffer.from(JSON.stringify(sidecar), "utf8"));
    await this.writeAtomic(filePath, Buffer.from(bytes));
  }

  private async writeAtomic(target: string, contents: Buffer): Promise<void> {
    // Same directory, so the rename cannot cross a filesystem boundary and
    // degrade into a non-atomic copy.
    const temporary = `${target}.${crypto.randomBytes(6).toString("hex")}.tmp`;
    try {
      // 0o600: readable by the application's own user and nobody else. On
      // shared hosting the home directory is not private by default, and a
      // payment proof readable by another account on the same box is a
      // disclosure with no attacker required.
      await fsp.writeFile(temporary, contents, { mode: 0o600, flag: "wx" });
      await fsp.rename(temporary, target);
    } catch (error) {
      await fsp.rm(temporary, { force: true });
      throw error;
    }
  }

  async delete(key: string): Promise<void> {
    // `force` so deleting an object that is already gone succeeds. The admin
    // path deletes the row and the object together, and a retry after a partial
    // failure must not fail on the half that worked.
    await fsp.rm(this.pathFor(key), { force: true });
    await fsp.rm(this.sidecarFor(key), { force: true });
  }

  async *list(prefix = ""): AsyncIterable<ListedObject> {
    const start = prefix === "" ? this.root : this.pathFor(prefix);
    yield* this.walk(start);
  }

  private async *walk(directory: string): AsyncIterable<ListedObject> {
    let entries: fs.Dirent[];
    try {
      entries = await fsp.readdir(directory, { withFileTypes: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
      throw error;
    }

    for (const entry of entries) {
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        yield* this.walk(full);
        continue;
      }
      // Sidecars are metadata, not objects. A listing that included them would
      // double every count in the media reconciliation.
      if (!entry.isFile() || entry.name.endsWith(SIDECAR_SUFFIX)) continue;

      const stats = await fsp.stat(full);
      yield {
        key: path.relative(this.root, full).split(path.sep).join("/"),
        size: stats.size,
        uploadedAt: stats.mtimeMs,
      };
    }
  }

  /**
   * Confirms the root exists and is writable.
   *
   * Called at startup rather than on the first upload. A misconfigured
   * `PUBLIC_MEDIA_ROOT` should stop a deployment, not surface as a failed
   * upload the first time the merchant adds a product photo.
   */
  async verifyWritable(): Promise<void> {
    await fsp.mkdir(this.root, { recursive: true });
    const probe = path.join(this.root, `.write-probe-${crypto.randomBytes(6).toString("hex")}`);
    try {
      await fsp.writeFile(probe, "ok", { mode: 0o600 });
      await fsp.rm(probe, { force: true });
    } catch (error) {
      throw new Error(
        `Storage root is not writable: ${this.root}. ` +
          `On Hostinger this must be a path OUTSIDE the deployment directory — see docs/hostinger/media-persistence.md.`,
        { cause: error },
      );
    }
  }

  /** For the migration manifest: the real content hash, not an etag. */
  async sha256(key: string): Promise<string | null> {
    const sidecar = await this.readSidecar(key);
    if (sidecar) return sidecar.sha256;

    const filePath = this.pathFor(key);
    if (!(await this.statRegularFile(filePath))) return null;

    return new Promise((resolve, reject) => {
      const hash = crypto.createHash("sha256");
      const stream = fs.createReadStream(filePath);
      stream.on("data", (chunk) => hash.update(chunk));
      stream.on("error", reject);
      stream.on("end", () => resolve(hash.digest("hex")));
    });
  }
}
