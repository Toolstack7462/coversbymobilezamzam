import { Form, Link } from "react-router";
import type { Route } from "./+types/pages";
import { cloudflareContext } from "../../../workers/app";
import { requireStaff } from "~/infrastructure/auth/session.server";
import { systemClock, cryptoIds } from "~/infrastructure/primitives";
import { breadcrumbsFor } from "~/lib/admin-nav";
import { PageHeader } from "~/components/admin/admin-shell";
import { parsePageBody } from "~/domain/content/page-body";

/**
 * Content pages.
 *
 * The storefront's About, contact and buying-guide pages come from `pages` and
 * `page_translations`. Until this screen existed the only way to change one was
 * to run a seed script, which means the merchant did not own their own words —
 * they owned a request to a developer.
 *
 * Unlike legal documents, these pages are NOT versioned. That is deliberate:
 * nothing references the wording of an About page the way an order references
 * the terms it was placed under, so version history here would be filing
 * cabinets for their own sake. Legal documents keep their versioning for
 * exactly that reason, and the two systems stay separate because their
 * obligations are different.
 */

export function meta() {
  return [{ title: "Pagine" }, { name: "robots", content: "noindex, nofollow" }];
}

/** Both storefront locales. Italian is the fallback the storefront reads. */
const LOCALES = [
  { code: "it", label: "Italiano" },
  { code: "en", label: "English" },
] as const;

const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * What kind of page this is.
 *
 * `pages.page_type` has been in the schema since the first migration and was
 * always written as 'page'. Guides are pages — same table, same editor, same
 * publishing rules — so a separate "Guide" screen would have been two screens
 * writing one table, which is how they end up disagreeing. This is the
 * distinction the nav entry points at instead.
 */
const PAGE_TYPES = [
  { value: "page", label: "Pagina" },
  { value: "guide", label: "Guida" },
] as const;

export async function loader({ request, context }: Route.LoaderArgs) {
  const { env } = context.get(cloudflareContext);
  const actor = await requireStaff(request, env, "content.read");

  // `?tipo=guide` narrows the list; the nav entry for Guide points here.
  const typeFilter = new URL(request.url).searchParams.get("tipo") ?? "";

  const pages = await env.DB.prepare(
    `SELECT id, slug, status, page_type, publish_at, sort_order, updated_at, archived_at
       FROM pages
      WHERE archived_at IS NULL
        ${typeFilter ? "AND page_type = ?1" : ""}
      ORDER BY sort_order ASC, slug ASC`,
  )
    .bind(...(typeFilter ? [typeFilter] : []))
    .all<{
      id: string;
      slug: string;
      status: string;
      page_type: string;
      publish_at: number | null;
      sort_order: number;
      updated_at: number;
      archived_at: number | null;
    }>();

  const translations = await env.DB.prepare(
    `SELECT page_id, locale, title, excerpt, body, seo_title, seo_description
       FROM page_translations`,
  ).all<{
    page_id: string;
    locale: string;
    title: string;
    excerpt: string | null;
    body: string | null;
    seo_title: string | null;
    seo_description: string | null;
  }>();

  return {
    pages: pages.results.map((page) => ({
      ...page,
      translations: Object.fromEntries(
        translations.results
          .filter((t) => t.page_id === page.id)
          .map((t) => [t.locale, t] as const),
      ),
    })),
    canWrite: actor.permissions.includes("content.write"),
    canPublish: actor.permissions.includes("content.publish"),
    typeFilter,
    pageTypes: PAGE_TYPES,
  };
}

export async function action({ request, context }: Route.ActionArgs) {
  const { env } = context.get(cloudflareContext);
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");
  const now = systemClock.now();

  if (intent === "create") {
    await requireStaff(request, env, "content.write");
    const slug = String(form.get("slug") ?? "")
      .trim()
      .toLowerCase();
    const title = String(form.get("title") ?? "").trim();
    const pageType = String(form.get("page_type") ?? "page");

    if (!PAGE_TYPES.some((t) => t.value === pageType)) {
      return { error: "Tipo di pagina non riconosciuto." };
    }
    if (!SLUG_PATTERN.test(slug)) {
      return {
        error:
          "L'indirizzo può contenere solo lettere minuscole, numeri e trattini (esempio: chi-siamo).",
      };
    }
    if (title === "") return { error: "Il titolo è obbligatorio." };

    const existing = await env.DB.prepare(`SELECT id FROM pages WHERE slug = ?1`)
      .bind(slug)
      .first<{ id: string }>();
    if (existing) return { error: `Esiste già una pagina con l'indirizzo "${slug}".` };

    const id = cryptoIds.generate();
    await env.DB.batch([
      // Created as a DRAFT, always. A page is not published by the act of
      // creating it — the merchant writes it first and decides afterwards.
      env.DB.prepare(
        `INSERT INTO pages (id, slug, status, page_type, sort_order, created_at, updated_at)
         VALUES (?1, ?2, 'draft', ?5, ?3, ?4, ?4)`,
      ).bind(id, slug, 100, now, pageType),
      env.DB.prepare(
        `INSERT INTO page_translations (id, page_id, locale, title) VALUES (?1, ?2, 'it', ?3)`,
      ).bind(cryptoIds.generate(), id, title),
    ]);

    return { success: `Pagina "${title}" creata come bozza.` };
  }

  if (intent === "save") {
    await requireStaff(request, env, "content.write");
    const pageId = String(form.get("pageId") ?? "");
    const locale = String(form.get("locale") ?? "");
    if (!LOCALES.some((l) => l.code === locale)) return { error: "Lingua non riconosciuta." };

    const title = String(form.get("title") ?? "").trim();
    const excerpt = String(form.get("excerpt") ?? "").trim();
    const body = String(form.get("body") ?? "").trim();
    const seoDescription = String(form.get("seo_description") ?? "").trim();

    if (title === "") return { error: "Il titolo è obbligatorio." };

    await env.DB.prepare(
      `INSERT INTO page_translations
         (id, page_id, locale, title, excerpt, body, seo_title, seo_description)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?4, ?7)
       ON CONFLICT(page_id, locale) DO UPDATE SET
         title = excluded.title, excerpt = excluded.excerpt, body = excluded.body,
         seo_title = excluded.seo_title, seo_description = excluded.seo_description`,
    )
      .bind(
        cryptoIds.generate(),
        pageId,
        locale,
        title,
        excerpt || null,
        body || null,
        seoDescription || null,
      )
      .run();

    await env.DB.prepare(`UPDATE pages SET updated_at = ?2 WHERE id = ?1`).bind(pageId, now).run();
    return { success: `Testo salvato (${locale}).` };
  }

  if (intent === "publish" || intent === "unpublish") {
    await requireStaff(request, env, "content.publish");
    const pageId = String(form.get("pageId") ?? "");

    if (intent === "publish") {
      /*
       * A page with no Italian title cannot be published.
       *
       * Italian is the storefront's fallback locale: a page published without
       * one renders a blank heading to every visitor, in both languages. The
       * storefront guards against it by 404ing, which is correct behaviour and
       * a terrible explanation — the merchant sees a published page that is not
       * there. Refusing here says why.
       */
      const italian = await env.DB.prepare(
        `SELECT title FROM page_translations WHERE page_id = ?1 AND locale = 'it'`,
      )
        .bind(pageId)
        .first<{ title: string | null }>();

      if (!italian?.title?.trim()) {
        return { error: "Serve un titolo in italiano prima di pubblicare." };
      }
    }

    await env.DB.prepare(`UPDATE pages SET status = ?2, updated_at = ?3 WHERE id = ?1`)
      .bind(pageId, intent === "publish" ? "published" : "draft", now)
      .run();

    return {
      success: intent === "publish" ? "Pagina pubblicata." : "Pagina ritirata dal sito.",
    };
  }

  if (intent === "archive") {
    await requireStaff(request, env, "content.publish");
    const pageId = String(form.get("pageId") ?? "");

    // Archived, not deleted: the row keeps the words in case the merchant
    // wants them back, and the storefront already excludes archived pages.
    await env.DB.prepare(
      `UPDATE pages SET archived_at = ?2, status = 'draft', updated_at = ?2 WHERE id = ?1`,
    )
      .bind(pageId, now)
      .run();

    return { success: "Pagina archiviata. Non è più raggiungibile dal sito." };
  }

  return { error: "Azione non riconosciuta." };
}

export default function AdminPages({ loaderData, actionData }: Route.ComponentProps) {
  const { pages, canWrite, canPublish, typeFilter, pageTypes } = loaderData;
  const published = pages.filter((p) => p.status === "published").length;

  return (
    <>
      <PageHeader title="Pagine" breadcrumbs={breadcrumbsFor("/admin/contenuti/pagine")} />

      {actionData && "error" in actionData && actionData.error ? (
        <p className="notice notice--danger" role="alert">
          {actionData.error}
        </p>
      ) : null}
      {actionData && "success" in actionData && actionData.success ? (
        <p className="notice notice--info" role="status">
          {actionData.success}
        </p>
      ) : null}

      <section className="panel">
        <div className="ac-metrics">
          <div className="ac-metric">
            <span className="ac-metric__label">Pubblicate</span>
            <span className="ac-metric__value numeric">
              {published} / {pages.length}
            </span>
          </div>
        </div>
        <p className="small">
          Queste sono le pagine di testo del sito: chi siamo, contatti, guide. Le condizioni di
          vendita, la privacy e il diritto di recesso non stanno qui — hanno una sezione propria
          perché sono documenti vincolanti e vanno versionati.
        </p>
      </section>

      <nav className="cluster" aria-label="Filtra per tipo">
        <Link
          className="chip"
          to="/admin/contenuti/pagine"
          aria-current={typeFilter === "" || undefined}
        >
          Tutte
        </Link>
        {pageTypes.map((t) => (
          <Link
            key={t.value}
            className="chip"
            to={`/admin/contenuti/pagine?tipo=${t.value}`}
            aria-current={typeFilter === t.value || undefined}
          >
            {t.label}
          </Link>
        ))}
      </nav>

      {canWrite ? (
        <section className="panel">
          <h2>Nuova pagina</h2>
          <Form method="post" className="stack">
            <input type="hidden" name="intent" value="create" />
            <label>
              Titolo
              <input name="title" required maxLength={120} />
            </label>
            <label>
              Tipo
              <select name="page_type" defaultValue={typeFilter || "page"}>
                {pageTypes.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </select>
              <span className="field-help">
                Una guida è una pagina: stesso editor, stesse regole. Il tipo serve solo a
                ritrovarla.
              </span>
            </label>
            <label>
              Indirizzo
              <input
                name="slug"
                required
                maxLength={80}
                pattern="[a-z0-9]+(-[a-z0-9]+)*"
                placeholder="chi-siamo"
              />
              <span className="field-help">
                Diventa l&apos;indirizzo della pagina: /pagine/chi-siamo. Solo minuscole, numeri e
                trattini. Cambiarlo dopo rompe i link già condivisi.
              </span>
            </label>
            <button className="btn btn--primary" type="submit">
              Crea come bozza
            </button>
          </Form>
        </section>
      ) : null}

      <div className="stack">
        {pages.map((page) => {
          const isPublished = page.status === "published";

          return (
            <details key={page.id} className="panel" open={!isPublished}>
              <summary>
                <strong>{page.translations.it?.title ?? page.slug}</strong>{" "}
                {isPublished ? (
                  <span className="badge badge--success">pubblicata</span>
                ) : (
                  <span className="badge badge--warning">bozza</span>
                )}{" "}
                <code className="small">/pagine/{page.slug}</code>{" "}
                {page.page_type !== "page" ? (
                  <span className="badge">
                    {pageTypes.find((t) => t.value === page.page_type)?.label ?? page.page_type}
                  </span>
                ) : null}
              </summary>

              {LOCALES.map((locale) => {
                const translation = page.translations[locale.code];
                const blocks = parsePageBody(translation?.body);

                return (
                  <Form method="post" className="stack" key={locale.code}>
                    <input type="hidden" name="intent" value="save" />
                    <input type="hidden" name="pageId" value={page.id} />
                    <input type="hidden" name="locale" value={locale.code} />

                    <h3>{locale.label}</h3>

                    <label>
                      Titolo
                      <input
                        name="title"
                        defaultValue={translation?.title ?? ""}
                        maxLength={120}
                        required
                        disabled={!canWrite}
                      />
                    </label>

                    <label>
                      Sommario
                      <input
                        name="excerpt"
                        defaultValue={translation?.excerpt ?? ""}
                        maxLength={200}
                        disabled={!canWrite}
                      />
                      <span className="field-help">
                        La frase sotto il titolo, e la descrizione che compare su Google se non ne
                        scrivi un&apos;altra.
                      </span>
                    </label>

                    <label>
                      Testo
                      <textarea
                        name="body"
                        rows={14}
                        defaultValue={translation?.body ?? ""}
                        disabled={!canWrite}
                      />
                      <span className="field-help">
                        Una riga vuota separa i paragrafi. Una riga che inizia con <code>## </code>{" "}
                        è un sottotitolo, una che inizia con <code>- </code> è un punto elenco. Non
                        si possono inserire link o HTML: è una scelta di sicurezza, non una
                        mancanza.
                      </span>
                      {blocks.length > 0 ? (
                        <span className="field-help">
                          Al momento: {blocks.filter((b) => b.kind === "heading").length}{" "}
                          sottotitoli, {blocks.filter((b) => b.kind === "paragraph").length}{" "}
                          paragrafi, {blocks.filter((b) => b.kind === "list").length} elenchi.
                        </span>
                      ) : null}
                    </label>

                    <label>
                      Descrizione per i motori di ricerca
                      <input
                        name="seo_description"
                        defaultValue={translation?.seo_description ?? ""}
                        maxLength={160}
                        disabled={!canWrite}
                      />
                      <span className="field-help">
                        Facoltativa. Se vuota viene usato il sommario. Oltre i 160 caratteri Google
                        taglia.
                      </span>
                    </label>

                    {canWrite ? (
                      <button className="btn" type="submit">
                        Salva {locale.label}
                      </button>
                    ) : null}
                  </Form>
                );
              })}

              {canPublish ? (
                <div className="cluster">
                  <Form method="post">
                    <input
                      type="hidden"
                      name="intent"
                      value={isPublished ? "unpublish" : "publish"}
                    />
                    <input type="hidden" name="pageId" value={page.id} />
                    <button className={isPublished ? "btn" : "btn btn--primary"} type="submit">
                      {isPublished ? "Ritira dal sito" : "Pubblica"}
                    </button>
                  </Form>

                  <Form method="post">
                    <input type="hidden" name="intent" value="archive" />
                    <input type="hidden" name="pageId" value={page.id} />
                    <button className="btn btn--danger" type="submit">
                      Archivia
                    </button>
                  </Form>
                </div>
              ) : null}
            </details>
          );
        })}
      </div>
    </>
  );
}
