import type { Route } from "./+types/health";
import { cloudflareContext } from "../../../workers/app";

/**
 * `/api/health` — what is deployed, and does it work.
 *
 * The question this exists to answer is narrow and specific: **is the running
 * Worker the commit I pushed?** Without it, that is settled by comparing
 * timestamps and hoping, and a deploy that silently shipped stale code looks
 * exactly like one that worked.
 *
 * ── What it deliberately does NOT return ─────────────────────────────────────
 *
 * No secret values, no secret NAMES beyond those already public in
 * `wrangler.jsonc`, no account identifiers, no row contents, no user records,
 * no stack traces, no bucket credentials. A health endpoint is an unauthenticated
 * URL: everything on it is public, so the test for each field is "would I be
 * content to see this on a billboard".
 *
 * Connectivity is reported as a boolean and a duration, never as data. `SELECT
 * 1` proves the binding works without reading anything a customer owns.
 *
 * ── Why it is unauthenticated ────────────────────────────────────────────────
 *
 * Because the thing most likely to be broken is authentication, and a health
 * check that needs a working login cannot tell you the login is broken.
 */

export async function loader({ context }: Route.LoaderArgs) {
  const { env } = context.get(cloudflareContext);
  const startedAt = Date.now();

  // ── D1 ────────────────────────────────────────────────────────────────────
  let database: { ok: boolean; ms: number; migration: string | null; error?: string };
  try {
    const t0 = Date.now();
    // The furthest-applied migration. `d1_migrations` is Wrangler's own table;
    // reading its last name is how the deployment says which schema it expects,
    // without exposing anything about the data in it.
    const row = await env.DB.prepare(
      `SELECT name FROM d1_migrations ORDER BY id DESC LIMIT 1`,
    ).first<{ name: string }>();
    database = { ok: true, ms: Date.now() - t0, migration: row?.name ?? null };
  } catch (error) {
    // The message, not the stack. "no such table" is useful; a stack trace is a
    // map of the source tree.
    database = {
      ok: false,
      ms: Date.now() - startedAt,
      migration: null,
      error: error instanceof Error ? error.message.slice(0, 120) : "unknown",
    };
  }

  // ── R2 ────────────────────────────────────────────────────────────────────
  //
  // `head` on a key that is not expected to exist. It proves the binding is
  // wired and the bucket answers, and it reads no object and lists no keys —
  // listing a media bucket would hand out the whole catalogue's filenames, and
  // listing the proofs bucket would be considerably worse.
  const probeBucket = async (bucket: R2Bucket): Promise<{ ok: boolean; ms: number }> => {
    const t0 = Date.now();
    try {
      await bucket.head("__health_probe__");
      return { ok: true, ms: Date.now() - t0 };
    } catch {
      return { ok: false, ms: Date.now() - t0 };
    }
  };

  const [media, privateFiles] = await Promise.all([
    probeBucket(env.MEDIA),
    probeBucket(env.PRIVATE_FILES),
  ]);

  const healthy = database.ok && media.ok && privateFiles.ok;

  return Response.json(
    {
      status: healthy ? "ok" : "degraded",
      environment: env.APP_ENV ?? "unknown",

      build: {
        // The whole reason this endpoint exists.
        commit: __GIT_SHA__,
        // True means the bundle was built from a working tree with
        // uncommitted changes, so the commit above does not fully describe it.
        // For a preview that is a warning, not an error.
        dirty: __GIT_DIRTY__,
        builtAt: __BUILD_TIME__,
      },

      checks: {
        database,
        // Named for their bindings, which are already public configuration.
        mediaBucket: media,
        privateBucket: privateFiles,
      },

      // Non-secret configuration, stated so a smoke test can assert on it
      // rather than trusting that a deploy used the environment it meant to.
      config: {
        locale: env.DEFAULT_LOCALE ?? null,
        currency: env.DEFAULT_CURRENCY ?? null,
        timezone: env.STORE_TIMEZONE ?? null,
        // Whether the setup route can still run. A boolean, never the token.
        initialSetupTokenConfigured: Boolean(env.INITIAL_ADMIN_SETUP_TOKEN),
        // Whether optional integrations are on. Absent secret means feature off.
        emailConfigured: Boolean(env.RESEND_API_KEY),
        turnstileConfigured: Boolean(env.TURNSTILE_SITE_KEY),
      },

      totalMs: Date.now() - startedAt,
    },
    {
      status: healthy ? 200 : 503,
      headers: {
        // Never cached: a cached health check reports the state of a Worker
        // that may no longer be deployed.
        "cache-control": "no-store, max-age=0",
        "x-robots-tag": "noindex, nofollow",
      },
    },
  );
}
