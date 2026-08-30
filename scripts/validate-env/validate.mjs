/**
 * Environment validation.
 *
 * Fails FAST and loudly at startup rather than at the first request that needs
 * a missing value. A store that boots and then cannot decrypt an IBAN has
 * failed in the most expensive possible place.
 */
const REQUIRED = [
  { key: "BETTER_AUTH_SECRET", why: "session signing", minLength: 32 },
  { key: "APP_BASE_URL", why: "absolute URLs and origin checks" },
  {
    key: "SETTINGS_ENCRYPTION_KEY",
    why: "encrypting merchant payment identifiers",
    minLength: 32,
  },
];

/**
 * Optional. Each GATES a feature: absent means the feature is off, which is a
 * valid state, not an error (invariant 12).
 */
const OPTIONAL = [
  { key: "TURNSTILE_SITE_KEY", gates: "bot protection on high-risk forms" },
  { key: "TURNSTILE_SECRET_KEY", gates: "bot protection on high-risk forms" },
  { key: "RESEND_API_KEY", gates: "transactional email (the outbox still records it)" },
  { key: "EMAIL_FROM", gates: "transactional email" },
  { key: "PUBLIC_MEDIA_BASE_URL", gates: "product images" },
];

export function validateEnv(env) {
  const errors = [];
  const disabled = [];

  for (const { key, why, minLength } of REQUIRED) {
    const value = env[key];
    if (!value || String(value).trim() === "") {
      errors.push(`${key} is required (${why}).`);
    } else if (minLength && String(value).length < minLength) {
      errors.push(`${key} is too short: needs at least ${minLength} characters (${why}).`);
    }
  }

  for (const { key, gates } of OPTIONAL) {
    if (!env[key] || String(env[key]).trim() === "") {
      disabled.push(`${key} — ${gates} is DISABLED`);
    }
  }

  return { ok: errors.length === 0, errors, disabled };
}

// CLI use: node scripts/validate-env/validate.mjs
const invokedDirectly = process.argv[1]?.endsWith("validate.mjs") ?? false;

if (invokedDirectly) {
  const result = validateEnv(process.env);

  for (const line of result.disabled) {
    console.log(`  (optional) ${line}`);
  }

  if (!result.ok) {
    console.error("\nEnvironment validation FAILED:\n");
    for (const error of result.errors) {
      console.error(`  ${error}`);
    }
    console.error("\nSee .dev.vars.example and docs/deployment.md.");
    process.exit(1);
  }

  console.log("\nEnvironment OK.");
}
