import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { twoFactor } from "better-auth/plugins";
import { createDb } from "~/infrastructure/db/client";
import { user, session, account, verification, twoFactor as twoFactorTable } from "@db/schema";

/**
 * Better Auth, over D1 through Drizzle.
 *
 * Better Auth owns `user`, `session`, `account`, `verification` and
 * `two_factor`. This project does not hand-roll session storage, credential
 * storage or TOTP cryptography: two definitions of any of those drift apart,
 * and the one that drifted would be the one enforcing access.
 *
 * A fresh instance per request. Workers have no long-lived process to hold one,
 * and the bindings differ per request anyway.
 */
export function createAuth(env: Env) {
  const db = createDb(env.DB);

  /*
   * Refuse to build an auth system that does not know where it lives.
   *
   * Better Auth signs cookies against this origin and validates every request's
   * origin header against it. Left undefined, `trustedOrigins: [undefined]`
   * rejects sign-in on a check that never fires in local development, where
   * .dev.vars always supplies a value — so the failure appears only after
   * deploying, and appears as "wrong password".
   *
   * Throwing here turns that into an immediate, legible error that names the
   * missing variable. The environments that are not configured yet — staging
   * and production — will hit this on their first request rather than silently
   * locking every member of staff out of the shop.
   */
  const baseUrl = env.APP_BASE_URL;
  if (!baseUrl) {
    throw new Error(
      "APP_BASE_URL is not set. Better Auth cannot validate request origins " +
        "without it, and every sign-in would fail. Set it to this deployment's " +
        "exact origin (scheme included, no trailing slash) in wrangler.jsonc.",
    );
  }

  return betterAuth({
    database: drizzleAdapter(db, {
      provider: "sqlite",
      // Explicit rather than passing the whole schema: Better Auth should see
      // only its own tables, so it can never touch orders or inventory.
      schema: {
        user,
        session,
        account,
        verification,
        // The plugin's model is `twoFactor`; the table is `two_factor`.
        twoFactor: twoFactorTable,
      },
    }),

    secret: env.BETTER_AUTH_SECRET,
    baseURL: baseUrl,
    basePath: "/api/auth",

    emailAndPassword: {
      enabled: true,
      // 12 rather than 8. These accounts can change where money goes.
      minPasswordLength: 12,
      maxPasswordLength: 200,
      requireEmailVerification: false,
      // A reset link that silently goes nowhere is worse than a disabled
      // feature, so this exists only when a provider is configured.
      ...(env.RESEND_API_KEY ? { sendResetPassword: async () => {} } : {}),
      /**
       * A password reset invalidates every other session.
       *
       * Reset is the action someone takes when they believe an account is
       * compromised. Leaving the attacker's session alive through it would
       * defeat the point.
       */
      revokeSessionsOnPasswordReset: true,
    },

    plugins: [
      twoFactor({
        // Shown in the authenticator app. Configurable, with a neutral fallback
        // because the merchant's public brand name is not yet known.
        issuer: env.TOTP_ISSUER ?? "Italian Tech Atelier",

        /**
         * The factor does NOT count until a code has been verified.
         *
         * With `true`, enrolment would enable 2FA the moment a secret is
         * generated - so anyone who scanned a QR badly, or lost the phone
         * before the first code, would be locked out of their own account with
         * a factor they cannot satisfy.
         */
        skipVerificationOnEnable: false,

        // A password is always required to manage 2FA. There are no
        // passkey-only staff accounts, and allowing this would remove the
        // strongest check on the most dangerous settings screen.
        allowPasswordless: false,

        /**
         * Account-level lockout across challenges and factors.
         *
         * Tighter than the library default of 10: these accounts can verify
         * payments and change an IBAN, and six digits is a small search space
         * if guessing is cheap.
         */
        accountLockout: {
          enabled: true,
          maxFailedAttempts: 5,
          durationSeconds: 900,
        },

        // Ten minutes to complete the challenge after a password succeeds.
        twoFactorCookieMaxAge: 600,

        /**
         * NOTE ON TRUSTED DEVICES.
         *
         * The library supports a "trust this device" cookie. This application
         * never sends `trustDevice: true` from any verification route, so no
         * privileged account can acquire the bypass - see
         * app/routes/admin/security-2fa-verify.tsx. The max-age below only
         * bounds a cookie that is never issued.
         */
        trustDeviceMaxAge: 0,
      }),
    ],

    session: {
      // Eight hours. Long enough for a working day, short enough that a
      // forgotten session in the shop expires overnight.
      expiresIn: 60 * 60 * 8,
      updateAge: 60 * 60,
    },

    advanced: {
      // `__Host-` requires Secure, path=/ and no Domain - the strictest cookie
      // scope a browser offers.
      cookiePrefix: "__Host-ita",
      useSecureCookies: true,
      defaultCookieAttributes: {
        httpOnly: true,
        sameSite: "lax",
        secure: true,
        path: "/",
      },
    },

    rateLimit: {
      enabled: true,
      window: 60,
      max: 20,
      customRules: {
        // Login, reset and the 2FA challenge are the brute-force surfaces.
        "/sign-in/email": { window: 60, max: 5 },
        "/forget-password": { window: 60, max: 3 },

        /*
         * Ten a minute, raised from five.
         *
         * Five is tight for a code that expires while it is being typed. A
         * person who mistypes once, waits for a fresh code, mistypes again and
         * retries is at the limit — and the response is a 429, which this
         * screen can only render as "your code is wrong". Being told a correct
         * code is invalid, with no way to tell the two apart, is a worse
         * outcome than the marginal exposure below.
         *
         * The arithmetic: a TOTP is one of 10^6 codes and lives about ninety
         * seconds. Ten attempts a minute gives roughly fifteen guesses inside a
         * code's life — about 0.0015% per window, against 0.00075% at five. The
         * protection here is the code space and the window, not the rate limit,
         * and `two_factor.failed_verification_count` and `locked_until` are the
         * real lockout underneath.
         */
        "/two-factor/verify-totp": { window: 60, max: 10 },

        // Backup codes stay at three: they are static strings on paper, they do
        // not rotate, and nobody mistypes one because nobody types one from
        // memory.
        "/two-factor/verify-backup-code": { window: 60, max: 3 },
      },
    },

    // No public sign-up reaches the admin: a customer account confers nothing.
    // Staff access is a staff_profiles row plus a role.
    trustedOrigins: [baseUrl],
  });
}

export type Auth = ReturnType<typeof createAuth>;
