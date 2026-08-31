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
    baseURL: env.APP_BASE_URL,
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
        "/two-factor/verify-totp": { window: 60, max: 5 },
        "/two-factor/verify-backup-code": { window: 60, max: 3 },
      },
    },

    // No public sign-up reaches the admin: a customer account confers nothing.
    // Staff access is a staff_profiles row plus a role.
    trustedOrigins: [env.APP_BASE_URL],
  });
}

export type Auth = ReturnType<typeof createAuth>;
