import { describe, it, expect } from "vitest";
import {
  canChangeStatus,
  allowedStatusChanges,
  isUsableStatus,
  activeSuperAdmins,
  wouldOrphanSuperAdmin,
  guardLastSuperAdmin,
  canGrantRole,
  canActOnStaff,
  STAFF_STATUSES,
  type StaffSummary,
} from "~/domain/users/staff-guards";

/**
 * The rules that stop an administrator locking the shop out of its own admin
 * panel, or quietly promoting themselves.
 */

const superAdmin = (id: string, status: StaffSummary["status"] = "active"): StaffSummary => ({
  userId: id,
  status,
  roleCodes: ["super_admin"],
});

const ordinary = (id: string, status: StaffSummary["status"] = "active"): StaffSummary => ({
  userId: id,
  status,
  roleCodes: ["order_manager"],
});

describe("the last super admin", () => {
  it("refuses to let the only administrator remove their own role", () => {
    const staff = [superAdmin("a"), ordinary("b")];
    expect(
      wouldOrphanSuperAdmin(staff, { targetUserId: "a", resultingRoleCodes: ["order_manager"] }),
    ).toBe(true);
  });

  it("refuses to let the only administrator suspend themselves", () => {
    const staff = [superAdmin("a"), ordinary("b")];
    expect(wouldOrphanSuperAdmin(staff, { targetUserId: "a", resultingStatus: "suspended" })).toBe(
      true,
    );
  });

  it("refuses to let the only administrator be disabled", () => {
    const staff = [superAdmin("a")];
    expect(wouldOrphanSuperAdmin(staff, { targetUserId: "a", resultingStatus: "disabled" })).toBe(
      true,
    );
  });

  it("refuses to let the only administrator be archived", () => {
    const staff = [superAdmin("a")];
    expect(wouldOrphanSuperAdmin(staff, { targetUserId: "a", resultingStatus: "archived" })).toBe(
      true,
    );
  });

  it("covers demotion BY SOMEONE ELSE, not just self-demotion", () => {
    // Blocking only "remove your own role" leaves the same outcome reachable by
    // a second administrator demoting the first.
    const staff = [superAdmin("a"), superAdmin("b")];
    // Demoting one of two is fine...
    expect(wouldOrphanSuperAdmin(staff, { targetUserId: "a", resultingRoleCodes: [] })).toBe(false);
    // ...but then demoting the other is not.
    const afterFirst = [ordinary("a"), superAdmin("b")];
    expect(wouldOrphanSuperAdmin(afterFirst, { targetUserId: "b", resultingRoleCodes: [] })).toBe(
      true,
    );
  });

  it("allows the change when another ACTIVE administrator remains", () => {
    const staff = [superAdmin("a"), superAdmin("b")];
    expect(guardLastSuperAdmin(staff, { targetUserId: "a", resultingStatus: "suspended" })).toEqual(
      { allowed: true },
    );
  });

  it("does not count a SUSPENDED administrator as cover", () => {
    // A suspended account cannot sign in, so it is not a way back into the
    // system. Counting it would produce exactly the lockout this prevents.
    const staff = [superAdmin("a"), superAdmin("b", "suspended")];
    expect(wouldOrphanSuperAdmin(staff, { targetUserId: "a", resultingStatus: "disabled" })).toBe(
      true,
    );
  });

  it("does not count an INVITED administrator as cover", () => {
    // An invitation that nobody has accepted is not an administrator.
    const staff = [superAdmin("a"), superAdmin("b", "invited")];
    expect(wouldOrphanSuperAdmin(staff, { targetUserId: "a", resultingStatus: "archived" })).toBe(
      true,
    );
  });

  it("gives a reason a human can act on", () => {
    const result = guardLastSuperAdmin([superAdmin("a")], {
      targetUserId: "a",
      resultingStatus: "suspended",
    });
    expect(result.allowed).toBe(false);
    if (!result.allowed) {
      expect(result.reason).toContain("almeno un amministratore attivo");
    }
  });

  it("counts active super admins correctly", () => {
    const staff = [superAdmin("a"), superAdmin("b", "suspended"), ordinary("c")];
    expect(activeSuperAdmins(staff).map((s) => s.userId)).toEqual(["a"]);
  });
});

describe("granting roles", () => {
  const roleManager = {
    permissions: ["staff.roles", "order.read", "order.write"],
    roleCodes: ["order_manager"],
  };
  const admin = {
    permissions: ["staff.roles", "payment.settings", "payment.verify", "order.read"],
    roleCodes: ["super_admin"],
  };

  it("refuses without staff.roles", () => {
    const result = canGrantRole(
      { permissions: ["order.read"], roleCodes: [] },
      { code: "store_staff", permissions: ["order.read"] },
    );
    expect(result.allowed).toBe(false);
  });

  it("lets only a super admin grant super_admin", () => {
    expect(
      canGrantRole(roleManager, { code: "super_admin", permissions: ["order.read"] }).allowed,
    ).toBe(false);
    expect(canGrantRole(admin, { code: "super_admin", permissions: ["order.read"] }).allowed).toBe(
      true,
    );
  });

  it("refuses to let anyone grant a permission they do not hold", () => {
    // The indirect self-promotion route: mint a role containing
    // payment.settings, assign it to yourself.
    const result = canGrantRole(roleManager, {
      code: "payment_verifier",
      permissions: ["payment.verify"],
    });
    expect(result.allowed).toBe(false);
    if (!result.allowed) expect(result.reason).toContain("payment.verify");
  });

  it("allows granting a subset of what the actor holds", () => {
    expect(
      canGrantRole(roleManager, { code: "store_staff", permissions: ["order.read"] }).allowed,
    ).toBe(true);
  });
});

describe("acting on your own account", () => {
  it("refuses self-suspension, self-disable and self-archive", () => {
    for (const action of ["suspend", "disable", "archive"] as const) {
      const result = canActOnStaff("a", "a", action);
      expect(result.allowed, `${action} on self must be refused`).toBe(false);
    }
  });

  it("allows revoking your own sessions", () => {
    // Signing yourself out everywhere is a normal, safe thing to want.
    expect(canActOnStaff("a", "a", "revoke_sessions").allowed).toBe(true);
  });

  it("allows acting on somebody else", () => {
    expect(canActOnStaff("a", "b", "suspend").allowed).toBe(true);
  });
});

describe("status transitions", () => {
  it("treats only active as usable", () => {
    expect(isUsableStatus("active")).toBe(true);
    for (const s of STAFF_STATUSES.filter((x) => x !== "active")) {
      expect(isUsableStatus(s), `${s} must not be usable`).toBe(false);
    }
  });

  it("makes archived terminal", () => {
    expect(allowedStatusChanges("archived")).toEqual([]);
  });

  it("lets suspension be reversed but keeps disablement deliberate", () => {
    expect(canChangeStatus("suspended", "active")).toBe(true);
    expect(canChangeStatus("disabled", "active")).toBe(true);
  });

  it("refuses to resurrect an archived account", () => {
    expect(canChangeStatus("archived", "active")).toBe(false);
  });

  it("rejects the full cartesian product of illegal transitions", () => {
    for (const from of STAFF_STATUSES) {
      const allowed = allowedStatusChanges(from);
      for (const to of STAFF_STATUSES) {
        if (!allowed.includes(to)) {
          expect(canChangeStatus(from, to), `${from} -> ${to} must be refused`).toBe(false);
        }
      }
    }
  });
});
