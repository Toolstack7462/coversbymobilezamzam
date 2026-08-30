import { describe, it, expect } from "vitest";
import {
  DEFAULT_ROLE_PERMISSIONS,
  PERMISSIONS,
  hasPermission,
  hasAllPermissions,
  requiresStepUp,
  canGrant,
} from "~/domain/users/permissions";

describe("separation of duties", () => {
  it("gives no role except super_admin both payment.verify and payment.settings", () => {
    // Anyone holding both can redirect payments AND confirm they arrived.
    for (const [role, perms] of Object.entries(DEFAULT_ROLE_PERMISSIONS)) {
      if (role === "super_admin") continue;
      const both = perms.includes("payment.verify") && perms.includes("payment.settings");
      expect(both, `${role} must not hold both payment permissions`).toBe(false);
    }
  });

  it("does not let an order manager verify payments", () => {
    // The person who creates and edits orders should not also declare them paid.
    expect(DEFAULT_ROLE_PERMISSIONS.order_manager).not.toContain("payment.verify");
  });

  it("does not let a payment verifier change where money goes", () => {
    expect(DEFAULT_ROLE_PERMISSIONS.payment_verifier).not.toContain("payment.settings");
  });

  it("does not let a payment verifier see cost prices", () => {
    expect(DEFAULT_ROLE_PERMISSIONS.payment_verifier).not.toContain("price.cost.read");
  });

  it("keeps banking configuration away from store staff", () => {
    expect(DEFAULT_ROLE_PERMISSIONS.store_staff).not.toContain("payment.settings");
    expect(DEFAULT_ROLE_PERMISSIONS.store_staff).not.toContain("settings.write");
    expect(DEFAULT_ROLE_PERMISSIONS.store_staff).not.toContain("staff.roles");
  });

  it("gives only super_admin the ability to change roles", () => {
    for (const [role, perms] of Object.entries(DEFAULT_ROLE_PERMISSIONS)) {
      if (role === "super_admin") continue;
      expect(perms, `${role} must not manage roles`).not.toContain("staff.roles");
    }
  });

  it("keeps catalogue managers out of payments entirely", () => {
    const perms = DEFAULT_ROLE_PERMISSIONS.catalogue_manager;
    expect(perms.some((p) => p.startsWith("payment."))).toBe(false);
  });

  it("gives super_admin everything", () => {
    expect(DEFAULT_ROLE_PERMISSIONS.super_admin).toEqual(PERMISSIONS);
  });
});

describe("step-up", () => {
  it("is required exactly where a stolen session does most damage", () => {
    expect(requiresStepUp("payment.verify")).toBe(true);
    expect(requiresStepUp("payment.settings")).toBe(true);
    expect(requiresStepUp("staff.roles")).toBe(true);
    expect(requiresStepUp("product.write")).toBe(false);
    expect(requiresStepUp("order.read")).toBe(false);
  });
});

describe("checks", () => {
  it("answers a single permission", () => {
    expect(hasPermission(["order.read"], "order.read")).toBe(true);
    expect(hasPermission(["order.read"], "order.write")).toBe(false);
  });

  it("answers a set", () => {
    expect(
      hasAllPermissions(["a", "order.read", "order.write"], ["order.read", "order.write"]),
    ).toBe(true);
    expect(hasAllPermissions(["order.read"], ["order.read", "order.write"])).toBe(false);
  });
});

describe("canGrant", () => {
  it("refuses to let a user grant what they do not hold", () => {
    // Otherwise any holder of staff.roles could quietly promote themselves.
    expect(canGrant(["staff.roles"], "payment.verify")).toBe(false);
    expect(canGrant(["staff.roles", "payment.verify"], "payment.verify")).toBe(true);
  });

  it("refuses without staff.roles at all", () => {
    expect(canGrant(["payment.verify"], "payment.verify")).toBe(false);
  });
});
