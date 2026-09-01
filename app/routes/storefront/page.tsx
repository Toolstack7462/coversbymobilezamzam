import { data } from "react-router";
import type { Route } from "./+types/page";
import { cloudflareContext } from "../../../workers/app";
import { parseLocalePath } from "~/lib/i18n";
import { parsePageBody } from "~/domain/content/page-body";

/**
 * Merchant-authored content pages.
 *
 * The `pages` and `page_translations` tables have been in the schema since the
 * first migration and nothing read them, so the shop had no About, no contact
 * page, no guides — nothing beyond the catalogue. The tables were there; the
 * door was not.
 *
 * Everything here comes from the database. There is no hardcoded page, no
 * hardcoded copy and no hardcoded slug, so the merchant can add, rename,
 * unpublish or rewrite a page without a deploy — which is the only version of
 * "the merchant owns their content" that is actually true.
 */
export function meta({ loaderData }: Route.MetaArgs) {
  const page = loaderData?.page;
  if (!page) return [{ title: "Pagina non trovata" }];

  return [
    { title: page.seoTitle ?? page.title },
    ...((page.seoDescription ?? page.excerpt)
      ? [{ name: "description", content: (page.seoDescription ?? page.excerpt) as string }]
      : []),
  ];
}

export async function loader({ context, params, request }: Route.LoaderArgs) {
  const { env } = context.get(cloudflareContext);
  const { locale } = parseLocalePath(new URL(request.url).pathname);

  /*
   * `publish_at` in the future means scheduled, not published. Comparing it
   * here rather than trusting `status` alone means a page scheduled for next
   * week cannot be read early by anyone who guesses the slug.
   */
  const row = await env.DB.prepare(
    `SELECT p.slug,
            COALESCE(t.title, fallback.title)                     AS title,
            COALESCE(t.excerpt, fallback.excerpt)                 AS excerpt,
            COALESCE(t.body, fallback.body)                       AS body,
            COALESCE(t.seo_title, fallback.seo_title)             AS seo_title,
            COALESCE(t.seo_description, fallback.seo_description) AS seo_description
       FROM pages p
       LEFT JOIN page_translations t        ON t.page_id = p.id AND t.locale = ?2
       LEFT JOIN page_translations fallback ON fallback.page_id = p.id AND fallback.locale = 'it'
      WHERE p.slug = ?1
        AND p.status = 'published'
        AND p.archived_at IS NULL
        AND (p.publish_at IS NULL OR p.publish_at <= ?3)`,
  )
    .bind(params.slug, locale, Date.now())
    .first<{
      slug: string;
      title: string | null;
      excerpt: string | null;
      body: string | null;
      seo_title: string | null;
      seo_description: string | null;
    }>();

  // A page with no title in any locale is not publishable content, whatever
  // its status says. 404 is honest; a blank page with a header is not.
  if (!row?.title) {
    throw data({ message: "Pagina non trovata" }, { status: 404 });
  }

  return {
    page: {
      slug: row.slug,
      title: row.title,
      excerpt: row.excerpt,
      seoTitle: row.seo_title,
      seoDescription: row.seo_description,
      blocks: parsePageBody(row.body),
    },
  };
}

export default function ContentPage({ loaderData }: Route.ComponentProps) {
  const { page } = loaderData;

  return (
    <article className="page prose-page">
      <header className="prose-page__head">
        <h1>{page.title}</h1>
        {/* The excerpt is the standfirst. Absent renders nothing — a heading
            over an empty line looks broken, an absent one looks finished. */}
        {page.excerpt ? <p className="prose-page__standfirst">{page.excerpt}</p> : null}
      </header>

      <div className="prose">
        {page.blocks.map((block, index) => {
          const key = `${block.kind}-${index}`;
          if (block.kind === "heading") return <h2 key={key}>{block.text}</h2>;
          if (block.kind === "list")
            return (
              <ul key={key}>
                {block.items.map((item, i) => (
                  <li key={`${key}-${i}`}>{item}</li>
                ))}
              </ul>
            );
          return <p key={key}>{block.text}</p>;
        })}
      </div>
    </article>
  );
}
