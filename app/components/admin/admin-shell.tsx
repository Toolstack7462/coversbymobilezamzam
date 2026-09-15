import { AdminLanguageSwitcher } from "./language-switcher";
import { useAdminTranslator } from "~/components/admin/use-admin-translator";
import { BrandSymbol } from "~/components/storefront/brand-symbol";
import { BrandLockup } from "~/components/storefront/brand-lockup";
import type { StorefrontBrand } from "~/domain/content/brand";
import { NavLink, Link, Form, useLocation, useNavigation } from "react-router";
import type { NavGroup } from "~/lib/admin-nav";

/**
 * The admin shell: sidebar, top bar, page header.
 *
 * Deliberately server-rendered. The sidebar collapse is a
 * checkbox and CSS, and the mobile drawer is a `<details>` — both work before
 * any script loads and cost nothing in the bundle. A dashboard that needs
 * JavaScript to show its own navigation is a dashboard that is blank on a slow
 * connection. The router's pending indicator progressively adds feedback after
 * hydration; it does not control navigation visibility or require local state.
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
  /** The same resolved merchant identity used on the storefront and sign-in. */
  brand: StorefrontBrand;
  /** Whether this actor may use the global search at all. */
  canSearch: boolean;
  /** Rendered when a privileged account has not yet enrolled in TOTP. */
  mustEnrol?: boolean | undefined;
  children: React.ReactNode;
}

export function AdminShell({
  nav,
  badges,
  actor,
  environment,
  brand,
  canSearch,
  mustEnrol,
  children,
}: Props) {
  const t = useAdminTranslator();
  const pending = useNavigation().state !== "idle";
  return (
    <div className="ac ac--depth">
      {pending ? (
        <div className="ac__pending" role="status">
          <span className="visually-hidden">{t("Caricamento")}</span>
          <span className="ac__pending-line" aria-hidden="true" />
        </div>
      ) : null}
      {/* The toggle is a real checkbox so collapse survives without script. */}
      <input type="checkbox" id="ac-collapse" className="ac__collapse-input" />

      <header className="ac__topbar">
        <label htmlFor="ac-collapse" className="ac__icon-btn" title={t("Comprimi menu")}>
          <span className="visually-hidden">{t("Comprimi o espandi il menu")}</span>
          <IconMenu />
        </label>

        <BrandLockup brand={brand} locale={t.locale} variant="admin" />

        {/*
          Environment badge. On production it is deliberately absent: a badge
          that is always there stops being read, and the one that matters is
          "you are on staging and think you are on production".
        */}
        {environment !== "production" ? (
          <span className="ac__env" title={t("Ambiente: {{v0}}", { v0: environment })}>
            {environment}
          </span>
        ) : null}

        {/*
          Global search.

          A GET form, so the result is a shareable URL and the back button
          works — and so it functions before any script loads, like the rest of
          this shell.

          Absent entirely for an actor with no read permission on anything it
          searches. Not disabled: a box that is visible and refuses is an
          invitation to work out what is behind it.
        */}
        {canSearch ? (
          <form className="ac__search ac__hide-sm" role="search" action="/admin/cerca" method="get">
            <label className="visually-hidden" htmlFor="ac-topbar-q">
              {t("Cerca in tutto il pannello")}
            </label>
            <input
              id="ac-topbar-q"
              type="search"
              name="q"
              maxLength={64}
              placeholder={t("Cerca ordine, SKU, cliente…")}
            />
          </form>
        ) : null}

        <div className="ac__topbar-spacer" />
        <AdminLanguageSwitcher />
        {canSearch ? (
          <Link
            to="/admin/cerca"
            className="ac__icon-btn ac__mobile-search"
            aria-label={t("Cerca nel pannello")}
          >
            <svg {...iconProps}>
              <circle cx="10" cy="10" r="6" />
              <path d="m15 15 5 5" />
            </svg>
          </Link>
        ) : null}

        {/*
          "Vedi il sito" stays; "Aggiungi prodotto" does not.

          It used to sit here AND in the page header of the products screen, so
          two identical primary buttons faced each other on the same page. A
          global bar should carry what is true everywhere — the shop, the
          account — and adding a product is not something you do from the
          settings screen. It lives where its context is.
        */}
        <a
          className="btn btn--ghost ac__hide-sm"
          href={t.locale === "en" ? "/en/" : "/"}
          target="_blank"
          rel="noreferrer"
        >
          {t("Vedi il sito")}
        </a>

        <details className="ac__menu">
          <summary className="ac__icon-btn">
            <span className="visually-hidden">{t("Menu account")}</span>
            <IconUser />
          </summary>
          <div className="ac__menu-panel">
            <p className="small">
              <strong>{actor.displayName}</strong>
              <br />
              <span className="muted caption">{actor.roleCodes.join(", ")}</span>
            </p>
            <Link to="/admin/sicurezza">{t("Sicurezza")}</Link>
            <Link to="/admin/sicurezza/sessioni">{t("Sessioni attive")}</Link>
            <Form method="post" action="/admin/esci">
              <button type="submit" className="btn btn--ghost">
                {t("Esci")}
              </button>
            </Form>
          </div>
        </details>
      </header>

      <div className="ac__body">
        <nav className="ac__sidebar" aria-label={t("Navigazione amministrazione")}>
          {/* Mobile: a native disclosure, so it is keyboard-operable for free. */}
          <details className="ac__drawer">
            <summary className="ac__drawer-toggle">Menu</summary>
            <NavTree nav={nav} badges={badges} mustEnrol={mustEnrol} />
          </details>

          <div className="ac__nav-desktop">
            <NavTree nav={nav} badges={badges} mustEnrol={mustEnrol} />
          </div>
        </nav>

        <main id="main" className="ac__main" aria-busy={pending}>
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
  const t = useAdminTranslator();
  const { pathname } = useLocation();
  if (mustEnrol) {
    // A privileged account without TOTP can reach almost nothing, so offering
    // the full menu would just produce a wall of redirects.
    return (
      <ul className="ac__nav-list">
        <li>
          <NavLink to="/admin/sicurezza/2fa" className="ac__nav-link">
            {t("Attiva 2FA")}
          </NavLink>
        </li>
        <li>
          <NavLink to="/admin/sicurezza" className="ac__nav-link">
            {t("Sicurezza")}
          </NavLink>
        </li>
      </ul>
    );
  }

  return (
    <>
      {nav.map((group, index) => (
        <details
          key={`${pathname}:${group.label}`}
          className="ac__nav-group"
          open={
            index === 0 ||
            group.items.some((item) => {
              const path = item.to.split("?")[0]!;
              return pathname === path || (!item.end && pathname.startsWith(`${path}/`));
            })
          }
        >
          <summary className="ac__nav-heading">
            <span>{t(group.label)}</span>
            <span className="ac__nav-chevron" aria-hidden="true" />
          </summary>
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
                    <span className="ac__nav-label">{t(item.label)}</span>
                    {badge && badge > 0 ? (
                      <span
                        className="ac__nav-badge"
                        aria-label={t("{{v0}} da gestire", { v0: badge })}
                      >
                        {badge}
                      </span>
                    ) : null}
                  </NavLink>
                </li>
              );
            })}
          </ul>
        </details>
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
  const t = useAdminTranslator();
  return (
    <div className="ac__page-header">
      {breadcrumbs && breadcrumbs.length > 1 ? (
        <nav aria-label={t("Percorso")} className="ac__crumbs small">
          {breadcrumbs.map((crumb, i) => (
            <span key={i}>
              {i > 0 ? <span aria-hidden="true"> / </span> : null}
              {crumb.to ? (
                <Link to={crumb.to}>{t(crumb.label)}</Link>
              ) : (
                <span>{t(crumb.label)}</span>
              )}
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
              {t(a.label)}
            </Link>
          ))}
          {primaryAction ? (
            <Link to={primaryAction.to} className="btn btn--primary">
              {t(primaryAction.label)}
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

/** Decorative, trusted brand artwork. No merchant SVG or client motion engine. */
export function AdminBrandScene() {
  return (
    <div className="ac-brand-scene" aria-hidden="true">
      <span className="ac-brand-scene__ring" />
      <span className="ac-brand-scene__shadow" />
      <div className="ac-brand-scene__plate ac-brand-scene__plate--back" />
      <div className="ac-brand-scene__plate ac-brand-scene__plate--front">
        <BrandSymbol className="ac-brand-scene__mark" />
      </div>
    </div>
  );
}
