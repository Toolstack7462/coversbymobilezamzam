import { storefrontBrand } from "~/domain/content/brand";
import { Outlet, isRouteErrorResponse, useRouteError, Link } from "react-router";
import type { LinksFunction } from "react-router";
import type { Route } from "./+types/layout";
import { appContext } from "~/runtime/context";
import { requireEnrolledStaff } from "~/infrastructure/auth/session.server";
import { visibleNav } from "~/lib/admin-nav";
import { AdminShell } from "~/components/admin/admin-shell";
import adminStyles from "~/styles/admin.css?url";
import adminFormStyles from "~/styles/admin-forms.css?url";
import { SETTING_KEYS, type SettingsMap } from "~/domain/content/gates";

/**
 * The admin shell route.
 *
 * Every admin page inherits this loader, so no admin screen renders without an
 * authenticated staff session AND, for a privileged role, a verified second
 * factor. Individual routes then require their own specific permission — this
 * layout proves you are staff, not that you may do a particular thing.
 *
 * The stylesheet is imported HERE rather than in root, so the admin CSS is a
 * separate chunk that never reaches a customer browsing the shop.
 */

export const links: LinksFunction = () => [
  { rel: "stylesheet", href: adminFormStyles },
  { rel: "stylesheet", href: adminStyles },
];

export function meta() {
  return [{ name: "robots", content: "noindex, nofollow" }];
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const { env } = context.get(appContext);

  /**
   * Checked on EVERY request, not once after login. A one-time redirect is
   * skipped by deep-linking straight to the payment queue, which is exactly
   * the screen it protects.
   */
  const { actor, mustEnrol } = await requireEnrolledStaff(request, env);

  // Sidebar counts. One query, and only the counts this actor may act on -
  // a badge for a screen you cannot open is noise.
  const canSeePayments = actor.permissions.includes("payment.read");
  const canSeeInventory = actor.permissions.includes("inventory.read");

  /*
   * The shop's name, for the top bar.
   *
   * Read from the same settings the storefront reads, through the same
   * resolver, so the admin and the public site can never disagree about what
   * the shop is called. `null` rather than a fallback here: the shell decides
   * what to show when nothing is configured, and it must not be a guess.
   */
  const brandRows = await env.DB.prepare(
    `SELECT key, value FROM store_settings WHERE key IN (?1, ?2, ?3)`,
  )
    .bind(SETTING_KEYS.brandName, SETTING_KEYS.shopName, SETTING_KEYS.brandSecondary)
    .all<{ key: string; value: string | null }>();

  // A setting row with a NULL value is one the merchant has not filled in, and
  // `SettingsMap` holds present values only — an explicit null in the map would
  // read as "set to nothing" rather than "not set".
  const settings: SettingsMap = Object.fromEntries(
    brandRows.results
      .filter((r): r is { key: string; value: string } => r.value !== null)
      .map((r) => [r.key, r.value]),
  );
  const configuredBrand = storefrontBrand(settings, "Centro di controllo").full;

  const counts = await env.DB.prepare(
    `SELECT
       (SELECT COUNT(*) FROM order_payments
         WHERE status IN ('proof_received','under_verification')) AS payments_to_verify,
       (SELECT COUNT(*) FROM orders WHERE status = 'processing') AS pickups_to_prepare,
       (SELECT COUNT(*) FROM inventory_levels
         WHERE reorder_threshold IS NOT NULL
           AND (on_hand - reserved) <= reorder_threshold) AS low_stock`,
  ).first<{ payments_to_verify: number; pickups_to_prepare: number; low_stock: number }>();

  return {
    actor: { displayName: actor.displayName, roleCodes: actor.roleCodes },
    // Filtered on the SERVER: the browser is never sent the names of routes
    // this user cannot open.
    nav: visibleNav(actor.permissions),
    badges: {
      paymentsToVerify: canSeePayments ? (counts?.payments_to_verify ?? 0) : 0,
      pickupsToPrepare: canSeePayments ? (counts?.pickups_to_prepare ?? 0) : 0,
      lowStock: canSeeInventory ? (counts?.low_stock ?? 0) : 0,
    },
    environment: env.APP_ENV ?? "development",
    brand: configuredBrand,
    /*
     * The search is offered only to someone who can read something it returns.
     * Mirrored on the SERVER in routes/admin/search.tsx, which queries each
     * section only for an actor holding that section's permission — this flag
     * decides whether the box appears, not what it may find.
     */
    canSearch:
      actor.permissions.includes("product.read") ||
      actor.permissions.includes("order.read") ||
      actor.permissions.includes("device.read"),
    mustEnrol,
  };
}

export default function AdminLayout({ loaderData }: Route.ComponentProps) {
  return (
    <AdminShell
      nav={loaderData.nav}
      badges={loaderData.badges}
      actor={loaderData.actor}
      environment={loaderData.environment}
      brand={loaderData.brand}
      canSearch={loaderData.canSearch}
      mustEnrol={loaderData.mustEnrol}
    >
      <Outlet />
    </AdminShell>
  );
}

/**
 * 403 is shown, not redirected.
 *
 * A staff member who lacks a permission is already past the login form;
 * bouncing them back would be confusing and would teach them to re-enter
 * credentials at any obstacle.
 */
export function ErrorBoundary() {
  const error = useRouteError();

  if (isRouteErrorResponse(error) && error.status === 403) {
    return (
      <main id="main" className="page section">
        <div className="panel stack" style={{ maxWidth: "34rem" }}>
          <h1>Accesso non consentito</h1>
          <p className="muted">
            Il tuo account non ha i permessi necessari per questa sezione. Se pensi che sia un
            errore, chiedi a un amministratore.
          </p>
          <p>
            <Link className="btn btn--secondary" to="/admin">
              Torna alla panoramica
            </Link>
          </p>
        </div>
      </main>
    );
  }

  if (isRouteErrorResponse(error) && error.status === 404) {
    return (
      <main id="main" className="page section">
        <div className="panel stack" style={{ maxWidth: "34rem" }}>
          <h1>Pagina non trovata</h1>
          <p className="muted">Questa pagina non esiste o l&apos;elemento è stato rimosso.</p>
          <p>
            <Link className="btn btn--secondary" to="/admin">
              Torna alla panoramica
            </Link>
          </p>
        </div>
      </main>
    );
  }

  return (
    <main id="main" className="page section">
      <div className="panel stack" style={{ maxWidth: "34rem" }}>
        <h1>Si è verificato un errore</h1>
        <p className="muted">Riprova tra qualche istante. Se il problema persiste, contattaci.</p>
      </div>
    </main>
  );
}
