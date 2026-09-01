import { data } from "react-router";
import type { Route } from "./+types/legal";
import { cloudflareContext } from "../../../workers/app";
import { parseLocalePath } from "~/lib/i18n";
import { parsePageBody } from "~/domain/content/page-body";

/**
 * Legal documents, publicly.
 *
 * Privacy policy, terms of sale, withdrawal instructions, warranty terms — the
 * documents a shop selling online in Italy is required to publish, and which
 * a customer is entitled to read before buying rather than after.
 *
 * ── This route displays; it does not author ──────────────────────────────────
 *
 * Nothing here generates a document, and the admin refuses to as well. These
 * are legally binding statements about a specific business, and a
 * plausible-looking template is more dangerous than an empty page: an empty
 * page is obviously unfinished, a generated one reads as done and gets
 * published. Until a professional has written them, this route 404s — which is
 * the honest state, and the footer says nothing rather than linking to it.
 *
 * ── Why the version, and not the document ────────────────────────────────────
 *
 * A customer is entitled to the terms that were in force when they bought, so
 * versions are never edited in place. This renders the CURRENT published
 * version; an order references the version id it was placed under, and that
 * row stays exactly as it was.
 */
export function meta({ loaderData }: Route.MetaArgs) {
  const doc = loaderData?.document;
  if (!doc) return [{ title: "Documento non trovato" }];

  return [
    { title: doc.name },
    // Legal text is not a landing page. It should be readable and findable by
    // someone looking for it, and it has no business competing for a query.
    { name: "robots", content: "noindex, follow" },
  ];
}

export async function loader({ context, params, request }: Route.LoaderArgs) {
  const { env } = context.get(cloudflareContext);
  const { locale } = parseLocalePath(new URL(request.url).pathname);

  const row = await env.DB.prepare(
    `SELECT d.code,
            CASE WHEN ?2 = 'en' THEN COALESCE(d.name_en, d.name_it) ELSE d.name_it END AS name,
            CASE WHEN ?2 = 'en' THEN COALESCE(v.body_en, v.body_it) ELSE v.body_it END AS body,
            v.version, v.effective_from, v.reviewed_by_lawyer
       FROM legal_documents d
       JOIN legal_document_versions v ON v.id = d.current_version_id
      WHERE d.code = ?1 AND v.published_at IS NOT NULL`,
  )
    .bind(params.code, locale)
    .first<{
      code: string;
      name: string | null;
      body: string | null;
      version: string | null;
      effective_from: number | null;
      reviewed_by_lawyer: number | null;
    }>();

  // No published version is a 404, not an empty page with a heading on it.
  if (!row?.name || !row.body?.trim()) {
    throw data({ message: "Documento non trovato" }, { status: 404 });
  }

  return {
    document: {
      code: row.code,
      name: row.name,
      version: row.version,
      effectiveFrom: row.effective_from,
      blocks: parsePageBody(row.body),
    },
  };
}

export default function LegalDocument({ loaderData }: Route.ComponentProps) {
  const { document: doc } = loaderData;

  return (
    <article className="page prose-page">
      <header className="prose-page__head">
        <h1>{doc.name}</h1>
        {/*
          The version and the date it took effect.

          Shown because "which terms did I agree to?" is a question a customer
          is entitled to answer, and a document with no version is one nobody
          can refer back to.
        */}
        {doc.version ? (
          <p className="prose-page__standfirst">
            {doc.version}
            {doc.effectiveFrom
              ? ` — in vigore dal ${new Date(doc.effectiveFrom).toLocaleDateString("it-IT")}`
              : ""}
          </p>
        ) : null}
      </header>

      <div className="prose">
        {doc.blocks.map((block, index) => {
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
