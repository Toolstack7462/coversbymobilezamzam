import { describe, it, expect } from "vitest";
import {
  TOTP_REQUIRED_PERMISSIONS,
  requiresTwoFactor,
  isPreEnrolmentPath,
  PRE_ENROLMENT_ALLOWLIST,
  type StaffActor,
} from "~/infrastructure/auth/session.server";
import { DEFAULT_ROLE_PERMISSIONS } from "~/domain/users/permissions";

/**
 * Which accounts must enrol, and what they may reach before they do.
 *
 * The TOTP cryptography belongs to Better Auth and is not re-tested here. What
 * IS this project's responsibility is the policy: who is obliged to enrol, and
 * exactly how little an unenrolled privileged account can do.
 */

const actor = (permissions: string[]): StaffActor => ({
  userId: "user_1",
  email: "staff@example.test",
  displayName: "Staff",
  permissions,
  roleCodes: ["test"],
});

describe("who must enrol", () => {
  it("obliges anyone who can declare money received", () => {
    expect(requiresTwoFactor(actor(["payment.verify"]))).toBe(true);
  });

  it("obliges anyone who can change where money goes", () => {
    expect(requiresTwoFactor(actor(["payment.settings"]))).toBe(true);
  });

  it("obliges anyone who can grant those powers to someone else", () => {
    // The indirect route matters as much as the direct one: a role granter can
    // simply give themselves payment.verify tomorrow.
    expect(requiresTwoFactor(actor(["staff.roles"]))).toBe(true);
    expect(requiresTwoFactor(actor(["staff.write"]))).toBe(true);
  });

  it("obliges anyone who can move money back out", () => {
    expect(requiresTwoFactor(actor(["order.refund"]))).toBe(true);
  });

  it("does NOT oblige read-only or catalogue-only staff", () => {
    // Enrolment has a real cost. Imposing it where the blast radius is a typo
    // in a product description teaches people that security is theatre.
    expect(requiresTwoFactor(actor(["product.read", "inventory.read", "order.read"]))).toBe(false);
    expect(requiresTwoFactor(actor(["product.write", "content.write"]))).toBe(false);
  });

  it("obliges every default role that holds a privileged permission", () => {
    const obliged = Object.entries(DEFAULT_ROLE_PERMISSIONS)
      .filter(([, perms]) => requiresTwoFactor(actor([...perms])))
      .map(([role]) => role);

    expect(obliged).toContain("super_admin");
    expect(obliged).toContain("payment_verifier");
    expect(obliged).toContain("order_manager"); // holds order.refund

    // These hold nothing that moves money.
    expect(obliged).not.toContain("store_staff");
    expect(obliged).not.toContain("catalogue_manager");
    expect(obliged).not.toContain("inventory_manager");
  });

  it("lists every privileged permission explicitly", () => {
    // A permission added to the system without a decision about 2FA should be
    // visible as an omission here, not silently default to "not required".
    expect([...TOTP_REQUIRED_PERMISSIONS].sort()).toEqual([
      "order.refund",
      "payment.settings",
      "payment.verify",
      "settings.write",
      "staff.roles",
      "staff.write",
    ]);
  });
});

describe("what an unenrolled privileged account may reach", () => {
  it("allows only enrolment, recovery, sessions, profile, help and sign-out", () => {
    for (const path of PRE_ENROLMENT_ALLOWLIST) {
      expect(isPreEnrolmentPath(path)).toBe(true);
    }
  });

  it("refuses every operational admin route", () => {
    // The list that matters: none of these may be reachable before enrolment.
    const operational = [
      "/admin",
      "/admin/pagamenti",
      "/admin/ordini",
      "/admin/prodotti",
      "/admin/inventario",
      "/admin/impostazioni",
      "/admin/registro",
      "/admin/personale",
    ];
    for (const path of operational) {
      expect(isPreEnrolmentPath(path), `${path} must be refused`).toBe(false);
    }
  });

  it("allows sub-paths of an allowlisted route", () => {
    expect(isPreEnrolmentPath("/admin/sicurezza/2fa/configura")).toBe(true);
    expect(isPreEnrolmentPath("/admin/sicurezza/sessioni")).toBe(true);
  });

  it("does not allow a route that merely starts with an allowlisted string", () => {
    // "/admin/sicurezza-finta" must not pass because it shares a prefix with
    // "/admin/sicurezza".
    expect(isPreEnrolmentPath("/admin/sicurezza-finta")).toBe(false);
    expect(isPreEnrolmentPath("/admin/profilo-altrui")).toBe(false);
  });

  it("keeps sign-out reachable", () => {
    // An account that cannot enrol and cannot leave is a trap.
    expect(isPreEnrolmentPath("/admin/esci")).toBe(true);
  });
});
