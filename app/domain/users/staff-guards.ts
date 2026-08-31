import type { Permission } from "./permissions";

/**
 * Staff-management guards.
 *
 * Pure functions over plain data, so every rule below is unit-testable without
 * a database. These are the rules that stop an administrator locking the shop
 * out of its own admin panel, or quietly promoting themselves.
 */

export const STAFF_STATUSES = ["invited", "active", "suspended", "disabled", "archived"] as const;

export type StaffStatus = (typeof STAFF_STATUSES)[number];

/** Only `active` staff may sign in and act. Everything else is a closed door. */
export function isUsableStatus(status: StaffStatus): boolean {
  return status === "active";
}

const STATUS_TRANSITIONS: Record<StaffStatus, readonly StaffStatus[]> = {
  // An invitation either gets accepted, or the profile is archived. Revoking
  // the invitation is an operation on the INVITATION row, not on this status.
  invited: ["active", "archived"],
  active: ["suspended", "disabled", "archived"],
  // Suspension is meant to be reversible - a colleague on leave, or an account
  // being investigated. Disablement is the deliberate end of employment.
  suspended: ["active", "disabled", "archived"],
  disabled: ["active", "archived"],
  // Archived is terminal: audit rows reference these accounts, so they are
  // never hard deleted (invariant 13).
  archived: [],
};

export function canChangeStatus(from: StaffStatus, to: StaffStatus): boolean {
  return STATUS_TRANSITIONS[from].includes(to);
}

export function allowedStatusChanges(from: StaffStatus): readonly StaffStatus[] {
  return STATUS_TRANSITIONS[from];
}

// ── The last-super-admin protection ──────────────────────────────────────────

export interface StaffSummary {
  userId: string;
  status: StaffStatus;
  roleCodes: readonly string[];
}

/** Active accounts that currently hold super_admin. */
export function activeSuperAdmins(staff: readonly StaffSummary[]): readonly StaffSummary[] {
  return staff.filter((s) => isUsableStatus(s.status) && s.roleCodes.includes("super_admin"));
}

export type GuardResult = { allowed: true } | { allowed: false; reason: string };

/**
 * Whether an operation would leave the shop with no usable administrator.
 *
 * This is the guard that matters most in this file. Without it a single
 * mis-click — demoting yourself, suspending the wrong person, archiving an old
 * account — locks everyone out of the admin permanently, and the only recovery
 * is direct SQL against production.
 *
 * It deliberately covers ALL FOUR routes to the same outcome, because blocking
 * only "remove your own role" leaves three open doors.
 */
export function wouldOrphanSuperAdmin(
  staff: readonly StaffSummary[],
  change: {
    targetUserId: string;
    /** The roles the target will hold afterwards, if roles are changing. */
    resultingRoleCodes?: readonly string[];
    /** The status the target will have afterwards, if status is changing. */
    resultingStatus?: StaffStatus;
  },
): boolean {
  const after = staff.map((s) => {
    if (s.userId !== change.targetUserId) return s;
    return {
      ...s,
      roleCodes: change.resultingRoleCodes ?? s.roleCodes,
      status: change.resultingStatus ?? s.status,
    };
  });

  return activeSuperAdmins(after).length === 0;
}

export function guardLastSuperAdmin(
  staff: readonly StaffSummary[],
  change: Parameters<typeof wouldOrphanSuperAdmin>[1],
): GuardResult {
  if (!wouldOrphanSuperAdmin(staff, change)) return { allowed: true };
  return {
    allowed: false,
    reason: "Deve restare almeno un amministratore attivo. Nomina prima un altro amministratore.",
  };
}

// ── Granting ─────────────────────────────────────────────────────────────────

/**
 * Whether an actor may grant a role.
 *
 * Two rules, and the second is the one people forget:
 *
 *   1. Only a super_admin may grant super_admin. Otherwise anyone holding
 *      `staff.roles` could promote themselves to everything.
 *   2. An actor may not grant a permission they do not themselves hold. This
 *      closes the indirect route: without it, a role manager could mint a new
 *      role containing `payment.settings` and assign it to themselves.
 */
export function canGrantRole(
  actor: { permissions: readonly string[]; roleCodes: readonly string[] },
  targetRole: { code: string; permissions: readonly Permission[] },
): GuardResult {
  if (!actor.permissions.includes("staff.roles")) {
    return { allowed: false, reason: "Non hai il permesso di gestire i ruoli." };
  }

  if (targetRole.code === "super_admin" && !actor.roleCodes.includes("super_admin")) {
    return {
      allowed: false,
      reason: "Solo un amministratore può nominare un altro amministratore.",
    };
  }

  const missing = targetRole.permissions.filter((p) => !actor.permissions.includes(p));
  if (missing.length > 0) {
    return {
      allowed: false,
      reason: `Non puoi assegnare permessi che non possiedi: ${missing.join(", ")}.`,
    };
  }

  return { allowed: true };
}

/**
 * Whether an actor may act on a target at all.
 *
 * Self-suspension and self-archival are refused outright. They are almost
 * always a mistake, and the one legitimate case — leaving the business — is
 * better done by a colleague who will still have access afterwards.
 */
export function canActOnStaff(
  actorUserId: string,
  targetUserId: string,
  action: "suspend" | "disable" | "archive" | "roles" | "revoke_sessions",
): GuardResult {
  if (actorUserId !== targetUserId) return { allowed: true };

  if (action === "revoke_sessions") return { allowed: true };

  if (action === "roles") {
    // Changing your OWN roles is allowed only in so far as the last-super-admin
    // guard permits it; that check runs separately and is the real constraint.
    return { allowed: true };
  }

  return {
    allowed: false,
    reason: "Non puoi sospendere, disattivare o archiviare il tuo stesso account.",
  };
}
