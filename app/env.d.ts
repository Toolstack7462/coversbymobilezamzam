/**
 * Secret bindings.
 *
 * `wrangler types` generates worker-configuration.d.ts from wrangler.jsonc,
 * which lists non-secret vars only - secrets are set with `wrangler secret put`
 * and deliberately never appear in a committed config file.
 *
 * Declaring them here keeps them type-checked without putting a value anywhere
 * near the repository. Both the global `Env` (used by loaders) and
 * `Cloudflare.Env` (used by `cloudflare:test`) are augmented, because Wrangler
 * generates the two separately.
 *
 * Keep this list in step with .dev.vars.example.
 */
interface AppSecrets {
  /** Required. Session and cart-token signing. */
  BETTER_AUTH_SECRET: string;
  /** Required. Absolute origin, no trailing slash. */
  APP_BASE_URL: string;
  /** Required. AES-GCM key for merchant payment identifiers. */
  SETTINGS_ENCRYPTION_KEY: string;

  /**
   * One-time initial-admin bootstrap token. High entropy, at least 24
   * characters. Set with `wrangler secret put INITIAL_ADMIN_SETUP_TOKEN`.
   *
   * Optional in the type because a fully installed system does not need it -
   * but WITHOUT it the setup route refuses to run rather than falling open. A
   * bootstrap endpoint that defaults to "no token required" is a back door.
   */
  INITIAL_ADMIN_SETUP_TOKEN?: string;

  /**
   * Name shown in the authenticator app for TOTP. Falls back to a neutral
   * constant, because the merchant's public brand name is not yet known and
   * inventing one would put a guess on their phone screen.
   */
  TOTP_ISSUER?: string;

  /** Optional. Each gates a feature; absent means the feature is off. */
  TURNSTILE_SITE_KEY?: string;
  TURNSTILE_SECRET_KEY?: string;
  RESEND_API_KEY?: string;
  EMAIL_FROM?: string;
  PUBLIC_MEDIA_BASE_URL?: string;
}

/*
 * The empty bodies are the point: this is DECLARATION MERGING into the two
 * `Env` interfaces Wrangler generates, not the definition of a new type. The
 * no-empty-object-type rule cannot see that distinction, and writing the
 * members out twice to satisfy it would create exactly the drift this avoids.
 */
/* eslint-disable @typescript-eslint/no-empty-object-type */
interface Env extends AppSecrets {}

declare namespace Cloudflare {
  interface Env extends AppSecrets {}
}
/* eslint-enable @typescript-eslint/no-empty-object-type */
