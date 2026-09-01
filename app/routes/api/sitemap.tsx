import { cloudflareContext } from "../../../workers/app";
import type { Route } from "./+types/sitemap";
import { SUPPORTED_LOCALES, DEFAULT_LOCALE, localePath } from "~/lib/i18n";

/**
 * sitemap.xml
 *
 * Generated from the database, so it lists what the shop actually has rather
 * than what someone remembered to add to a static file.
 *
 * ── It is deliberately empty outside production ──────────────────────────────
 *
 * `robots.txt` already tells crawlers to stay away from preview and staging,
 * but a sitemap is a stronger signal than a disallow: submitting one is an
 * explicit request to index every URL in it. Serving a populated sitemap from
 * an environment that is `noindex` is a contradiction, and search engines
 * resolve contradictions unpredictably.
 *
 * So outside production this returns a valid, empty sitemap. It is ready, and
 * it asks for nothing.
 *
 * ── What is in it ────────────────────────────────────────────────────────────
 *
 * Only pages a customer should land on: the home page, the catalogue, the
 * device finder, the store page, and every active product. Never the cart,
 * checkout, order confirmations or tracking pages — those are private to one
 * person and several carry a token in the URL.
 *
 * Each entry carries `hreflang` alternates for both locales, because the same
 * product exists at two addresses and search engines otherwise have to guess
 * which is canonical.
 */

interface Entry {
  path: string;
  lastmod?: string | null;
  changefreq: "daily" | "weekly" | "monthly";
  priority: string;
}

const escapeXml = (value: string) =>
  value.replace(/[<>&'"]/g, (c) =>
    c === "<" ? "&lt;" : c === ">" ? "&gt;" : c === "&" ? "&amp;" : c === "'" ? "&apos;" : "&quot;",
  );

export async function loader({ request, context }: Route.LoaderArgs) {
  const { env } = context.get(cloudflareContext);

  const headers = {
    "content-type": "application/xml; charset=utf-8",
    // Crawlers re-fetch this often; an hour is plenty fresh for a catalogue
    // that changes a few times a day, and spares the database the rest.
    "cache-control": "public, max-age=3600",
  };

  if ((env.APP_ENV ?? "development") !== "production") {
    return new Response(
      `<?xml version="1.0" encoding="UTF-8"?>
<!-- Intentionally empty: this environment is noindex. A populated sitemap
     would be an explicit request to index a preview. -->
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" />
`,
      { headers },
    );
  }

  // The origin the sitemap must speak in. Absolute URLs are required by the
  // protocol, and getting the host from the request means a custom domain
  // works the day it is attached, with no redeploy.
  const base = (env.APP_BASE_URL ?? new URL(request.url).origin).replace(/\/$/, "");

  const products = await env.DB.prepare(
    `SELECT p.slug, p.updated_at
       FROM products p
      WHERE p.status = 'active' AND p.archived_at IS NULL
      ORDER BY p.published_at DESC
      LIMIT 5000`,
  ).all<{ slug: string; updated_at: number | null }>();

  /*
   * The merchant's published pages. Same publication rules as the page route
   * itself — a sitemap that advertises a scheduled or unpublished page sends
   * a crawler to a 404 and teaches it the site is unreliable.
   */
  const pages = await env.DB.prepare(
    `SELECT slug, updated_at
       FROM pages
      WHERE status = 'published' AND archived_at IS NULL
        AND (publish_at IS NULL OR publish_at <= ?1)
      ORDER BY sort_order ASC
      LIMIT 200`,
  )
    .bind(Date.now())
    .all<{ slug: string; updated_at: number | null }>();

  const entries: Entry[] = [
    { path: "/", changefreq: "daily", priority: "1.0" },
    { path: "/shop", changefreq: "daily", priority: "0.9" },
    { path: "/trova-dispositivo", changefreq: "weekly", priority: "0.8" },
    { path: "/negozio", changefreq: "monthly", priority: "0.7" },
    ...pages.results.map((p: { slug: string; updated_at: number | null }) => ({
      path: `/pagine/${p.slug}`,
      lastmod: p.updated_at ? new Date(p.updated_at).toISOString().slice(0, 10) : null,
      changefreq: "monthly" as const,
      priority: "0.6",
    })),
    ...products.results.map((p: { slug: string; updated_at: number | null }) => ({
      path: `/prodotti/${p.slug}`,
      lastmod: p.updated_at ? new Date(p.updated_at).toISOString().slice(0, 10) : null,
      changefreq: "weekly" as const,
      priority: "0.8",
    })),
  ];

  const urls = entries
    .flatMap((entry) =>
      SUPPORTED_LOCALES.map((locale) => {
        const loc = `${base}${localePath(locale, entry.path)}`;
        const alternates = SUPPORTED_LOCALES.map(
          (other) =>
            `    <xhtml:link rel="alternate" hreflang="${other}" href="${escapeXml(
              `${base}${localePath(other, entry.path)}`,
            )}"/>`,
        ).join("\n");

        return `  <url>
    <loc>${escapeXml(loc)}</loc>${entry.lastmod ? `\n    <lastmod>${entry.lastmod}</lastmod>` : ""}
    <changefreq>${entry.changefreq}</changefreq>
    <priority>${locale === DEFAULT_LOCALE ? entry.priority : "0.5"}</priority>
${alternates}
  </url>`;
      }),
    )
    .join("\n");

  return new Response(
    `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
        xmlns:xhtml="http://www.w3.org/1999/xhtml">
${urls}
</urlset>
`,
    { headers },
  );
}
