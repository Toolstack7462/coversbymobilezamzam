import {
  type RouteConfig,
  type RouteConfigEntry,
  index,
  route,
  prefix,
  layout,
} from "@react-router/dev/routes";

/**
 * Routes.
 *
 * Italian paths are canonical and carry no prefix; English mirrors them under
 * `/en`. One page, one address per language (ADR 0009).
 *
 * Paths are Italian words because the audience is Italian and the URL is part
 * of the interface.
 *
 * The same route modules are mounted twice, so each copy needs an explicit
 * unique id - React Router derives ids from the file path, which would collide.
 */
function storefrontRoutes(idSuffix: string): RouteConfigEntry[] {
  const id = (name: string) => ({ id: `${name}${idSuffix}` });

  return [
    index("routes/storefront/home.tsx", id("home")),
    route("shop", "routes/storefront/collection.tsx", id("collection")),
    route("prodotti/:slug", "routes/storefront/product.tsx", id("product")),
    route("trova-dispositivo", "routes/storefront/device-finder.tsx", id("device-finder")),
    route("carrello", "routes/storefront/cart.tsx", id("cart")),
    route("cassa", "routes/storefront/checkout.tsx", id("checkout")),
    route(
      "ordine/:orderNumber",
      "routes/storefront/order-confirmation.tsx",
      id("order-confirmation"),
    ),
    route("traccia/:token", "routes/storefront/order-tracking.tsx", id("order-tracking")),
    route("negozio", "routes/storefront/store.tsx", id("store")),
  ];
}

export default [
  layout("routes/storefront/layout.tsx", [
    ...storefrontRoutes("-it"),
    ...prefix("en", storefrontRoutes("-en")),
  ]),

  // Better Auth owns everything under /api/auth.
  route("api/auth/*", "routes/api/auth.tsx"),

  /**
   * Admin. Italian only - it is a staff tool, and the staff are Italian.
   *
   * The login page sits OUTSIDE the protected layout: a route that requires a
   * session cannot host the form that creates one.
   */
  route("admin/accedi", "routes/admin/login.tsx"),
  route("admin/installazione", "routes/admin/setup.tsx"),
  /**
   * The second-factor challenge is OUTSIDE the protected layout: at that point
   * the password has been accepted but no session exists yet, so a route that
   * required one could never be reached.
   */
  route("admin/sicurezza/2fa/verifica", "routes/admin/security-2fa-verify.tsx"),
  /**
   * Invitation acceptance is PUBLIC by necessity: the invitee has no account
   * yet. The token is the only credential, which is why it is single-use,
   * expiring, scoped to one address and stored hashed.
   */
  route("admin/personale/invito/:token", "routes/admin/staff-accept.tsx"),
  route("admin/esci", "routes/admin/logout.tsx"),

  layout("routes/admin/layout.tsx", [
    route("admin", "routes/admin/dashboard.tsx"),
    route("admin/pagamenti", "routes/admin/payments.tsx"),
    route("admin/ordini", "routes/admin/orders.tsx"),
    route("admin/prodotti", "routes/admin/products.tsx"),
    route("admin/inventario", "routes/admin/inventory.tsx"),
    route("admin/impostazioni", "routes/admin/settings.tsx"),
    route("admin/registro", "routes/admin/audit.tsx"),
    route("admin/personale", "routes/admin/staff.tsx"),
    route("admin/personale/:staffId", "routes/admin/staff-detail.tsx"),

    // Own-account security. These sit on the pre-enrolment allowlist, because
    // a page that required enrolment in order to enrol would be a locked door
    // with the key inside.
    route("admin/sicurezza", "routes/admin/security.tsx"),
    route("admin/sicurezza/2fa", "routes/admin/security-2fa.tsx"),
    route("admin/sicurezza/2fa/configura", "routes/admin/security-2fa-setup.tsx"),
    route("admin/sicurezza/codici-recupero", "routes/admin/security-backup-codes.tsx"),
    route("admin/sicurezza/sessioni", "routes/admin/security-sessions.tsx"),
  ]),
] satisfies RouteConfig;
