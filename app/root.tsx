import {
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
  isRouteErrorResponse,
  useLocation,
  useRouteError,
} from "react-router";
import type { LinksFunction } from "react-router";

import stylesheet from "~/styles/app.css?url";
import { parseLocalePath, translator, direction, DEFAULT_LOCALE } from "~/lib/i18n";

export const links: LinksFunction = () => [
  { rel: "stylesheet", href: stylesheet },
  // Only the two faces used above the fold are preconnected. Preloading every
  // weight costs more than it saves.
  { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
];

export function Layout({ children }: { children: React.ReactNode }) {
  const { pathname } = useLocation();
  const { locale } = parseLocalePath(pathname);
  const t = translator(locale);

  return (
    <html lang={locale} dir={direction(locale)}>
      <head>
        <meta charSet="utf-8" />
        {/* Never `user-scalable=no`: disabling zoom fails WCAG 1.4.4 and makes
            the site unusable for anyone who needs to magnify it. */}
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <Meta />
        <Links />
      </head>
      <body>
        {/* Moves focus, not just the scroll position. */}
        <a className="skip-link" href="#main">
          {t("common.skip_to_content")}
        </a>
        {children}
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

export default function App() {
  return <Outlet />;
}

/**
 * Error boundary.
 *
 * Shows a useful message and never leaks a stack trace to a customer. Details
 * are rendered only in development, where the person reading them wrote the
 * code.
 */
export function ErrorBoundary() {
  const error = useRouteError();
  const t = translator(DEFAULT_LOCALE);

  const isNotFound = isRouteErrorResponse(error) && error.status === 404;
  const title = isNotFound ? t("errors.not_found_title") : t("errors.server_title");
  const body = isNotFound ? t("errors.not_found_body") : t("errors.server_body");

  return (
    <main id="main" className="page" style={{ paddingBlock: "var(--space-9)" }}>
      <div className="panel stack" style={{ maxWidth: "36rem", marginInline: "auto" }}>
        <h1>{title}</h1>
        <p className="muted">{body}</p>
        <p>
          <a className="btn btn--primary" href="/">
            {t("common.home")}
          </a>
        </p>
        {import.meta.env.DEV && error instanceof Error ? (
          <pre className="small" style={{ overflowX: "auto" }}>
            {error.stack}
          </pre>
        ) : null}
      </div>
    </main>
  );
}
