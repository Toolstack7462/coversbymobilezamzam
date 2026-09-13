/**
 * The five Better Auth tables, defined for Drizzle's MySQL dialect.
 *
 * ── WHY A SECOND DEFINITION EXISTS, WHEN "ONE FACT, ONE PLACE" SAYS IT SHOULD NOT ──
 *
 * Drizzle's table builders are dialect-specific: `sqliteTable` produces a table
 * object that `drizzle-orm/mysql2` cannot use, and there is no conversion.
 * Better Auth's `drizzleAdapter` needs table objects in the dialect of the
 * driver it is given. So either the auth tables are declared twice, or Better
 * Auth is replaced with hand-rolled session and credential storage — and
 * hand-rolling session storage, password hashing and TOTP is not a trade this
 * migration is entitled to make.
 *
 * The duplication is contained to FIVE tables, all of them owned by Better
 * Auth and none of them ours to change. The other ninety-six tables are not
 * duplicated: the application reaches them through raw SQL, which is dialect-
 * neutral once the translator has run.
 *
 * ── HOW THE TWO ARE KEPT IN STEP ──
 *
 * `tests/mariadb/auth-schema.test.ts` compares this file's columns against the
 * generated MariaDB baseline, column by column. Adding a column to
 * db/schema/auth.ts without adding it here fails that test rather than failing
 * at the first sign-in after a deployment.
 *
 * Types match db/mariadb/migrations/0001_baseline.sql exactly, because Drizzle
 * does not create these tables — the baseline does. A mismatch here would be a
 * lie the query builder tells itself.
 */

import {
  mysqlTable,
  varchar,
  text,
  bigint,
  tinyint,
  int,
  index,
  uniqueIndex,
} from "drizzle-orm/mysql-core";

/** Identifiers: VARCHAR(64), matching the `identifier` rule in the type map. */
const id = () => varchar("id", { length: 64 }).primaryKey().notNull();

/**
 * Epoch milliseconds in BIGINT.
 *
 * `{ mode: "number" }` because the whole application compares these as numbers
 * and every value is far inside `Number.MAX_SAFE_INTEGER` — an epoch
 * millisecond is ~1.8e12, the limit is 9.0e15. Drizzle's default for BIGINT
 * would hand back a string, and `"1789…" > 1789…` is false, so a session would
 * simply never expire.
 */
const epochMillis = (name: string) => bigint(name, { mode: "number" });

/** MySQL has no boolean. TINYINT(1) is what the baseline creates. */
const bool = (name: string) => tinyint(name).notNull().default(0);

export const user = mysqlTable(
  "user",
  {
    id: id(),
    name: varchar("name", { length: 255 }).notNull(),
    email: varchar("email", { length: 255 }).notNull(),
    emailVerified: bool("email_verified"),
    image: varchar("image", { length: 255 }),
    twoFactorEnabled: bool("two_factor_enabled"),
    createdAt: epochMillis("created_at").notNull(),
    updatedAt: epochMillis("updated_at").notNull(),
  },
  (t) => [uniqueIndex("user_email_unique").on(t.email)],
);

export const session = mysqlTable(
  "session",
  {
    id: id(),
    userId: varchar("user_id", { length: 64 }).notNull(),
    token: varchar("token", { length: 255 }).notNull(),
    expiresAt: epochMillis("expires_at").notNull(),
    ipAddress: varchar("ip_address", { length: 45 }),
    userAgent: varchar("user_agent", { length: 500 }),
    createdAt: epochMillis("created_at").notNull(),
    updatedAt: epochMillis("updated_at").notNull(),
  },
  (t) => [uniqueIndex("session_token_unique").on(t.token), index("session_user_idx").on(t.userId)],
);

export const account = mysqlTable(
  "account",
  {
    id: id(),
    userId: varchar("user_id", { length: 64 }).notNull(),
    /**
     * Required by Better Auth 1.7. Its absence made `signUpEmail` throw before
     * writing anything, so installation could never complete — see D1 migration
     * 0004. Carried across deliberately rather than rediscovered.
     */
    issuer: varchar("issuer", { length: 255 }).notNull(),
    accountId: varchar("account_id", { length: 255 }).notNull(),
    providerId: varchar("provider_id", { length: 64 }).notNull(),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    accessTokenExpiresAt: epochMillis("access_token_expires_at"),
    refreshTokenExpiresAt: epochMillis("refresh_token_expires_at"),
    scope: varchar("scope", { length: 500 }),
    idToken: text("id_token"),
    /** The password hash. Never rendered, never logged. */
    password: varchar("password", { length: 255 }),
    createdAt: epochMillis("created_at").notNull(),
    updatedAt: epochMillis("updated_at").notNull(),
  },
  (t) => [index("account_user_idx").on(t.userId)],
);

export const verification = mysqlTable(
  "verification",
  {
    id: id(),
    identifier: varchar("identifier", { length: 255 }).notNull(),
    value: varchar("value", { length: 500 }).notNull(),
    expiresAt: epochMillis("expires_at").notNull(),
    createdAt: epochMillis("created_at").notNull(),
    updatedAt: epochMillis("updated_at").notNull(),
  },
  (t) => [index("verification_identifier_idx").on(t.identifier)],
);

export const twoFactor = mysqlTable(
  "two_factor",
  {
    id: id(),
    userId: varchar("user_id", { length: 64 }).notNull(),
    secret: varchar("secret", { length: 500 }).notNull(),
    /** Encrypted by Better Auth with BETTER_AUTH_SECRET. See the key inventory. */
    backupCodes: text("backup_codes"),
    /**
     * The factor does not count until a code has been generated from it.
     * `skipVerificationOnEnable: false` depends on this column, and losing it
     * would mean enrolling and then losing the authenticator locks the account.
     */
    verified: bool("verified"),
    failedVerificationCount: int("failed_verification_count").notNull().default(0),
    lockedUntil: epochMillis("locked_until"),
  },
  (t) => [index("two_factor_user_idx").on(t.userId)],
);

/** Exactly what `drizzleAdapter` is handed. Nothing else is reachable from it. */
export const betterAuthMysqlSchema = {
  user,
  session,
  account,
  verification,
  twoFactor,
};
