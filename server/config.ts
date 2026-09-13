/**
 * Reading and validating the Node server's environment.
 *
 * ── WHY THIS FAILS LOUDLY RATHER THAN DEFAULTING ────────────────────────────
 *
 * Every value here is something the application cannot work without, and every
 * plausible default is worse than a crash:
 *
 *   APP_BASE_URL absent      -> Better Auth rejects every sign-in with an
 *                               origin error that never reproduces locally
 *   PUBLIC_MEDIA_ROOT absent -> uploads land in the deployment directory and
 *                               are destroyed by the next `git push`
 *   DB_* absent              -> the shop serves an error page, but only after
 *                               the deploy has already replaced the last one
 *
 * A server that starts with a bad configuration and fails later fails on a
 * customer's request. A server that refuses to start fails on the deploy, where
 * somebody is watching.
 */

import fs from "node:fs";

export interface ServerConfig {
  nodeEnv: "production" | "development" | "test";
  appEnv: string;
  appBaseUrl: string;

  /**
   * Where to listen.
   *
   * Hostinger assigns the port; the application does not choose it. Reading
   * `PORT` and falling back to 3000 for local use is the contract every managed
   * Node host uses, and it is the ONE default here that is safe — being wrong
   * about it means the process is unreachable, which is immediately obvious.
   */
  port: number;
  host: string;

  database: {
    host: string;
    port: number;
    user: string;
    password: string;
    name: string;
    ssl: { rejectUnauthorized: boolean; ca?: string } | undefined;
    connectionLimit: number;
  };

  storage: {
    publicRoot: string;
    privateRoot: string;
  };

  secrets: {
    betterAuthSecret: string;
    settingsEncryptionKey: string;
    initialAdminSetupToken: string | undefined;
    jobAuthSecret: string | undefined;
  };

  optional: {
    totpIssuer: string | undefined;
    turnstileSiteKey: string | undefined;
    turnstileSecretKey: string | undefined;
    resendApiKey: string | undefined;
    emailFrom: string | undefined;
    publicMediaBaseUrl: string | undefined;
    smtpHost: string | undefined;
    smtpPort: string | undefined;
    smtpUser: string | undefined;
    smtpPassword: string | undefined;
  };

  /**
   * Hosts this deployment will answer to.
   *
   * Derived from APP_BASE_URL, plus anything in TRUSTED_HOSTS. A request whose
   * Host header names something else is rejected: behind a reverse proxy the
   * Host header is attacker-controlled, and the application builds absolute
   * URLs — password-reset links among them — from it.
   */
  trustedHosts: string[];
}

class ConfigError extends Error {
  readonly problems: string[];

  constructor(problems: string[]) {
    super(
      `The server cannot start. ${problems.length} configuration problem${problems.length === 1 ? "" : "s"}:\n\n` +
        problems.map((p) => `  - ${p}`).join("\n") +
        "\n\nSee docs/hostinger/environment-reference.md for what each value is and where it comes from.\n",
    );
    this.name = "ConfigError";
    this.problems = problems;
  }
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  const problems: string[] = [];

  const required = (name: string): string => {
    const value = env[name];
    if (value === undefined || value.trim() === "") {
      problems.push(`${name} is not set`);
      return "";
    }
    return value.trim();
  };

  const optional = (name: string): string | undefined => {
    const value = env[name];
    return value === undefined || value.trim() === "" ? undefined : value.trim();
  };

  const nodeEnv = (optional("NODE_ENV") ?? "production") as ServerConfig["nodeEnv"];
  const appEnv = optional("APP_ENV") ?? nodeEnv;

  const appBaseUrl = required("APP_BASE_URL").replace(/\/+$/, "");
  if (appBaseUrl !== "" && !/^https?:\/\/[^/]+$/.test(appBaseUrl)) {
    problems.push(
      `APP_BASE_URL must be a bare origin with no path and no trailing slash, e.g. https://shop.example.it — got ${JSON.stringify(appBaseUrl)}`,
    );
  }
  /*
   * A production deployment served over plain HTTP would set `Secure` cookies
   * the browser then refuses to store, so every sign-in appears to succeed and
   * no session survives the redirect. Caught here rather than in support.
   */
  if (nodeEnv === "production" && appBaseUrl.startsWith("http://")) {
    problems.push(
      "APP_BASE_URL is http:// in production; session cookies are Secure and will not be stored",
    );
  }

  const publicRoot = required("PUBLIC_MEDIA_ROOT");
  const privateRoot = required("PRIVATE_MEDIA_ROOT");

  /*
   * The private tree must not be inside the public one.
   *
   * Not a style preference. The public root is what a future static-file
   * mapping would be pointed at, and a payment proof one directory below it is
   * then one configuration line away from being downloadable by anyone with the
   * URL.
   */
  if (publicRoot !== "" && privateRoot !== "" && isInside(privateRoot, publicRoot)) {
    problems.push(
      `PRIVATE_MEDIA_ROOT (${privateRoot}) is inside PUBLIC_MEDIA_ROOT (${publicRoot}). ` +
        "Payment proofs must live in an unrelated tree — see docs/hostinger/media-persistence.md",
    );
  }

  const betterAuthSecret = required("BETTER_AUTH_SECRET");
  if (betterAuthSecret !== "" && betterAuthSecret.length < 32) {
    problems.push("BETTER_AUTH_SECRET is shorter than 32 characters");
  }
  const settingsEncryptionKey = required("SETTINGS_ENCRYPTION_KEY");

  const dbPort = Number(optional("DB_PORT") ?? 3306);
  if (!Number.isInteger(dbPort) || dbPort < 1 || dbPort > 65535) {
    problems.push(`DB_PORT is not a valid port: ${env.DB_PORT}`);
  }

  const port = Number(optional("PORT") ?? 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    problems.push(`PORT is not a valid port: ${env.PORT}`);
  }

  const connectionLimit = Number(optional("DB_CONNECTION_LIMIT") ?? 8);
  if (!Number.isInteger(connectionLimit) || connectionLimit < 1 || connectionLimit > 50) {
    problems.push(
      `DB_CONNECTION_LIMIT must be between 1 and 50; shared hosting caps connections per database user ` +
        `(50 on Web Premium, 100 on Cloud Startup) and several workers share that cap`,
    );
  }

  const caPath = optional("DB_SSL_CA_PATH");
  let ca: string | undefined;
  if (caPath !== undefined) {
    try {
      ca = fs.readFileSync(caPath, "utf8");
    } catch {
      problems.push(`DB_SSL_CA_PATH points at a file that cannot be read: ${caPath}`);
    }
  }

  /*
   * TLS to the database is opt-IN and explicit.
   *
   * Not defaulted on, because whether Hostinger's MariaDB requires or even
   * accepts TLS is a per-plan fact that the capability probe answers (C-2), and
   * a client that insists on TLS against a server that does not offer it fails
   * to connect at all. Not defaulted off silently either: the value has to be
   * written down.
   */
  const sslMode = optional("DB_SSL") ?? "off";
  if (!["off", "on", "insecure"].includes(sslMode)) {
    problems.push(`DB_SSL must be one of off, on, insecure — got ${JSON.stringify(sslMode)}`);
  }
  const ssl =
    sslMode === "off"
      ? undefined
      : {
          rejectUnauthorized: sslMode !== "insecure",
          ...(ca === undefined ? {} : { ca }),
        };
  if (sslMode === "insecure" && nodeEnv === "production") {
    problems.push("DB_SSL=insecure disables certificate verification and is refused in production");
  }

  const trustedHosts = [
    ...new Set(
      [
        appBaseUrl === "" ? null : new URL(appBaseUrl).host,
        ...(optional("TRUSTED_HOSTS") ?? "")
          .split(",")
          .map((h) => h.trim())
          .filter(Boolean),
      ].filter((h): h is string => h !== null),
    ),
  ];

  if (problems.length > 0) throw new ConfigError(problems);

  return {
    nodeEnv,
    appEnv,
    appBaseUrl,
    port,
    host: optional("HOST") ?? "0.0.0.0",
    database: {
      host: required("DB_HOST"),
      port: dbPort,
      user: required("DB_USER"),
      password: required("DB_PASSWORD"),
      name: required("DB_NAME"),
      ssl,
      connectionLimit,
    },
    storage: { publicRoot, privateRoot },
    secrets: {
      betterAuthSecret,
      settingsEncryptionKey,
      initialAdminSetupToken: optional("INITIAL_ADMIN_SETUP_TOKEN"),
      jobAuthSecret: optional("JOB_AUTH_SECRET"),
    },
    optional: {
      totpIssuer: optional("TOTP_ISSUER"),
      turnstileSiteKey: optional("TURNSTILE_SITE_KEY"),
      turnstileSecretKey: optional("TURNSTILE_SECRET_KEY"),
      resendApiKey: optional("RESEND_API_KEY"),
      emailFrom: optional("EMAIL_FROM"),
      publicMediaBaseUrl: optional("PUBLIC_MEDIA_BASE_URL"),
      smtpHost: optional("SMTP_HOST"),
      smtpPort: optional("SMTP_PORT"),
      smtpUser: optional("SMTP_USER"),
      smtpPassword: optional("SMTP_PASSWORD"),
    },
    trustedHosts,
  };
}

/** True when `child` is `parent` or lives beneath it. Path-aware, not string-prefix. */
function isInside(child: string, parent: string): boolean {
  const normalise = (p: string) => p.replace(/\\/g, "/").replace(/\/+$/, "");
  const c = normalise(child);
  const p = normalise(parent);
  return c === p || c.startsWith(p + "/");
}

export { ConfigError };
