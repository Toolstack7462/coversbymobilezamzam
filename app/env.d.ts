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
