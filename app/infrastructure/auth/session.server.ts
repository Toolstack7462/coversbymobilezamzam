import { redirect } from "react-router";
import { createAuth } from "./auth.server";
import type { Permission } from "~/domain/users/permissions";
import { requiresStepUp } from "~/domain/users/permissions";

/**
 * Server-side authorisation.
 *
 * **Hiding a menu item is not authorisation.** The UI hides what a user cannot
 * do as a courtesy; these functions refuse it as the control. Every admin
 * loader AND action calls one of them.
 */

export interface StaffActor {
  userId: string;
  email: string;
  displayName: string;
  permissions: readonly string[];
  roleCodes: readonly string[];
}

export class Forbidden extends Error {
  constructor(readonly permission: string) {
    super(`Missing permission: ${permission}`);
    this.name = "Forbidden";
  }
}

/** The current session, or null. Never throws. */
export async function getSession(request: Request, env: Env) {
  const auth = createAuth(env);
  return auth.api.getSession({ headers: request.headers });
}

/**
 * Loads the actor's permissions from the database.
 *
 * Read fresh on every request rather than baked into the session: a revoked
 * role must take effect immediately, not whenever the session happens to
 * expire.
 */
export async function loadStaffActor(env: Env, userId: string): Promise<StaffActor | null> {
  const profile = await env.DB.prepare(
    `SELECT sp.display_name, u.email
       FROM staff_profiles sp
       JOIN user u ON u.id = sp.user_id
      WHERE sp.user_id = ?1 AND sp.active = 1 AND sp.archived_at IS NULL`,
  )
    .bind(userId)
    .first<{ display_name: string; email: string }>();

  // No staff profile means a customer, however valid their session.
  if (!profile) return null;

  const { results } = await env.DB.prepare(
    `SELECT DISTINCT p.code, r.code AS role_code
       FROM user_roles ur
       JOIN roles r ON r.id = ur.role_id
       JOIN role_permissions rp ON rp.role_id = r.id
       JOIN permissions p ON p.id = rp.permission_id
      WHERE ur.user_id = ?1`,
  )
    .bind(userId)
    .all<{ code: string; role_code: string }>();

  return {
    userId,
    email: profile.email,
    displayName: profile.display_name,
    permissions: [...new Set(results.map((r) => r.code))],
    roleCodes: [...new Set(results.map((r) => r.role_code))],
  };
}

/**
 * The gate every admin route passes through.
 *
 * Redirects to login when unauthenticated; throws 403 when authenticated but
 * unauthorised. The distinction matters: a staff member who lacks a permission
 * should be told so, not bounced to a login form they are already past.
 */
export async function requireStaff(
  request: Request,
  env: Env,
  permission?: Permission,
): Promise<StaffActor> {
  const session = await getSession(request, env);

  if (!session?.user?.id) {
    const url = new URL(request.url);
    throw redirect(`/admin/accedi?next=${encodeURIComponent(url.pathname + url.search)}`);
  }

  const actor = await loadStaffActor(env, session.user.id);
  if (!actor) {
    // A valid customer session is not staff access.
    throw new Response("Forbidden", { status: 403 });
  }

  if (permission && !actor.permissions.includes(permission)) {
    throw new Response(`Forbidden: ${permission}`, { status: 403 });
  }

  return actor;
}

/**
 * Step-up authentication.
 *
 * A live session is not enough for the highest-impact actions. The user
 * re-authenticates and gets a short window scoped to ONE purpose — a step-up
 * for `payment.verify` does not authorise an IBAN change.
 */
const STEP_UP_WINDOW_MS = 10 * 60 * 1000;

export async function hasStepUp(
  env: Env,
  userId: string,
  purpose: Permission,
  now: number,
): Promise<boolean> {
  const row = await env.DB.prepare(
    `SELECT id FROM step_up_sessions
      WHERE user_id = ?1 AND purpose = ?2 AND expires_at > ?3 AND consumed_at IS NULL
      LIMIT 1`,
  )
    .bind(userId, purpose, now)
    .first<{ id: string }>();
  return row !== null;
}

export async function grantStepUp(
  env: Env,
  userId: string,
  sessionId: string,
  purpose: Permission,
  now: number,
  id: string,
): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO step_up_sessions (id, user_id, session_id, purpose, expires_at, created_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6)`,
  )
    .bind(id, userId, sessionId, purpose, now + STEP_UP_WINDOW_MS, now)
    .run();
}

/**
 * Consumes a step-up so it cannot be replayed.
 *
 * Conditional on `consumed_at IS NULL`, so two concurrent requests cannot both
 * spend the same one — the same pattern as the reservation sweeper.
 */
export async function consumeStepUp(
  env: Env,
  userId: string,
  purpose: Permission,
  now: number,
): Promise<boolean> {
  const result = await env.DB.prepare(
    `UPDATE step_up_sessions SET consumed_at = ?1
      WHERE id = (
        SELECT id FROM step_up_sessions
         WHERE user_id = ?2 AND purpose = ?3 AND expires_at > ?1 AND consumed_at IS NULL
         ORDER BY created_at DESC LIMIT 1
      )`,
  )
    .bind(now, userId, purpose)
    .run();
  return result.meta.changes === 1;
}

/**
 * Requires the permission AND, where the action warrants it, a valid step-up.
 * Use this for anything in STEP_UP_REQUIRED.
 */
export async function requireStepUp(
  request: Request,
  env: Env,
  permission: Permission,
  now: number,
): Promise<StaffActor> {
  const actor = await requireStaff(request, env, permission);

  if (requiresStepUp(permission) && !(await hasStepUp(env, actor.userId, permission, now))) {
    throw new Response("Step-up authentication required", {
      status: 401,
      headers: { "X-Step-Up-Required": permission },
    });
  }

  return actor;
}
