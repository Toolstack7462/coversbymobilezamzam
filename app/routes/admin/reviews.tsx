import { Form, Link } from "react-router";
import type { Route } from "./+types/reviews";
import { cloudflareContext } from "../../../workers/app";
import { requireStaff } from "~/infrastructure/auth/session.server";
import { systemClock, cryptoIds } from "~/infrastructure/primitives";
import { formatDateTime } from "~/lib/i18n";
import { breadcrumbsFor } from "~/lib/admin-nav";
import { PageHeader } from "~/components/admin/admin-shell";

/**
 * Reviews.
 *
 * ── What this screen may and may not do ──────────────────────────────────────
 *
 * A fake review is not a design flaw, it is an unfair commercial practice. In
 * Italy that is D.Lgs. 26/2023, which obliges a shop showing reviews to state
 * how it checks they come from real buyers, and never to present an unchecked
 * review as verified.
 *
 * So this screen can publish a review or reject it, and it can record one taken
 * at the counter. It CANNOT:
 *
 *   - edit what a customer wrote. A shop that rewrites its reviews is not
 *     showing reviews.
 *   - mark an in-store review as a verified purchase. The database refuses it:
 *     `verified_purchase` requires a link to a real order line, by CHECK
 *     constraint, so no screen and no import can claim it without one.
 *   - delete a rejected review. It keeps the row and the reason, so a decision
 *     to hide something is reviewable rather than invisible.
 *
 * ── The uncomfortable one ────────────────────────────────────────────────────
 *
 * Publishing only the good ones is itself the practice the directive is about,
 * and no constraint can prevent it — it is a decision, made here, by a person.
 * The screen therefore shows the published/rejected split and the average of
 * what was submitted next to the average of what was published, because the gap
 * between those two numbers is the honest measure of whether this is being done
 * properly, and it should be visible to whoever is doing it.
 */
export function meta() {
  return [{ title: "Recensioni" }, { name: "robots", content: "noindex, nofollow" }];
}

const PROVENANCE_LABELS: Record<string, string> = {
  verified_purchase: "Acquisto verificato",
  in_store: "Raccolta in negozio",
};

export async function loader({ request, context }: Route.LoaderArgs) {
  const { env } = context.get(cloudflareContext);
  const actor = await requireStaff(request, env, "content.read");

  const status = new URL(request.url).searchParams.get("stato") ?? "pending";

  const reviews = await env.DB.prepare(
    `SELECT r.id, r.status, r.provenance, r.author_name, r.rating, r.title, r.body,
            r.moderation_note, r.moderated_by, r.moderated_at, r.created_at,
            p.slug AS product_slug, pt.name AS product_name
       FROM product_reviews r
       JOIN products p ON p.id = r.product_id
       LEFT JOIN product_translations pt ON pt.product_id = p.id AND pt.locale = 'it'
      ${status === "tutte" ? "" : "WHERE r.status = ?1"}
      ORDER BY r.created_at DESC
      LIMIT 200`,
  )
    .bind(...(status === "tutte" ? [] : [status]))
    .all<{
      id: string;
      status: string;
      provenance: string;
      author_name: string;
      rating: number;
      title: string | null;
      body: string;
      moderation_note: string | null;
      moderated_by: string | null;
      moderated_at: number | null;
      created_at: number;
      product_slug: string;
      product_name: string | null;
    }>();

  /*
   * Submitted average against published average.
   *
   * The gap between these two is the only number on this screen that says
   * whether moderation is filtering spam or filtering criticism.
   */
  const stats = await env.DB.prepare(
    `SELECT
       COUNT(*) AS total,
       SUM(status = 'pending')   AS pending,
       SUM(status = 'published') AS published,
       SUM(status = 'rejected')  AS rejected,
       AVG(rating) AS avg_all,
       AVG(CASE WHEN status = 'published' THEN rating END) AS avg_published
     FROM product_reviews`,
  ).first<{
    total: number;
    pending: number;
    published: number;
    rejected: number;
    avg_all: number | null;
    avg_published: number | null;
  }>();

  const products = await env.DB.prepare(
    `SELECT p.slug, COALESCE(pt.name, p.slug) AS name
       FROM products p
       LEFT JOIN product_translations pt ON pt.product_id = p.id AND pt.locale = 'it'
      WHERE p.status = 'active' AND p.archived_at IS NULL
      ORDER BY name
      LIMIT 500`,
  ).all<{ slug: string; name: string }>();

  return {
    reviews: reviews.results,
    products: products.results,
    stats,
    filter: status,
    canModerate: actor.permissions.includes("content.publish"),
    canWrite: actor.permissions.includes("content.write"),
  };
}

export async function action({ request, context }: Route.ActionArgs) {
  const { env } = context.get(cloudflareContext);
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");
  const now = systemClock.now();

  if (intent === "record") {
    const actor = await requireStaff(request, env, "content.write");

    const productSlug = String(form.get("product") ?? "").trim();
    const authorName = String(form.get("author_name") ?? "").trim();
    const rating = Number(form.get("rating") ?? "0");
    const title = String(form.get("title") ?? "").trim();
    const body = String(form.get("body") ?? "").trim();

    if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
      return { error: "Il voto deve essere un numero intero da 1 a 5." };
    }
    if (authorName === "") return { error: "Serve il nome di chi ha lasciato la recensione." };
    if (body === "") return { error: "Il testo della recensione è obbligatorio." };
    if (authorName.includes("@")) {
      // This name is rendered publicly. An email address here is a data leak
      // the person did not agree to, and it is a very easy one to paste.
      return { error: "Non inserire un indirizzo email: il nome è pubblico." };
    }

    const product = await env.DB.prepare(`SELECT id FROM products WHERE slug = ?1`)
      .bind(productSlug)
      .first<{ id: string }>();
    if (!product) return { error: "Prodotto non trovato." };

    /*
     * `in_store` and nothing else.
     *
     * There is no form field for provenance, because the only provenance this
     * screen can honestly assert is the one it is: somebody at the counter said
     * this. A verified purchase is created by the order flow, from an order.
     */
    await env.DB.prepare(
      `INSERT INTO product_reviews
         (id, product_id, order_item_id, provenance, status, author_name, rating,
          title, body, locale, created_at, updated_at)
       VALUES (?1, ?2, NULL, 'in_store', 'pending', ?3, ?4, ?5, ?6, 'it', ?7, ?7)`,
    )
      .bind(cryptoIds.generate(), product.id, authorName, rating, title || null, body, now)
      .run();

    return {
      success:
        "Recensione registrata come raccolta in negozio, in attesa di pubblicazione. " +
        "Non può essere marcata come acquisto verificato: quello lo fa solo un ordine reale.",
      actor: actor.displayName,
    };
  }

  if (intent === "publish" || intent === "reject") {
    const actor = await requireStaff(request, env, "content.publish");
    const id = String(form.get("reviewId") ?? "");
    const note = String(form.get("moderation_note") ?? "").trim();

    if (intent === "reject" && note === "") {
      // A rejection with no reason is indistinguishable from suppressing
      // something inconvenient, including to whoever has to answer for it later.
      return { error: "Per rifiutare una recensione serve una motivazione." };
    }

    await env.DB.prepare(
      `UPDATE product_reviews
          SET status = ?2, moderated_by = ?3, moderated_at = ?4, moderation_note = ?5,
              published_at = CASE WHEN ?2 = 'published' THEN ?4 ELSE NULL END,
              updated_at = ?4
        WHERE id = ?1`,
    )
      .bind(id, intent === "publish" ? "published" : "rejected", actor.userId, now, note || null)
      .run();

    return { success: intent === "publish" ? "Recensione pubblicata." : "Recensione rifiutata." };
  }

  return { error: "Azione non riconosciuta." };
}

export default function AdminReviews({ loaderData, actionData }: Route.ComponentProps) {
  const { reviews, products, stats, filter, canModerate, canWrite } = loaderData;

  const tab = (slug: string, label: string, count?: number) => (
    <Link
      className="chip"
      to={`/admin/recensioni?stato=${slug}`}
      aria-current={filter === slug || undefined}
    >
      {label}
      {count !== undefined ? ` (${count})` : ""}
    </Link>
  );

  const avgAll = stats?.avg_all ?? null;
  const avgPublished = stats?.avg_published ?? null;
  const gap = avgAll !== null && avgPublished !== null ? avgPublished - avgAll : null;

  return (
    <>
      <PageHeader title="Recensioni" breadcrumbs={breadcrumbsFor("/admin/recensioni")} />

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
            <span className="ac-metric__label">Da esaminare</span>
            <span className="ac-metric__value numeric">{stats?.pending ?? 0}</span>
          </div>
          <div className="ac-metric">
            <span className="ac-metric__label">Pubblicate</span>
            <span className="ac-metric__value numeric">{stats?.published ?? 0}</span>
          </div>
          <div className="ac-metric">
            <span className="ac-metric__label">Rifiutate</span>
            <span className="ac-metric__value numeric">{stats?.rejected ?? 0}</span>
          </div>
          <div className="ac-metric">
            <span className="ac-metric__label">Media ricevuta</span>
            <span className="ac-metric__value numeric">
              {avgAll !== null ? avgAll.toFixed(1) : "—"}
            </span>
          </div>
          <div className="ac-metric">
            <span className="ac-metric__label">Media pubblicata</span>
            <span className="ac-metric__value numeric">
              {avgPublished !== null ? avgPublished.toFixed(1) : "—"}
            </span>
            {gap !== null ? (
              <span className="ac-metric__note numeric">
                {gap > 0 ? "+" : ""}
                {gap.toFixed(1)} rispetto a quanto ricevuto
              </span>
            ) : null}
          </div>
        </div>

        <p className="small">
          Una recensione si pubblica o si rifiuta. Non si modifica: un negozio che riscrive le
          recensioni non sta mostrando recensioni.
        </p>
        <p className="notice notice--warning">
          <strong>Le due medie qui sopra vanno guardate insieme.</strong> Se quella pubblicata è
          molto più alta di quella ricevuta, vuol dire che si stanno filtrando le critiche e non lo
          spam — ed è esattamente la pratica che il D.Lgs. 26/2023 vieta. Nessun vincolo tecnico può
          impedirlo: è una decisione, e la prende chi sta leggendo questa riga.
        </p>
      </section>

      {canWrite ? (
        <section className="panel">
          <h2>Registra una recensione raccolta in negozio</h2>
          <p className="small">
            Viene salvata come <strong>raccolta in negozio</strong>, e sul sito compare con quella
            dicitura. Non può diventare &ldquo;acquisto verificato&rdquo;: quella dicitura la crea
            soltanto un ordine reale, e il database rifiuta il contrario.
          </p>
          <Form method="post" className="stack">
            <input type="hidden" name="intent" value="record" />
            <label>
              Prodotto
              <select name="product" required defaultValue="">
                <option value="" disabled>
                  Scegli…
                </option>
                {products.map((p) => (
                  <option key={p.slug} value={p.slug}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Nome
              <input name="author_name" required maxLength={60} placeholder="Marco R." />
              <span className="field-help">Pubblico. Nome e iniziale bastano, mai una email.</span>
            </label>
            <label>
              Voto
              <select name="rating" defaultValue="5">
                {[5, 4, 3, 2, 1].map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Titolo
              <input name="title" maxLength={80} />
            </label>
            <label>
              Testo
              <textarea name="body" rows={4} required maxLength={1500} />
            </label>
            <button className="btn" type="submit">
              Registra
            </button>
          </Form>
        </section>
      ) : null}

      <nav className="cluster" aria-label="Filtra per stato">
        {tab("pending", "Da esaminare", stats?.pending ?? 0)}
        {tab("published", "Pubblicate", stats?.published ?? 0)}
        {tab("rejected", "Rifiutate", stats?.rejected ?? 0)}
        {tab("tutte", "Tutte", stats?.total ?? 0)}
      </nav>

      {reviews.length === 0 ? (
        <div className="empty-state">
          <p>Nessuna recensione in questo stato.</p>
          <p className="small">
            Le recensioni da acquisto verificato nascono dagli ordini. Quelle raccolte al banco si
            registrano qui sopra.
          </p>
        </div>
      ) : (
        <div className="stack">
          {reviews.map((r) => (
            <article className="panel" key={r.id}>
              <header className="cluster">
                <strong>
                  {"★".repeat(r.rating)}
                  <span className="muted">{"★".repeat(5 - r.rating)}</span>
                </strong>
                <span>{r.author_name}</span>
                <span
                  className={
                    r.provenance === "verified_purchase" ? "badge badge--success" : "badge"
                  }
                >
                  {PROVENANCE_LABELS[r.provenance] ?? r.provenance}
                </span>
                <span className="small muted">{formatDateTime(r.created_at, "it")}</span>
              </header>

              <p className="small">
                <Link to={`/admin/prodotti/${r.product_slug}`}>
                  {r.product_name ?? r.product_slug}
                </Link>
              </p>

              {r.title ? <h3>{r.title}</h3> : null}
              <p>{r.body}</p>

              {r.moderation_note ? (
                <p className="small muted">Motivazione: {r.moderation_note}</p>
              ) : null}

              {canModerate && r.status === "pending" ? (
                <div className="stack">
                  <Form method="post" className="cluster">
                    <input type="hidden" name="intent" value="publish" />
                    <input type="hidden" name="reviewId" value={r.id} />
                    <button className="btn btn--primary" type="submit">
                      Pubblica
                    </button>
                  </Form>
                  <Form method="post" className="stack">
                    <input type="hidden" name="intent" value="reject" />
                    <input type="hidden" name="reviewId" value={r.id} />
                    <label>
                      Motivazione del rifiuto
                      <input name="moderation_note" required maxLength={200} />
                      <span className="field-help">
                        Obbligatoria. Un rifiuto senza motivo non si distingue da un insabbiamento.
                      </span>
                    </label>
                    <button className="btn btn--danger" type="submit">
                      Rifiuta
                    </button>
                  </Form>
                </div>
              ) : (
                <p className="small muted">
                  {r.status === "published" ? "Pubblicata" : "Rifiutata"}
                  {r.moderated_at ? ` — ${formatDateTime(r.moderated_at, "it")}` : ""}
                </p>
              )}
            </article>
          ))}
        </div>
      )}
    </>
  );
}
