/**
 * The Node server.
 *
 * A real server-side application: the same React Router routes the Worker
 * serves, with the same loaders, actions, SSR and streaming, over Express
 * instead of workerd.
 *
 * ── THINGS THAT ARE EASY TO GET WRONG HERE, AND ARE NOT ─────────────────────
 *
 * ORDER OF MIDDLEWARE. Better Auth reads the raw request body. Any body parser
 * mounted before it consumes the stream first, and every sign-in arrives with
 * an empty body — a failure that looks like "wrong password". Nothing in this
 * file parses a body at all: React Router reads `request.formData()` from the
 * Fetch request it is handed, so there is no `express.json()` to misplace.
 *
 * EXPRESS 5 WILDCARDS. `app.get("*")` is a path-to-regexp v8 syntax error in
 * Express 5, not a deprecation — the server refuses to start. The catch-all
 * here is `app.use(handler)` with no path, which is version-independent.
 *
 * SET-COOKIE. A Fetch `Response` can carry several `Set-Cookie` headers, and
 * `Object.fromEntries(response.headers)` silently keeps one. Sign-in with 2FA
 * sets two, so a naive header copy logs the user in without their second-factor
 * state — a bug this project has already had once. `getSetCookie()` is used.
 *
 * TRUST PROXY. Set to exactly one hop, not `true`. `trust proxy: true` makes
 * Express believe the whole `X-Forwarded-For` chain, so a client can prepend
 * any address it likes and become that address for rate limiting and audit.
 *
 * HOST HEADER. Validated against the configured origin. Behind a proxy the Host
 * header is attacker-controlled, and the application builds absolute URLs from
 * it — including password-reset links.
 */

import { createRequestHandler } from "@react-router/express";
import { RouterContextProvider } from "react-router";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { drizzle } from "drizzle-orm/mysql2";
import compression from "compression";
import express from "express";
import type { Request, Response, NextFunction } from "express";
import fs from "node:fs";
import path from "node:path";
import type { Server } from "node:http";
import mysql from "mysql2/promise";

import { loadConfig, ConfigError, type ServerConfig } from "./config";
import { appContext, type AppEnv } from "~/runtime/context";
import { createMariaDb } from "~/infrastructure/db/mariadb";
import { FilesystemObjectStore } from "~/infrastructure/storage/filesystem";
import { setAuthDatabaseFactory } from "~/infrastructure/auth/database";
import { withQueryMetrics, summarise } from "~/infrastructure/db/query-metrics";
import { betterAuthMysqlSchema } from "@db/schema/auth.mysql";
import {
  CSP_DEVELOPMENT,
  CSP_PRODUCTION,
  LOCAL_ENVIRONMENTS,
  NON_INDEXABLE_ENVIRONMENTS,
  PERMISSIONS_POLICY,
  cacheControlFor,
} from "../workers/response-policy";

/**
 * The largest request body accepted.
 *
 * Product photographs are the only large upload, and the admin caps them well
 * below this. The limit exists so that an unbounded upload cannot exhaust the
 * memory of a worker on a 2 GB plan before any application code runs.
 */
const MAX_REQUEST_BYTES = 12 * 1024 * 1024;

/** How long to let in-flight requests finish when shutting down. */
const SHUTDOWN_GRACE_MS = 15_000;

async function main(): Promise<void> {
  let config: ServerConfig;
  try {
    config = loadConfig();
  } catch (error) {
    if (error instanceof ConfigError) {
      // The message names every missing value at once, rather than one per
      // restart. A deploy loop that reveals one problem at a time is how a
      // ten-minute configuration takes an afternoon.
      console.error(error.message);
      process.exit(1);
    }
    throw error;
  }

  const buildPath = path.resolve("build/server/index.js");
  if (!fs.existsSync(buildPath)) {
    console.error(
      `No server build at ${buildPath}. Run \`npm run build\` before starting.\n` +
        "This server never runs Vite: a development server in production serves unminified " +
        "source, disables the production CSP and has no request limits.",
    );
    process.exit(1);
  }

  // ── Storage ───────────────────────────────────────────────────────────────
  const media = new FilesystemObjectStore(config.storage.publicRoot);
  const privateFiles = new FilesystemObjectStore(config.storage.privateRoot);

  // Checked at startup, not on the first upload. A misconfigured root should
  // stop a deployment, not surface when the merchant adds a product photo.
  await media.verifyWritable();
  await privateFiles.verifyWritable();

  // ── Database ──────────────────────────────────────────────────────────────
  const db = createMariaDb({
    host: config.database.host,
    port: config.database.port,
    user: config.database.user,
    password: config.database.password,
    database: config.database.name,
    connectionLimit: config.database.connectionLimit,
    ...(config.database.ssl === undefined ? {} : { ssl: config.database.ssl }),
  });

  /*
   * Connectivity is proved at startup. NOT the schema, and NOT a migration.
   *
   * `npm start` must never mutate the schema: an automatic GitHub build that
   * runs migrations turns every push into a schema change nobody reviewed, and
   * two workers starting at once would run it twice. Migrations are a separate,
   * approved step — see docs/hostinger/hpanel-deployment.md.
   */
  await db.ping();

  /*
   * Better Auth's own pool, separate from the application's.
   *
   * Drizzle's mysql2 driver wants the driver's pool object rather than the
   * `SqlDatabase` port, and the port deliberately does not expose one — leaking
   * it would let any caller bypass the translator. Two small pools against the
   * same connection cap is the honest cost of that boundary; both are counted
   * in DB_CONNECTION_LIMIT's budget and both are closed on shutdown.
   */
  const authPool = mysql.createPool({
    host: config.database.host,
    port: config.database.port,
    user: config.database.user,
    password: config.database.password,
    database: config.database.name,
    connectionLimit: 2,
    waitForConnections: true,
    ...(config.database.ssl === undefined ? {} : { ssl: config.database.ssl }),
  });

  const authDrizzle = drizzle(authPool, {
    schema: betterAuthMysqlSchema,
    mode: "default",
  });

  setAuthDatabaseFactory(() =>
    drizzleAdapter(authDrizzle, {
      provider: "mysql",
      // Better Auth sees its own five tables and nothing else, so it cannot
      // reach orders or inventory whichever database is underneath.
      schema: betterAuthMysqlSchema,
    }),
  );

  const env: AppEnv = {
    DB: db,
    MEDIA: media,
    PRIVATE_FILES: privateFiles,
    APP_ENV: config.appEnv,
    APP_BASE_URL: config.appBaseUrl,
    DEFAULT_LOCALE: process.env.DEFAULT_LOCALE ?? "it",
    SUPPORTED_LOCALES: process.env.SUPPORTED_LOCALES ?? "it,en",
    DEFAULT_CURRENCY: process.env.DEFAULT_CURRENCY ?? "EUR",
    STORE_TIMEZONE: process.env.STORE_TIMEZONE ?? "Europe/Rome",
    BETTER_AUTH_SECRET: config.secrets.betterAuthSecret,
    SETTINGS_ENCRYPTION_KEY: config.secrets.settingsEncryptionKey,
    ...optionalEntries({
      INITIAL_ADMIN_SETUP_TOKEN: config.secrets.initialAdminSetupToken,
      JOB_AUTH_SECRET: config.secrets.jobAuthSecret,
      TOTP_ISSUER: config.optional.totpIssuer,
      TURNSTILE_SITE_KEY: config.optional.turnstileSiteKey,
      TURNSTILE_SECRET_KEY: config.optional.turnstileSecretKey,
      RESEND_API_KEY: config.optional.resendApiKey,
      EMAIL_FROM: config.optional.emailFrom,
      PUBLIC_MEDIA_BASE_URL: config.optional.publicMediaBaseUrl,
      SMTP_HOST: config.optional.smtpHost,
      SMTP_PORT: config.optional.smtpPort,
      SMTP_USER: config.optional.smtpUser,
      SMTP_PASSWORD: config.optional.smtpPassword,
    }),
  };

  // ── Background work ───────────────────────────────────────────────────────
  //
  // `waitUntil` on Workers keeps the isolate alive. Here it registers the
  // promise so shutdown DRAINS it instead of killing it — the difference
  // between an audit-log entry being written and being lost on every deploy.
  const inFlight = new Set<Promise<unknown>>();
  const waitUntil = (promise: Promise<unknown>) => {
    inFlight.add(promise);
    promise
      .catch((error) => console.error("[background]", error))
      .finally(() => inFlight.delete(promise));
  };

  // ── Express ───────────────────────────────────────────────────────────────
  const app = express();

  // Exactly one hop: Hostinger's reverse proxy. `true` would trust the whole
  // forwarded chain, letting a client claim any address for rate limiting.
  app.set("trust proxy", 1);
  app.disable("x-powered-by");

  app.use(hostGuard(config));
  app.use(requestSizeLimit(MAX_REQUEST_BYTES));
  app.use(compression());

  /*
   * Static assets, before the application.
   *
   * On Cloudflare these never reach the Worker at all and are covered by
   * public/_headers. Nothing here reads that file — it is Cloudflare syntax —
   * so the same policy is applied by this handler instead. Neither covers the
   * other, and both are needed.
   */
  app.use(
    "/assets",
    express.static("build/client/assets", {
      // Every filename contains a hash of its own content, so the file at a
      // given URL cannot change.
      immutable: true,
      maxAge: "1y",
      setHeaders: (res) => {
        res.setHeader("x-content-type-options", "nosniff");
        if (NON_INDEXABLE_ENVIRONMENTS.has(config.appEnv)) {
          res.setHeader("x-robots-tag", "noindex, nofollow, noarchive, nosnippet");
        }
      },
    }),
  );

  app.use(
    express.static("build/client", {
      // NOT immutable: everything else here is at a stable URL and can change.
      maxAge: "1h",
      index: false,
      setHeaders: (res) => {
        res.setHeader("x-content-type-options", "nosniff");
        if (NON_INDEXABLE_ENVIRONMENTS.has(config.appEnv)) {
          res.setHeader("x-robots-tag", "noindex, nofollow, noarchive, nosnippet");
        }
      },
    }),
  );

  const build = await import(/* @vite-ignore */ pathToUrl(buildPath));

  /*
   * Request instrumentation.
   *
   * OFF in production, because AsyncLocalStorage has a real cost on a hot path
   * and this exists to answer questions during a migration, not to run under
   * load forever. On staging every response carries the query count and the
   * time spent in the database, so "this route is efficient" is a number a
   * reviewer can read off a response header rather than a claim.
   *
   * `Server-Timing` because browsers show it in the network panel without any
   * tooling; `x-query-count` because a load-test script should not have to
   * parse it.
   */
  if (config.appEnv !== "production") {
    app.use((req, res, next) => {
      void withQueryMetrics(async () => {
        await new Promise<void>((resolve) => {
          res.on("finish", resolve);
          res.on("close", resolve);
          next();
        });
      }).then(({ metrics }) => {
        const summary = summarise(metrics);
        // Logged rather than only sent: a streamed response has already
        // committed its headers by the time the queries have finished.
        if (summary.total > 0) {
          const worst = summary.repeated[0];
          console.log(
            `[queries] ${req.method} ${req.path} ${summary.total} queries, ${summary.totalMs}ms` +
              (worst && worst.count >= 5 ? `  REPEATED x${worst.count}: ${worst.shape}` : ""),
          );
        }
      });
    });
  }

  app.use(
    responsePolicy(config),
    createRequestHandler({
      build,
      mode: config.nodeEnv,
      getLoadContext(): RouterContextProvider {
        const context = new RouterContextProvider();
        context.set(appContext, { env, waitUntil, platform: "node" });
        return context;
      },
    }),
  );

  // ── Listen ────────────────────────────────────────────────────────────────
  const server = app.listen(config.port, config.host, () => {
    console.log(
      `[server] ${config.appEnv} listening on ${config.host}:${config.port}, serving ${config.appBaseUrl}`,
    );
  });

  // Slightly above a typical proxy's 60s idle timeout, so the proxy closes an
  // idle connection rather than the application closing one mid-response.
  server.keepAliveTimeout = 65_000;
  server.headersTimeout = 70_000;

  installShutdown({ server, db, authPool, inFlight });
}

/**
 * Rejects a request whose Host header is not one this deployment answers to.
 *
 * Behind a reverse proxy, Host is whatever the client sent. The application
 * builds absolute URLs from the configured origin rather than from Host, so
 * this is defence in depth — but cache poisoning and password-reset-link
 * redirection both start here, and the check costs one string comparison.
 */
function hostGuard(config: ServerConfig) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const host = req.headers.host;
    if (host !== undefined && config.trustedHosts.includes(host)) return next();

    // Health checks arrive from the platform with whatever Host it uses, and a
    // readiness probe that fails on the host check reports the application as
    // down when it is fine.
    if (req.path === "/api/health") return next();

    res.status(421).type("text/plain").send("Misdirected request");
  };
}

/**
 * Refuses an over-large body before any of it is read.
 *
 * `Content-Length` can lie, so the byte counter below is the real limit; the
 * header check is what lets an honest client fail fast with a useful status.
 */
function requestSizeLimit(maxBytes: number) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const declared = Number(req.headers["content-length"] ?? 0);
    if (Number.isFinite(declared) && declared > maxBytes) {
      res.status(413).type("text/plain").send("Payload too large");
      return;
    }

    let received = 0;
    req.on("data", (chunk: Buffer) => {
      received += chunk.length;
      if (received > maxBytes) {
        res.status(413).type("text/plain").end("Payload too large");
        req.destroy();
      }
    });
    next();
  };
}

/**
 * The response policy, ported from the Worker.
 *
 * Identical rules, applied by different machinery: on Workers the handler wraps
 * the Response it produced, here the headers are set before the body is written
 * because Express streams. `res.writeHead` is where they must be in place, so
 * the work happens in an `on("headers")`-equivalent — overriding `writeHead`
 * itself, which is the only hook Express gives that fires for every response
 * including ones React Router streams.
 */
function responsePolicy(config: ServerConfig) {
  const csp = LOCAL_ENVIRONMENTS.has(config.appEnv) ? CSP_DEVELOPMENT : CSP_PRODUCTION;
  const isHttps = config.appBaseUrl.startsWith("https://");

  return (req: Request, res: Response, next: NextFunction): void => {
    const originalWriteHead = res.writeHead.bind(res);

    res.writeHead = function patched(...args: Parameters<Response["writeHead"]>) {
      if (!res.headersSent) {
        res.setHeader("content-security-policy", csp);
        res.setHeader("x-frame-options", "DENY");
        res.setHeader("x-content-type-options", "nosniff");
        res.setHeader("referrer-policy", "strict-origin-when-cross-origin");
        res.setHeader("permissions-policy", PERMISSIONS_POLICY);
        res.setHeader("cross-origin-opener-policy", "same-origin");

        /*
         * A bare `text/html` leaves the encoding to the client's guess. This
         * shop is Italian: every other product name has an accent in it, and a
         * client that guesses Latin-1 renders `città` as mojibake.
         */
        const contentType = res.getHeader("content-type");
        if (
          typeof contentType === "string" &&
          /^text\//i.test(contentType) &&
          !/charset=/i.test(contentType)
        ) {
          res.setHeader("content-type", `${contentType}; charset=utf-8`);
        }

        if (isHttps) {
          // No `preload`. Preloading is submitted to a browser-maintained list
          // and is slow and awkward to undo.
          res.setHeader("strict-transport-security", "max-age=31536000; includeSubDomains");
        }

        // Only when the route has not already decided. `/api/health` sets
        // `no-store` for its own reasons and knows better than a path prefix.
        if (!res.hasHeader("cache-control")) {
          res.setHeader("cache-control", cacheControlFor(req.path));
        }

        if (NON_INDEXABLE_ENVIRONMENTS.has(config.appEnv)) {
          res.setHeader("x-robots-tag", "noindex, nofollow, noarchive, nosnippet");
        }
      }
      return originalWriteHead(...args);
    } as Response["writeHead"];

    next();
  };
}

/**
 * Graceful shutdown.
 *
 * A redeploy sends SIGTERM. Without this the process dies mid-request, mid-
 * transaction and mid-background-write, and on a plan where connections are
 * capped it leaves them open on the server until they time out — a few
 * redeploys in a row then exhaust the cap.
 */
function installShutdown(resources: {
  server: Server;
  db: { close(): Promise<void> };
  authPool: { end(): Promise<void> };
  inFlight: Set<Promise<unknown>>;
}): void {
  let shuttingDown = false;

  const shutdown = (signal: string) => {
    void (async () => {
      if (shuttingDown) return;
      shuttingDown = true;
      console.log(`[server] ${signal} received, draining`);

      const deadline = setTimeout(() => {
        console.error("[server] drain did not finish in time, exiting anyway");
        process.exit(1);
      }, SHUTDOWN_GRACE_MS);
      // Do not let the timer itself keep the process alive once draining is done.
      deadline.unref();

      await new Promise<void>((resolve) => resources.server.close(() => resolve()));
      await Promise.allSettled([...resources.inFlight]);
      await Promise.allSettled([resources.db.close(), resources.authPool.end()]);

      clearTimeout(deadline);
      console.log("[server] drained");
      process.exit(0);
    })();
  };

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));

  /*
   * A rejected promise nobody handled used to be a warning and is now fatal by
   * default in Node. Logging it and continuing would leave the process in an
   * unknown state; exiting lets the platform restart it. Either way the reason
   * has to reach the log, because an unexplained restart is unfixable.
   */
  process.on("unhandledRejection", (reason) => {
    console.error("[server] unhandled rejection", reason);
    shutdown("unhandledRejection");
  });
}

/** Only the keys that have a value: `exactOptionalPropertyTypes` distinguishes them. */
function optionalEntries<T extends Record<string, string | undefined>>(
  values: T,
): Partial<Record<keyof T, string>> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(values)) {
    if (value !== undefined) out[key] = value;
  }
  return out as Partial<Record<keyof T, string>>;
}

function pathToUrl(filePath: string): string {
  return new URL(`file://${filePath.replace(/\\/g, "/")}`).href;
}

void main();
