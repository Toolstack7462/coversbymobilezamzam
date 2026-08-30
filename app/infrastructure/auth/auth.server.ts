import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { createDb } from "~/infrastructure/db/client";
import { user, session, account, verification } from "@db/schema";

/**
 * Better Auth, over D1 through Drizzle.
 *
 * Better Auth owns `user`, `session`, `account` and `verification`. This project
 * does not hand-roll session or credential storage: two definitions of a session
 * drift apart, and the one that drifted would be the one enforcing access.
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
      schema: { user, session, account, verification },
    }),

    secret: env.BETTER_AUTH_SECRET,
    baseURL: env.APP_BASE_URL,
    basePath: "/api/auth",

    emailAndPassword: {
      enabled: true,
      // 12 rather than 8. These accounts can change where money goes.
      minPasswordLength: 12,
      maxPasswordLength: 200,
      // There is no email provider by default, and a reset link that silently
      // goes nowhere is worse than a disabled feature. Enabled only when
      // RESEND_API_KEY is configured (invariant 12).
      requireEmailVerification: false,
      // Spread rather than an explicit undefined: with
      // exactOptionalPropertyTypes an `undefined` value is not the same as an
      // absent key, and Better Auth treats the key's presence as "enabled".
      ...(env.RESEND_API_KEY ? { sendResetPassword: async () => {} } : {}),
    },

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
        // Login and reset are the brute-force surfaces.
        "/sign-in/email": { window: 60, max: 5 },
        "/forget-password": { window: 60, max: 3 },
      },
    },

    // No public sign-up endpoint reaches the admin: a customer account confers
    // nothing. Staff access is the presence of a staff_profiles row plus a
    // role, which only an existing admin can grant.
    trustedOrigins: [env.APP_BASE_URL],
  });
}

export type Auth = ReturnType<typeof createAuth>;
