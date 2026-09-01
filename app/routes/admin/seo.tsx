import { Link } from "react-router";
import type { Route } from "./+types/seo";
import { cloudflareContext } from "../../../workers/app";
import { requireStaff } from "~/infrastructure/auth/session.server";
import { breadcrumbsFor } from "~/lib/admin-nav";
import { PageHeader } from "~/components/admin/admin-shell";

/**
 * SEO.
 *
 * ── What this screen is ──────────────────────────────────────────────────────
 *
 * A report on what a search engine can and cannot see, built entirely from what
 * the shop already has. Every row is a real gap with a link to the screen that
 * fixes it.
 *
 * ── What it is not ───────────────────────────────────────────────────────────
 *
 * There is no keyword field, no meta-keywords tag, no "SEO score", and no
 * button that writes descriptions. Meta keywords have been ignored by every
 * major engine for over a decade; a score out of a hundred is a number with no
 * referent that people then optimise instead of the site; and a generated
 * description is a sentence about a product written by something that has never
 * seen it, which reads exactly like what it is and gets rewritten as a snippet
 * anyway.
 *
 * The useful facts are boring: does each page have a description a person
 * wrote, are any two pages claiming the same title, and is the site actually
 * asking to be indexed. That last one matters more than the rest combined and
 * is the easiest to get silently wrong.
 */
export function meta() {
  return [{ title: "SEO" }, { name: "robots", content: "noindex, nofollow" }];
}

/** Google truncates a description around here. Not a rule, a measurement. */
const DESCRIPTION_MAX = 160;
const DESCRIPTION_MIN = 50;

export async function loader({ request, context }: Route.LoaderArgs) {
  const { env } = context.get(cloudflareContext);
  await requireStaff(request, env, "content.read");

  const pages = await env.DB.prepare(
    `SELECT p.slug, p.status, t.title, t.seo_description, t.excerpt
       FROM pages p
       LEFT JOIN page_translations t ON t.page_id = p.id AND t.locale = 'it'
      WHERE p.archived_at IS NULL
      ORDER BY p.sort_order`,
  ).all<{
    slug: string;
    status: string;
    title: string | null;
    seo_description: string | null;
    excerpt: string | null;
  }>();

  const products = await env.DB.prepare(
    `SELECT p.slug, pt.name, pt.short_description
       FROM products p
       LEFT JOIN product_translations pt ON pt.product_id = p.id AND pt.locale = 'it'
      WHERE p.status = 'active' AND p.archived_at IS NULL
      ORDER BY pt.name`,
  ).all<{ slug: string; name: string | null; short_description: string | null }>();

  const categories = await env.DB.prepare(
    `SELECT c.slug, ct.name, ct.description
       FROM categories c
       LEFT JOIN category_translations ct ON ct.category_id = c.id AND ct.locale = 'it'
      WHERE c.visible = 1 AND c.archived_at IS NULL
      ORDER BY c.sort_order`,
  ).all<{ slug: string; name: string | null; description: string | null }>();

  /*
   * Duplicate titles, across products.
   *
   * Two pages with the same title is the single most common self-inflicted SEO
   * problem in a catalogue — it happens the moment a variant gets its own
   * product — and it is invisible unless something counts.
   */
  const titles = new Map<string, string[]>();
  for (const product of products.results) {
    const key = (product.name ?? "").trim().toLowerCase();
    if (key === "") continue;
    titles.set(key, [...(titles.get(key) ?? []), product.slug]);
  }
  const duplicates = [...titles.entries()]
    .filter(([, slugs]) => slugs.length > 1)
    .map(([title, slugs]) => ({ title, slugs }));

  return {
    /*
     * The fact that outranks every other row on this screen.
     *
     * Outside production the storefront serves an empty sitemap and asks not to
     * be indexed, on purpose — a preview competing with the real shop in search
     * results is worse than no preview. It is stated here because "why is the
     * site not on Google" has exactly this answer far more often than it has an
     * interesting one.
     */
    indexable: (env.APP_ENV ?? "development") === "production",
    appEnv: env.APP_ENV ?? "development",
    pages: pages.results,
    products: products.results,
    categories: categories.results,
    duplicates,
  };
}

export default function AdminSeo({ loaderData }: Route.ComponentProps) {
  const { indexable, appEnv, pages, products, categories, duplicates } = loaderData;

  const publishedPages = pages.filter((p) => p.status === "published");
  const pagesMissing = publishedPages.filter((p) => !(p.seo_description ?? p.excerpt ?? "").trim());
  const productsMissing = products.filter((p) => !(p.short_description ?? "").trim());
  const categoriesMissing = categories.filter((c) => !(c.description ?? "").trim());

  const tooLong = [
    ...publishedPages
      .filter((p) => (p.seo_description ?? p.excerpt ?? "").length > DESCRIPTION_MAX)
      .map((p) => ({ what: p.title ?? p.slug, where: "Pagina", to: "/admin/contenuti/pagine" })),
    ...products
      .filter((p) => (p.short_description ?? "").length > DESCRIPTION_MAX)
      .map((p) => ({
        what: p.name ?? p.slug,
        where: "Prodotto",
        to: `/admin/prodotti/${p.slug}`,
      })),
  ];

  const tooShort = products.filter((p) => {
    const text = (p.short_description ?? "").trim();
    return text.length > 0 && text.length < DESCRIPTION_MIN;
  });

  return (
    <>
      <PageHeader title="SEO" breadcrumbs={breadcrumbsFor("/admin/contenuti/seo")} />

      {/* First, because it explains the answer to the question people actually
          arrive with. */}
      {indexable ? (
        <p className="notice notice--info">
          Questo ambiente chiede di essere indicizzato e pubblica la mappa del sito.
        </p>
      ) : (
        <p className="notice notice--warning">
          <strong>
            Questo ambiente ({appEnv}) chiede ai motori di ricerca di NON indicizzarlo, e la mappa
            del sito è vuota.
          </strong>{" "}
          È voluto: una copia di prova che compare su Google al posto del negozio vero è peggio di
          nessuna copia di prova. Succede da solo quando il sito va in produzione.
        </p>
      )}

      <section className="panel">
        <h2>Copertura delle descrizioni</h2>
        <div className="ac-metrics">
          <div className="ac-metric">
            <span className="ac-metric__label">Pagine pubblicate</span>
            <span className="ac-metric__value numeric">
              {publishedPages.length - pagesMissing.length} / {publishedPages.length}
            </span>
            <span className="ac-metric__note">con descrizione</span>
          </div>
          <div className="ac-metric">
            <span className="ac-metric__label">Prodotti attivi</span>
            <span className="ac-metric__value numeric">
              {products.length - productsMissing.length} / {products.length}
            </span>
            <span className="ac-metric__note">con descrizione breve</span>
          </div>
          <div className="ac-metric">
            <span className="ac-metric__label">Categorie</span>
            <span className="ac-metric__value numeric">
              {categories.length - categoriesMissing.length} / {categories.length}
            </span>
            <span className="ac-metric__note">con descrizione</span>
          </div>
        </div>
        <p className="small">
          La descrizione è l&apos;unica riga di testo che il negozio controlla nei risultati di
          ricerca. Dove manca, il motore se la costruisce da solo con quello che trova nella pagina
          — e quello che trova non è quasi mai la frase che avresti scelto tu.
        </p>
        <p className="small">
          Qui non si generano descrizioni. Una frase su un prodotto scritta da qualcosa che non
          l&apos;ha mai visto si riconosce, e viene comunque riscritta dal motore.
        </p>
      </section>

      {duplicates.length > 0 ? (
        <section className="panel">
          <h2>Titoli uguali</h2>
          <p className="small">
            Due prodotti con lo stesso titolo si contendono lo stesso risultato di ricerca, e il
            motore ne sceglie uno solo. Succede quasi sempre quando una variante diventa un prodotto
            a sé.
          </p>
          <ul className="stack">
            {duplicates.map((d) => (
              <li key={d.title}>
                <strong>{d.title}</strong>
                <br />
                {d.slugs.map((slug, i) => (
                  <span key={slug}>
                    {i > 0 ? ", " : ""}
                    <Link to={`/admin/prodotti/${slug}`}>{slug}</Link>
                  </span>
                ))}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {productsMissing.length > 0 ? (
        <section className="panel">
          <h2>Prodotti senza descrizione breve ({productsMissing.length})</h2>
          <ul className="stack">
            {productsMissing.slice(0, 40).map((p) => (
              <li key={p.slug}>
                <Link to={`/admin/prodotti/${p.slug}`}>{p.name ?? p.slug}</Link>
              </li>
            ))}
          </ul>
          {productsMissing.length > 40 ? (
            <p className="small muted">…e altri {productsMissing.length - 40}.</p>
          ) : null}
        </section>
      ) : null}

      {pagesMissing.length > 0 ? (
        <section className="panel">
          <h2>Pagine senza descrizione ({pagesMissing.length})</h2>
          <ul className="stack">
            {pagesMissing.map((p) => (
              <li key={p.slug}>
                <Link to="/admin/contenuti/pagine">{p.title ?? p.slug}</Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {categoriesMissing.length > 0 ? (
        <section className="panel">
          <h2>Categorie senza descrizione ({categoriesMissing.length})</h2>
          <p className="small">
            La descrizione di categoria è il testo in cima alla pagina di elenco: è quello che
            distingue &ldquo;Cover&rdquo; da una griglia di prodotti qualsiasi.
          </p>
          <ul className="stack">
            {categoriesMissing.map((c) => (
              <li key={c.slug}>
                <Link to="/admin/marchi">{c.name ?? c.slug}</Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {tooLong.length > 0 || tooShort.length > 0 ? (
        <section className="panel">
          <h2>Lunghezze</h2>
          {tooLong.length > 0 ? (
            <>
              <h3>
                Oltre {DESCRIPTION_MAX} caratteri ({tooLong.length})
              </h3>
              <p className="small">Google taglia: la fine della frase non la legge nessuno.</p>
              <ul className="stack">
                {tooLong.slice(0, 20).map((row) => (
                  <li key={`${row.where}-${row.what}`}>
                    <Link to={row.to}>{row.what}</Link>{" "}
                    <span className="small muted">{row.where}</span>
                  </li>
                ))}
              </ul>
            </>
          ) : null}
          {tooShort.length > 0 ? (
            <>
              <h3>
                Sotto {DESCRIPTION_MIN} caratteri ({tooShort.length})
              </h3>
              <p className="small">
                Troppo corta per dire qualcosa: il motore tende a ignorarla e a scriversela da solo.
              </p>
              <ul className="stack">
                {tooShort.slice(0, 20).map((p) => (
                  <li key={p.slug}>
                    <Link to={`/admin/prodotti/${p.slug}`}>{p.name ?? p.slug}</Link>
                  </li>
                ))}
              </ul>
            </>
          ) : null}
        </section>
      ) : null}

      <section className="panel">
        <h2>File tecnici</h2>
        <ul className="stack small">
          <li>
            <a href="/sitemap.xml" target="_blank" rel="noopener noreferrer">
              /sitemap.xml
            </a>{" "}
            — generata dal database: pagine pubblicate, prodotti attivi, categorie. Non si aggiorna
            a mano perché non esiste una copia da aggiornare.
          </li>
          <li>
            <a href="/robots.txt" target="_blank" rel="noopener noreferrer">
              /robots.txt
            </a>{" "}
            — quello che i motori possono visitare.
          </li>
        </ul>
      </section>
    </>
  );
}
