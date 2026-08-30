import { sqliteTable, text, index, uniqueIndex } from "drizzle-orm/sqlite-core";
import { pk, ts, authTs, bool, stamps, archivable, sortOrder } from "./_shared";

/**
 * Better Auth owns `user`, `session`, `account` and `verification`. They are
 * defined here because Drizzle needs them for typed queries and migrations, but
 * their SHAPE is Better Auth's - do not add project columns to them.
 *
 * Project-specific data goes in staff_profiles and the RBAC tables below, keyed
 * by user id. Two definitions of a session would drift apart, and the one that
 * drifted would be the one enforcing access.
 */

export const user = sqliteTable(
  "user",
  {
    id: pk(),
    name: text("name").notNull(),
    email: text("email").notNull(),
    emailVerified: bool("email_verified").notNull().default(false),
    image: text("image"),
    twoFactorEnabled: bool("two_factor_enabled").notNull().default(false),
    createdAt: authTs("created_at").notNull(),
    updatedAt: authTs("updated_at").notNull(),
  },
  (t) => [uniqueIndex("user_email_unique").on(t.email)],
);

export const session = sqliteTable(
  "session",
  {
    id: pk(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    token: text("token").notNull(),
    expiresAt: authTs("expires_at").notNull(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    createdAt: authTs("created_at").notNull(),
    updatedAt: authTs("updated_at").notNull(),
  },
  (t) => [uniqueIndex("session_token_unique").on(t.token), index("session_user_idx").on(t.userId)],
);

export const account = sqliteTable(
  "account",
  {
    id: pk(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    accessTokenExpiresAt: authTs("access_token_expires_at"),
    refreshTokenExpiresAt: authTs("refresh_token_expires_at"),
    scope: text("scope"),
    idToken: text("id_token"),
    password: text("password"),
    createdAt: authTs("created_at").notNull(),
    updatedAt: authTs("updated_at").notNull(),
  },
  (t) => [index("account_user_idx").on(t.userId)],
);

export const verification = sqliteTable(
  "verification",
  {
    id: pk(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: authTs("expires_at").notNull(),
    createdAt: authTs("created_at").notNull(),
    updatedAt: authTs("updated_at").notNull(),
  },
  (t) => [index("verification_identifier_idx").on(t.identifier)],
);

/** TOTP secrets, kept out of `user` so the auth tables stay Better Auth shaped. */
export const twoFactor = sqliteTable(
  "two_factor",
  {
    id: pk(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    secret: text("secret").notNull(),
    backupCodes: text("backup_codes"),
  },
  (t) => [index("two_factor_user_idx").on(t.userId)],
);

// ── Project-specific ─────────────────────────────────────────────────────────

/**
 * A user is a customer unless they have a staff profile. There is no `is_staff`
 * flag on `user`: staff access is the presence of this row plus a role, so it
 * cannot be granted by flipping a boolean.
 */
export const staffProfiles = sqliteTable(
  "staff_profiles",
  {
    id: pk(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "restrict" }),
    displayName: text("display_name").notNull(),
    jobTitle: text("job_title"),
    active: bool("active").notNull().default(true),
    lastLoginAt: ts("last_login_at"),
    ...stamps(),
    ...archivable(),
  },
  (t) => [uniqueIndex("staff_profiles_user_unique").on(t.userId)],
);

/** Roles are data, so the merchant can create one without a deployment. */
export const roles = sqliteTable(
  "roles",
  {
    id: pk(),
    code: text("code").notNull(),
    nameIt: text("name_it").notNull(),
    nameEn: text("name_en").notNull(),
    description: text("description"),
    /** System roles cannot be deleted, only edited. */
    isSystem: bool("is_system").notNull().default(false),
    sortOrder: sortOrder(),
    ...stamps(),
  },
  (t) => [uniqueIndex("roles_code_unique").on(t.code)],
);

export const permissions = sqliteTable(
  "permissions",
  {
    id: pk(),
    /** `resource.action`, e.g. `payment.verify`. */
    code: text("code").notNull(),
    description: text("description").notNull(),
    /** Grouping for the admin UI only. */
    category: text("category").notNull(),
  },
  (t) => [uniqueIndex("permissions_code_unique").on(t.code)],
);

export const rolePermissions = sqliteTable(
  "role_permissions",
  {
    id: pk(),
    roleId: text("role_id")
      .notNull()
      .references(() => roles.id, { onDelete: "cascade" }),
    permissionId: text("permission_id")
      .notNull()
      .references(() => permissions.id, { onDelete: "cascade" }),
  },
  (t) => [uniqueIndex("role_permissions_unique").on(t.roleId, t.permissionId)],
);

export const userRoles = sqliteTable(
  "user_roles",
  {
    id: pk(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    roleId: text("role_id")
      .notNull()
      .references(() => roles.id, { onDelete: "restrict" }),
    grantedBy: text("granted_by").references(() => user.id, { onDelete: "set null" }),
    grantedAt: ts("granted_at").notNull(),
  },
  (t) => [
    uniqueIndex("user_roles_unique").on(t.userId, t.roleId),
    index("user_roles_user_idx").on(t.userId),
  ],
);

/**
 * Step-up authentication.
 *
 * A live session is not enough for changing an IBAN or verifying a payment: a
 * borrowed laptop or a stolen cookie does the most damage precisely there. The
 * user re-authenticates and gets a short window, scoped to one purpose.
 */
export const stepUpSessions = sqliteTable(
  "step_up_sessions",
  {
    id: pk(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    sessionId: text("session_id").notNull(),
    /** What this step-up authorises, e.g. `payment.verify`. Not a blanket pass. */
    purpose: text("purpose").notNull(),
    expiresAt: ts("expires_at").notNull(),
    consumedAt: ts("consumed_at"),
    createdAt: ts("created_at").notNull(),
  },
  (t) => [index("step_up_user_purpose_idx").on(t.userId, t.purpose, t.expiresAt)],
);
