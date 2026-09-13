/**
 * The runtime context, and the only thing a loader or action needs to know
 * about where it is running.
 *
 * ── WHY THIS MOVED OUT OF workers/app.ts ────────────────────────────────────
 *
 * Every route used to import its context from the WORKER ENTRY POINT, three
 * directories up. Building those same routes for Node therefore pulled in
 * `ExportedHandler`, the Cloudflare `Env` and the cron handler, none of which
 * exist there. The import was the coupling; the bindings were incidental.
 *
 * Now both entry points construct an `AppRuntime` and set it here. Neither the
 * routes nor the domain layer can tell which one did.
 *
 * ── WHAT IS DELIBERATELY NOT IN HERE ────────────────────────────────────────
 *
 * No `ExecutionContext`, no `R2Bucket`, no `D1Database`. Those are Cloudflare
 * types, and a context that names them is a context that only Cloudflare can
 * satisfy. `waitUntil` survives as a plain function because the CAPABILITY is
 * real on both runtimes — it is just implemented differently, and on Node the
 * difference matters (see server/index.ts, where in-flight background work is
 * drained on shutdown rather than abandoned).
 */

import { createContext } from "react-router";
import type { SqlDatabase } from "~/infrastructure/db/sql";
import type { ObjectStore } from "~/infrastructure/storage/object-store";

/**
 * Everything the application reads from its environment.
 *
 * Kept structurally compatible with the generated Cloudflare `Env` so that the
 * 469 existing `env.DB` call sites and the handful of `env.APP_ENV` reads work
 * unchanged. The two that are NOT compatible are deliberate: `DB` is a
 * `SqlDatabase` rather than a `D1Database`, and `MEDIA`/`PRIVATE_FILES` are
 * `ObjectStore`s rather than `R2Bucket`s. Both are the point of the exercise.
 */
export interface AppEnv {
  DB: SqlDatabase;
  MEDIA: ObjectStore;
  PRIVATE_FILES: ObjectStore;

  // ── Non-secret configuration ──────────────────────────────────────────────
  APP_ENV: string;
  APP_BASE_URL: string;
  DEFAULT_LOCALE: string;
  SUPPORTED_LOCALES: string;
  DEFAULT_CURRENCY: string;
  STORE_TIMEZONE: string;

  // ── Secrets ───────────────────────────────────────────────────────────────
  BETTER_AUTH_SECRET: string;
  SETTINGS_ENCRYPTION_KEY: string;

  /**
   * Optional, and each absence turns a feature off rather than degrading it.
   *
   * `INITIAL_ADMIN_SETUP_TOKEN` is the one where absence must NOT mean "no
   * token required" — the setup route refuses to run without it, because a
   * bootstrap endpoint that defaults open is a back door.
   */
  INITIAL_ADMIN_SETUP_TOKEN?: string | undefined;
  TOTP_ISSUER?: string | undefined;
  TURNSTILE_SITE_KEY?: string | undefined;
  TURNSTILE_SECRET_KEY?: string | undefined;
  RESEND_API_KEY?: string | undefined;
  EMAIL_FROM?: string | undefined;
  PUBLIC_MEDIA_BASE_URL?: string | undefined;

  // ── Hostinger only ────────────────────────────────────────────────────────
  /** Shared secret the scheduled-job launcher authenticates with. */
  JOB_AUTH_SECRET?: string | undefined;
  SMTP_HOST?: string | undefined;
  SMTP_PORT?: string | undefined;
  SMTP_USER?: string | undefined;
  SMTP_PASSWORD?: string | undefined;
}

export interface AppRuntime {
  env: AppEnv;
  /**
   * Work that must finish but that the response does not wait for.
   *
   * On Workers this is `ExecutionContext.waitUntil`, which keeps the isolate
   * alive. On Node it registers the promise with the shutdown handler, so a
   * redeploy drains it instead of killing it mid-write — the difference between
   * an audit-log entry being written and being lost on every deploy.
   */
  waitUntil(promise: Promise<unknown>): void;
  /** Which runtime is actually serving. For diagnostics and the health check. */
  platform: "cloudflare" | "node";
}

/**
 * ONE context object, however many times this module is loaded.
 *
 * `createContext()` mints a fresh key each time it runs, and on the Node
 * deployment this module is loaded TWICE: once inside the React Router server
 * build (which the routes import from) and once inside the compiled Express
 * entry (which sets the value). Two module instances meant two keys, so the
 * server set one and every loader read the other — "No value found for
 * context", on every route, with a correct-looking 500.
 *
 * Cloudflare never hit this: one bundle, one instance. It only appears once
 * there are two entry points, which is exactly what this migration adds.
 *
 * A `Symbol.for` key is the fix rather than a build-config change, because the
 * two bundles are produced by different tools for different runtimes and any
 * arrangement that keeps them sharing a module is one refactor from breaking
 * again — silently, and in the same way.
 */
const CONTEXT_KEY = Symbol.for("covers-by-mobile.app-context");

type ContextHolder = typeof globalThis & {
  [CONTEXT_KEY]?: ReturnType<typeof createContext<AppRuntime>>;
};

const holder = globalThis as ContextHolder;

export const appContext: ReturnType<typeof createContext<AppRuntime>> =
  holder[CONTEXT_KEY] ?? (holder[CONTEXT_KEY] = createContext<AppRuntime>());
