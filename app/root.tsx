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

  /*
   * The two faces that render above the fold, preloaded.
   *
   * There used to be a `preconnect` to fonts.gstatic.com here and no font at
   * all: the tokens named Manrope and Inter, nothing declared them, and every
   * page fell back to the system UI font while opening a connection to Google
   * for nothing. Both families are now self-hosted, so there is no third-party
   * request to make and no privacy question to answer.
   *
   * Only the Latin subsets are preloaded. Latin Extended is declared with a
   * `unicode-range` and fetched only if a character needs it, which for Italian
   * is rare — `à è é ì ò ù` all live in the Latin subset.
   *
   * `crossOrigin` is required even for same-origin fonts: without it the
   * preload is made in a different mode from the CSS fetch, and the file is
   * downloaded twice.
   */
  {
    rel: "preload",
    href: "/fonts/inter-latin.woff2",
    as: "font",
    type: "font/woff2",
    crossOrigin: "anonymous",
  },
  {
    rel: "preload",
    href: "/fonts/manrope-latin.woff2",
    as: "font",
    type: "font/woff2",
    crossOrigin: "anonymous",
  },
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
      {/*
        An error page still needs a name.

        `<Meta />` renders the matched route's metadata, and a route that threw
        matched nothing — so every 404 and every 500 shipped with no <title> at
        all, showing the raw URL in the browser tab and failing WCAG 2.4.2. It
        is also the label that ends up in someone's history and bookmarks.

        React 19 hoists these into <head> from wherever they are rendered, so
        the boundary can supply its own without the route knowing.
      */}
      <title>{title}</title>
      {/* An error page is never worth indexing, whatever the environment. */}
      <meta name="robots" content="noindex" />

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
