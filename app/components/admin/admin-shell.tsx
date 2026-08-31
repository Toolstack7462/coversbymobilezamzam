import { NavLink, Link, Form } from "react-router";
import type { NavGroup } from "~/lib/admin-nav";

/**
 * The admin shell: sidebar, top bar, page header.
 *
 * Deliberately server-rendered with no client state. The sidebar collapse is a
 * checkbox and CSS, and the mobile drawer is a `<details>` — both work before
 * any script loads and cost nothing in the bundle. A dashboard that needs
 * JavaScript to show its own navigation is a dashboard that is blank on a slow
 * connection.
 */

export interface ShellBadges {
  paymentsToVerify?: number;
  pickupsToPrepare?: number;
  lowStock?: number;
}

interface Props {
  nav: NavGroup[];
  badges: ShellBadges;
  actor: { displayName: string; roleCodes: readonly string[] };
  environment: string;
  /** Rendered when a privileged account has not yet enrolled in TOTP. */
  mustEnrol?: boolean | undefined;
  children: React.ReactNode;
}

export function AdminShell({ nav, badges, actor, environment, mustEnrol, children }: Props) {
  return (
    <div className="ac">
      {/* The toggle is a real checkbox so collapse survives without script. */}
      <input type="checkbox" id="ac-collapse" className="ac__collapse-input" />

      <header className="ac__topbar">
        <label htmlFor="ac-collapse" className="ac__icon-btn" title="Comprimi menu">
          <span className="visually-hidden">Comprimi o espandi il menu</span>
          <IconMenu />
        </label>

        <Link to="/admin" className="ac__brand">
          Centro di controllo
        </Link>

        {/*
          Environment badge. On production it is deliberately absent: a badge
          that is always there stops being read, and the one that matters is
          "you are on staging and think you are on production".
        */}
        {environment !== "production" ? (
          <span className="ac__env" title={`Ambiente: ${environment}`}>
            {environment}
          </span>
        ) : null}

        <div className="ac__topbar-spacer" />

        <a className="btn btn--ghost ac__hide-sm" href="/" target="_blank" rel="noreferrer">
          Vedi il sito
        </a>

        <Link className="btn btn--primary ac__hide-sm" to="/admin/prodotti/nuovo">
          Aggiungi prodotto
        </Link>

        <details className="ac__menu">
          <summary className="ac__icon-btn">
            <span className="visually-hidden">Menu account</span>
            <IconUser />
          </summary>
          <div className="ac__menu-panel">
            <p className="small">
              <strong>{actor.displayName}</strong>
              <br />
              <span className="muted caption">{actor.roleCodes.join(", ")}</span>
            </p>
            <Link to="/admin/sicurezza">Sicurezza</Link>
            <Link to="/admin/sicurezza/sessioni">Sessioni attive</Link>
            <Form method="post" action="/admin/esci">
              <button type="submit" className="btn btn--ghost">
                Esci
              </button>
            </Form>
          </div>
        </details>
      </header>

      <div className="ac__body">
        <nav className="ac__sidebar" aria-label="Navigazione amministrazione">
          {/* Mobile: a native disclosure, so it is keyboard-operable for free. */}
          <details className="ac__drawer">
            <summary className="ac__drawer-toggle">Menu</summary>
            <NavTree nav={nav} badges={badges} mustEnrol={mustEnrol} />
          </details>

          <div className="ac__nav-desktop">
            <NavTree nav={nav} badges={badges} mustEnrol={mustEnrol} />
          </div>
        </nav>

        <main id="main" className="ac__main">
          {children}
        </main>
      </div>
    </div>
  );
}

function NavTree({
  nav,
  badges,
  mustEnrol,
}: {
  nav: NavGroup[];
  badges: ShellBadges;
  mustEnrol?: boolean | undefined;
}) {
  if (mustEnrol) {
    // A privileged account without TOTP can reach almost nothing, so offering
    // the full menu would just produce a wall of redirects.
    return (
      <ul className="ac__nav-list">
        <li>
          <NavLink to="/admin/sicurezza/2fa" className="ac__nav-link">
            Attiva 2FA
          </NavLink>
        </li>
        <li>
          <NavLink to="/admin/sicurezza" className="ac__nav-link">
            Sicurezza
          </NavLink>
        </li>
      </ul>
    );
  }

  return (
    <>
      {nav.map((group) => (
        <div key={group.label} className="ac__nav-group">
          <h2 className="ac__nav-heading">{group.label}</h2>
          <ul className="ac__nav-list">
            {group.items.map((item) => {
              const badge = item.badgeKey ? badges[item.badgeKey] : undefined;
              return (
                <li key={item.to}>
                  <NavLink
                    to={item.to}
                    end={item.end ?? false}
                    className={({ isActive }) =>
                      isActive ? "ac__nav-link ac__nav-link--active" : "ac__nav-link"
                    }
                  >
                    <span className="ac__nav-label">{item.label}</span>
                    {badge && badge > 0 ? (
                      <span className="ac__nav-badge" aria-label={`${badge} da gestire`}>
                        {badge}
                      </span>
                    ) : null}
                  </NavLink>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </>
  );
}

/**
 * Page header.
 *
 * One primary action, at most. Two competing primaries mean the merchant reads
 * both and trusts neither.
 */
export function PageHeader({
  title,
  description,
  breadcrumbs,
  primaryAction,
  secondaryActions,
}: {
  title: string;
  description?: string;
  breadcrumbs?: { label: string; to?: string }[];
  primaryAction?: { label: string; to: string };
  secondaryActions?: { label: string; to: string }[];
}) {
  return (
    <div className="ac__page-header">
      {breadcrumbs && breadcrumbs.length > 1 ? (
        <nav aria-label="Percorso" className="ac__crumbs small">
          {breadcrumbs.map((crumb, i) => (
            <span key={i}>
              {i > 0 ? <span aria-hidden="true"> / </span> : null}
              {crumb.to ? <Link to={crumb.to}>{crumb.label}</Link> : <span>{crumb.label}</span>}
            </span>
          ))}
        </nav>
      ) : null}

      <div className="ac__page-title-row">
        <div>
          <h1>{title}</h1>
          {description ? <p className="muted small">{description}</p> : null}
        </div>

        <div className="cluster">
          {secondaryActions?.map((a) => (
            <Link key={a.to} to={a.to} className="btn btn--secondary">
              {a.label}
            </Link>
          ))}
          {primaryAction ? (
            <Link to={primaryAction.to} className="btn btn--primary">
              {primaryAction.label}
            </Link>
          ) : null}
        </div>
      </div>
    </div>
  );
}

// ── Icons. Inline SVG from the project's own set; never emoji. ──────────────

const iconProps = {
  width: 20,
  height: 20,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.8,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
  focusable: false,
};

function IconMenu() {
  return (
    <svg {...iconProps}>
      <path d="M4 6h16M4 12h16M4 18h16" />
    </svg>
  );
}

function IconUser() {
  return (
    <svg {...iconProps}>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21a8 8 0 0 1 16 0" />
    </svg>
  );
}
