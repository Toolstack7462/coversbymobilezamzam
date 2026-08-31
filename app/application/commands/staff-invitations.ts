import { z } from "zod";
import type { Clock, IdGenerator } from "~/application/ports";
import type { StaffActor } from "~/infrastructure/auth/session.server";
import { canGrantRole } from "~/domain/users/staff-guards";
import type { Permission } from "~/domain/users/permissions";

/**
 * Staff invitations.
 *
 * There is no public staff registration and no "create user with a password"
 * form — an administrator typing a colleague's password means an administrator
 * briefly knows it. The invitee sets their own.
 *
 * The token is stored HASHED. It is a bearer credential: whoever holds it can
 * become staff, so the database must not contain a usable copy. A leaked backup
 * of `staff_invitations` gives an attacker nothing.
 */

const INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export const CreateInvitationInput = z.object({
  email: z.string().trim().email().max(255),
  roleIds: z.array(z.string().min(1)).min(1).max(10),
});

export type CreateInvitationInput = z.infer<typeof CreateInvitationInput>;

export type CreateInvitationResult =
  | {
      ok: true;
      invitationId: string;
      /**
       * Plaintext, returned ONCE for display to the inviter. It is never stored
       * and never returned again.
       */
      token: string;
      expiresAt: number;
    }
  | { ok: false; reason: "already_staff" }
  | { ok: false; reason: "already_invited" }
  | { ok: false; reason: "role_not_grantable"; detail: string }
  | { ok: false; reason: "unknown_role" };

export interface InvitationDeps {
  env: Env;
  clock: Clock;
  ids: IdGenerator;
  actor: StaffActor;
}

/** SHA-256 hex. The stored form of an invitation token. */
export async function hashToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** 32 characters from an unambiguous alphabet — these get read aloud. */
function generateToken(ids: IdGenerator): string {
  const alphabet = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
  const bytes = ids.randomBytes(32);
  let token = "";
  for (let i = 0; i < 32; i++) token += alphabet[bytes[i]! % alphabet.length];
  return token;
}

export async function createInvitation(
  input: CreateInvitationInput,
  deps: InvitationDeps,
): Promise<CreateInvitationResult> {
  const { env, clock, ids, actor } = deps;
  const now = clock.now();
  const email = input.email.toLowerCase();

  // Already staff: inviting again would create a second profile for one person.
  const existing = await env.DB.prepare(
    `SELECT sp.id FROM staff_profiles sp
       JOIN user u ON u.id = sp.user_id
      WHERE LOWER(u.email) = ?1 AND sp.archived_at IS NULL`,
  )
    .bind(email)
    .first<{ id: string }>();
  if (existing) return { ok: false, reason: "already_staff" };

  const pending = await env.DB.prepare(
    `SELECT id FROM staff_invitations
      WHERE LOWER(email) = ?1 AND status = 'pending' AND expires_at > ?2`,
  )
    .bind(email, now)
    .first<{ id: string }>();
  if (pending) return { ok: false, reason: "already_invited" };

  // Resolve the roles and check the actor may actually grant every one of them.
  const placeholders = input.roleIds.map((_, i) => `?${i + 1}`).join(",");
  const { results: roles } = await env.DB.prepare(
    `SELECT r.id, r.code,
            (SELECT GROUP_CONCAT(p.code) FROM role_permissions rp
               JOIN permissions p ON p.id = rp.permission_id
              WHERE rp.role_id = r.id) AS permission_codes
       FROM roles r WHERE r.id IN (${placeholders})`,
  )
    .bind(...input.roleIds)
    .all<{ id: string; code: string; permission_codes: string | null }>();

  if (roles.length !== input.roleIds.length) return { ok: false, reason: "unknown_role" };

  for (const role of roles) {
    const permissions = (role.permission_codes?.split(",") ?? []) as Permission[];
    const guard = canGrantRole(actor, { code: role.code, permissions });
    if (!guard.allowed) {
      return { ok: false, reason: "role_not_grantable", detail: guard.reason };
    }
  }

  const token = generateToken(ids);
  const tokenHash = await hashToken(token);
  const invitationId = ids.generate();
  const expiresAt = now + INVITATION_TTL_MS;

  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO staff_invitations
         (id, email, role_ids, invited_by, token_hash, status, expires_at, created_at, updated_at)
       VALUES (?1,?2,?3,?4,?5,'pending',?6,?7,?7)`,
    ).bind(
      invitationId,
      email,
      JSON.stringify(input.roleIds),
      actor.userId,
      tokenHash,
      expiresAt,
      now,
    ),
    env.DB.prepare(
      `INSERT INTO audit_logs
         (id, actor_id, actor_label, action, entity_type, entity_id, after_value, created_at)
       VALUES (?1,?2,?3,'staff.invited','staff_invitation',?4,?5,?6)`,
    ).bind(
      ids.generate(),
      actor.userId,
      actor.displayName,
      invitationId,
      // The email and roles are auditable; the token is not recorded.
      JSON.stringify({ email, roleCodes: roles.map((r) => r.code) }),
      now,
    ),
  ]);

  return { ok: true, invitationId, token, expiresAt };
}

// ── Acceptance ───────────────────────────────────────────────────────────────

export const AcceptInvitationInput = z.object({
  token: z.string().trim().min(16).max(128),
  name: z.string().trim().min(1).max(120),
  password: z.string().min(12).max(200),
});

export type AcceptInvitationInput = z.infer<typeof AcceptInvitationInput>;

export type AcceptInvitationResult =
  | { ok: true; userId: string; setCookie: string | null; mustEnrolTwoFactor: boolean }
  | { ok: false; reason: "invalid_or_expired" }
  | { ok: false; reason: "account_creation_failed" };

export interface AcceptDeps {
  env: Env;
  clock: Clock;
  ids: IdGenerator;
  createAccount: (input: {
    name: string;
    email: string;
    password: string;
  }) => Promise<
    { ok: true; userId: string; setCookie: string | null } | { ok: false; detail: string }
  >;
}

export async function acceptInvitation(
  input: AcceptInvitationInput,
  deps: AcceptDeps,
): Promise<AcceptInvitationResult> {
  const { env, clock, ids } = deps;
  const now = clock.now();

  const tokenHash = await hashToken(input.token);

  /**
   * Claim the invitation ATOMICALLY before creating anything.
   *
   * Conditional on `status = 'pending'` and not expired, so a token submitted
   * twice in parallel is consumed exactly once — the same pattern as the
   * step-up consumption and the reservation sweeper.
   */
  const claim = await env.DB.prepare(
    `UPDATE staff_invitations
        SET status = 'accepted', accepted_at = ?1, updated_at = ?1
      WHERE token_hash = ?2 AND status = 'pending' AND expires_at > ?1`,
  )
    .bind(now, tokenHash)
    .run();

  if (claim.meta.changes === 0) {
    // Invalid, already used, revoked or expired. Deliberately one message: an
    // unauthenticated caller learns nothing about which.
    return { ok: false, reason: "invalid_or_expired" };
  }

  const invitation = await env.DB.prepare(
    `SELECT id, email, role_ids FROM staff_invitations WHERE token_hash = ?1`,
  )
    .bind(tokenHash)
    .first<{ id: string; email: string; role_ids: string }>();

  if (!invitation) return { ok: false, reason: "invalid_or_expired" };

  const account = await deps.createAccount({
    name: input.name,
    // The invitation is scoped to ONE address. The invitee cannot choose a
    // different one, so an invitation cannot be redirected to another mailbox.
    email: invitation.email,
    password: input.password,
  });

  if (!account.ok) {
    // Release the claim so the invitation can be retried.
    await env.DB.prepare(
      `UPDATE staff_invitations SET status = 'pending', accepted_at = NULL, updated_at = ?1
        WHERE id = ?2`,
    )
      .bind(now, invitation.id)
      .run();
    return { ok: false, reason: "account_creation_failed" };
  }

  const roleIds = JSON.parse(invitation.role_ids) as string[];

  const statements: D1PreparedStatement[] = [
    env.DB.prepare(
      `INSERT INTO staff_profiles
         (id, user_id, display_name, status, active, created_at, updated_at)
       VALUES (?1,?2,?3,'active',1,?4,?4)`,
    ).bind(ids.generate(), account.userId, input.name, now),

    env.DB.prepare(
      `UPDATE staff_invitations SET accepted_by_user_id = ?1, updated_at = ?2 WHERE id = ?3`,
    ).bind(account.userId, now, invitation.id),

    env.DB.prepare(
      `INSERT INTO audit_logs
         (id, actor_id, actor_label, action, entity_type, entity_id, after_value, created_at)
       VALUES (?1,?2,?3,'staff.invitation_accepted','user',?2,?4,?5)`,
    ).bind(
      ids.generate(),
      account.userId,
      input.name,
      JSON.stringify({ invitationId: invitation.id, roleIds }),
      now,
    ),
  ];

  for (const roleId of roleIds) {
    statements.push(
      env.DB.prepare(
        `INSERT INTO user_roles (id, user_id, role_id, granted_by, granted_at)
         VALUES (?1,?2,?3,?4,?5)`,
      ).bind(ids.generate(), account.userId, roleId, account.userId, now),
    );
  }

  await env.DB.batch(statements);

  // Whether the granted roles oblige TOTP. The layout enforces it on every
  // request regardless; this only drives where they land first.
  const privileged = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM user_roles ur
       JOIN role_permissions rp ON rp.role_id = ur.role_id
       JOIN permissions p ON p.id = rp.permission_id
      WHERE ur.user_id = ?1
        AND p.code IN ('payment.verify','payment.settings','staff.roles','staff.write','settings.write','order.refund')`,
  )
    .bind(account.userId)
    .first<{ n: number }>();

  return {
    ok: true,
    userId: account.userId,
    setCookie: account.setCookie,
    mustEnrolTwoFactor: (privileged?.n ?? 0) > 0,
  };
}

export async function revokeInvitation(
  invitationId: string,
  deps: InvitationDeps,
): Promise<boolean> {
  const { env, clock, ids, actor } = deps;
  const now = clock.now();

  const result = await env.DB.prepare(
    `UPDATE staff_invitations
        SET status = 'revoked', revoked_at = ?1, revoked_by = ?2, updated_at = ?1
      WHERE id = ?3 AND status = 'pending'`,
  )
    .bind(now, actor.userId, invitationId)
    .run();

  if (result.meta.changes === 0) return false;

  await env.DB.prepare(
    `INSERT INTO audit_logs
       (id, actor_id, actor_label, action, entity_type, entity_id, after_value, created_at)
     VALUES (?1,?2,?3,'staff.invitation_revoked','staff_invitation',?4,'{}',?5)`,
  )
    .bind(ids.generate(), actor.userId, actor.displayName, invitationId, now)
    .run();

  return true;
}
