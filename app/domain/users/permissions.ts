/**
 * Permissions and roles.
 *
 * Roles are DATA - stored in `roles` and `role_permissions` so the merchant can
 * create one without a deployment. What is defined here is the vocabulary of
 * permissions and the defaults that are seeded.
 */

export const PERMISSIONS = [
  "product.read",
  "product.write",
  "product.archive",
  "price.read",
  "price.write",
  "price.cost.read",
  "inventory.read",
  "inventory.adjust",
  "inventory.transfer",
  "order.read",
  "order.write",
  "order.cancel",
  "order.refund",
  "payment.read",
  "payment.verify",
  "payment.settings",
  "content.read",
  "content.write",
  "content.publish",
  "customer.read",
  "customer.write",
  "staff.read",
  "staff.write",
  "staff.roles",
  "settings.read",
  "settings.write",
  "audit.read",
  "import.run",
  "export.run",
] as const;

export type Permission = (typeof PERMISSIONS)[number];

export const ROLE_CODES = [
  "super_admin",
  "catalogue_manager",
  "price_manager",
  "inventory_manager",
  "order_manager",
  "payment_verifier",
  "store_staff",
] as const;

export type RoleCode = (typeof ROLE_CODES)[number];

/**
 * Default role grants.
 *
 * Two separations are deliberate and should survive any future edit:
 *
 * 1. `payment.verify` (did the money arrive?) is separate from
 *    `payment.settings` (where does money go?). Anyone holding both can
 *    redirect payments and then confirm they arrived.
 * 2. Order managers cannot verify payments. The person who creates and edits
 *    orders should not also declare them paid - ordinary separation of duties.
 */
export const DEFAULT_ROLE_PERMISSIONS: Readonly<Record<RoleCode, readonly Permission[]>> = {
  super_admin: PERMISSIONS,

  catalogue_manager: [
    "product.read",
    "product.write",
    "product.archive",
    "price.read",
    "inventory.read",
    "content.read",
    "content.write",
    "import.run",
    "export.run",
  ],

  price_manager: ["product.read", "price.read", "price.write", "price.cost.read", "export.run"],

  inventory_manager: [
    "product.read",
    "inventory.read",
    "inventory.adjust",
    "inventory.transfer",
    "order.read",
    "import.run",
    "export.run",
  ],

  order_manager: [
    "product.read",
    "inventory.read",
    "order.read",
    "order.write",
    "order.cancel",
    "order.refund",
    "payment.read",
    "customer.read",
    "customer.write",
    "export.run",
  ],

  payment_verifier: ["order.read", "payment.read", "payment.verify", "customer.read"],

  store_staff: ["product.read", "inventory.read", "order.read", "order.write", "customer.read"],
} as const;

/**
 * Actions that require step-up authentication regardless of an active session.
 *
 * These are where a borrowed laptop or a stolen session cookie does the most
 * damage, so possession of a session is not treated as intent.
 */
export const STEP_UP_REQUIRED: readonly Permission[] = [
  "payment.verify",
  "payment.settings",
  "staff.roles",
];

export function requiresStepUp(permission: Permission): boolean {
  return STEP_UP_REQUIRED.includes(permission);
}

export function hasPermission(granted: readonly string[], required: Permission): boolean {
  return granted.includes(required);
}

export function hasAllPermissions(
  granted: readonly string[],
  required: readonly Permission[],
): boolean {
  return required.every((p) => granted.includes(p));
}

export function hasAnyPermission(
  granted: readonly string[],
  required: readonly Permission[],
): boolean {
  return required.some((p) => granted.includes(p));
}

export function isPermission(value: string): value is Permission {
  return (PERMISSIONS as readonly string[]).includes(value);
}

/** Grouping for the admin UI only. Carries no authorisation meaning. */
export function permissionCategory(permission: Permission): string {
  return permission.split(".")[0]!;
}

/**
 * Whether a user may grant a permission to someone else.
 *
 * A user can never grant what they do not hold. Without this, any holder of
 * `staff.roles` could quietly promote themselves to everything.
 */
export function canGrant(
  granterPermissions: readonly string[],
  permissionToGrant: Permission,
): boolean {
  return (
    granterPermissions.includes("staff.roles") && granterPermissions.includes(permissionToGrant)
  );
}
