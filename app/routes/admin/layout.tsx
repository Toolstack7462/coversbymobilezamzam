import { Outlet, NavLink, Form, isRouteErrorResponse, useRouteError } from "react-router";
import type { Route } from "./+types/layout";
import { cloudflareContext } from "../../../workers/app";
import { requireEnrolledStaff } from "~/infrastructure/auth/session.server";

/**
 * The admin shell.
 *
 * Every admin route inherits this loader, so **no admin page renders without an
 * authenticated staff session**. Individual routes then require their own
 * specific permission — this layout proves you are staff, not that you may do
 * a particular thing.
 */

export function meta() {
  return [{ name: "robots", content: "noindex, nofollow" }];
}

/** Nav entries appear only when the actor holds the permission. */
const NAV = [
  { to: "/admin", label: "Dashboard", permission: null, end: true },
  { to: "/admin/pagamenti", label: "Pagamenti", permission: "payment.read" },
  { to: "/admin/ordini", label: "Ordini", permission: "order.read" },
  { to: "/admin/prodotti", label: "Prodotti", permission: "product.read" },
  { to: "/admin/inventario", label: "Inventario", permission: "inventory.read" },
  { to: "/admin/personale", label: "Personale", permission: "staff.read" },
  { to: "/admin/impostazioni", label: "Impostazioni", permission: "settings.read" },
  { to: "/admin/registro", label: "Registro attività", permission: "audit.read" },
] as const;

export async function loader({ request, context }: Route.LoaderArgs) {
  const { env } = context.get(cloudflareContext);

  /**
   * Enrolment is checked on EVERY request, not once after login.
   *
   * A one-time redirect would be skipped by deep-linking straight to a payment
   * screen, which is precisely the screen it is protecting.
   */
  const { actor, mustEnrol } = await requireEnrolledStaff(request, env);

  return {
    displayName: actor.displayName,
    email: actor.email,
    permissions: actor.permissions,
    roleCodes: actor.roleCodes,
    mustEnrol,
  };
}

export default function AdminLayout({ loaderData }: Route.ComponentProps) {
  const { displayName, permissions, roleCodes, mustEnrol } = loaderData;

  // While enrolment is outstanding the operational nav is hidden entirely -
  // every one of those routes would refuse the request anyway, so offering
  // them would only produce a wall of redirects.
  const visible = mustEnrol
    ? []
    : NAV.filter((item) => item.permission === null || permissions.includes(item.permission));

  return (
    <div className="admin">
      <header className="admin__bar">
        <div className="admin__brand">
          <span>Amministrazione</span>
          {/* No customer-facing brand here: this tool is not the shop, and the
              shop may not even have a public name configured yet. */}
        </div>

        <div className="admin__actor">
          <span className="small">{displayName}</span>
          <span className="caption muted">{roleCodes.join(", ")}</span>
          <a className="btn btn--ghost" href="/admin/sicurezza">
            Sicurezza
          </a>
          <Form method="post" action="/admin/esci">
            <button type="submit" className="btn btn--ghost">
              Esci
            </button>
          </Form>
        </div>
      </header>

      <div className="admin__body">
        <nav className="admin__nav" aria-label="Navigazione amministrazione">
          <ul>
            {mustEnrol ? (
              <li>
                <NavLink to="/admin/sicurezza/2fa" className="admin__nav-link">
                  Attiva 2FA
                </NavLink>
              </li>
            ) : null}
            {visible.map((item) => (
              <li key={item.to}>
                <NavLink
                  to={item.to}
                  end={"end" in item ? item.end : false}
                  className={({ isActive }) =>
                    isActive ? "admin__nav-link admin__nav-link--active" : "admin__nav-link"
                  }
                >
                  {item.label}
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>

        <main id="main" className="admin__main">
          <Outlet />
        </main>
      </div>
    </div>
  );
}

/**
 * 403 is shown, not redirected.
 *
 * A staff member who lacks a permission is already past the login form;
 * bouncing them back to it would be confusing and would teach them to
 * re-enter credentials at any obstacle.
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
            <a className="btn btn--secondary" href="/admin">
              Torna alla dashboard
            </a>
          </p>
        </div>
      </main>
    );
  }

  return (
    <main id="main" className="page section">
      <div className="panel stack" style={{ maxWidth: "34rem" }}>
        <h1>Si è verificato un errore</h1>
        <p className="muted">Riprova tra qualche istante.</p>
      </div>
    </main>
  );
}
