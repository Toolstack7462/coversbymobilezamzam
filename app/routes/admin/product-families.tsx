import { Form, Link } from "react-router";
import type { Route } from "./+types/product-families";
import { cloudflareContext } from "../../../workers/app";
import { requireStaff } from "~/infrastructure/auth/session.server";
import { systemClock, cryptoIds } from "~/infrastructure/primitives";
import { breadcrumbsFor } from "~/lib/admin-nav";
import { PageHeader } from "~/components/admin/admin-shell";

/**
 * Product families.
 *
 * ── What a family is, and what it is not ─────────────────────────────────────
 *
 * A family groups products that are THE SAME ITEM cut for different phones: one
 * silicone case, eleven models. It exists so the product page can say "also
 * available for your phone" and mean it.
 *
 * It is not compatibility. Compatibility answers "does this fit my phone?" and
 * is recorded per product against real device models; a family answers "is
 * there a version of this for my phone?", which is a different question with a
 * different answer, and conflating them is how a customer ends up being told a
 * case for an iPhone fits a Galaxy.
 *
 * It is also not a category. Categories are how a shop is browsed; a family is
 * usually a handful of products inside one category.
 *
 * ── Why membership is explicit ───────────────────────────────────────────────
 *
 * Nothing here is inferred from a name. Grouping "Cover in silicone — iPhone 16
 * Pro" with "Cover in silicone — Galaxy S24" by matching the words before the
 * dash would work until the day a supplier changes their naming, and then it
 * would quietly stop, with no error and no way to notice. A person says these
 * are the same product; the database records that they said so.
 */
export function meta() {
  return [{ title: "Famiglie prodotto" }, { name: "robots", content: "noindex, nofollow" }];
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const { env } = context.get(cloudflareContext);
  const actor = await requireStaff(request, env, "product.read");

  const families = await env.DB.prepare(
    `SELECT f.id, f.handle, f.name_it, f.name_en,
            (SELECT COUNT(*) FROM product_family_members m WHERE m.product_family_id = f.id) AS members
       FROM product_families f
      WHERE f.archived_at IS NULL
      ORDER BY f.name_it`,
  ).all<{ id: string; handle: string; name_it: string; name_en: string; members: number }>();

  const members = await env.DB.prepare(
    `SELECT m.id, m.product_family_id, m.sort_order, p.slug,
            COALESCE(pt.name, p.slug) AS name
       FROM product_family_members m
       JOIN products p ON p.id = m.product_id
       LEFT JOIN product_translations pt ON pt.product_id = p.id AND pt.locale = 'it'
      ORDER BY m.sort_order, name`,
  ).all<{
    id: string;
    product_family_id: string;
    sort_order: number;
    slug: string;
    name: string;
  }>();

  /*
   * Products not yet in any family.
   *
   * Offered as the candidate list, because the useful question when looking at
   * this screen is "what have I not grouped yet?" — and a product can belong to
   * only one family, since "the same item for another phone" is not a thing
   * something can be twice.
   */
  const unassigned = await env.DB.prepare(
    `SELECT p.slug, COALESCE(pt.name, p.slug) AS name
       FROM products p
       LEFT JOIN product_translations pt ON pt.product_id = p.id AND pt.locale = 'it'
      WHERE p.status = 'active' AND p.archived_at IS NULL
        AND NOT EXISTS (SELECT 1 FROM product_family_members m WHERE m.product_id = p.id)
      ORDER BY name
      LIMIT 500`,
  ).all<{ slug: string; name: string }>();

  return {
    families: families.results.map((f) => ({
      ...f,
      members: members.results.filter((m) => m.product_family_id === f.id),
    })),
    unassigned: unassigned.results,
    canWrite: actor.permissions.includes("product.write"),
  };
}

export async function action({ request, context }: Route.ActionArgs) {
  const { env } = context.get(cloudflareContext);
  await requireStaff(request, env, "product.write");

  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");
  const now = systemClock.now();

  if (intent === "create") {
    const name = String(form.get("name") ?? "").trim();
    const handle = String(form.get("handle") ?? "")
      .trim()
      .toLowerCase();

    if (name === "") return { error: "Il nome è obbligatorio." };
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(handle)) {
      return { error: "L'identificativo può contenere solo minuscole, numeri e trattini." };
    }

    const clash = await env.DB.prepare(`SELECT id FROM product_families WHERE handle = ?1`)
      .bind(handle)
      .first<{ id: string }>();
    if (clash) return { error: `Esiste già una famiglia con identificativo "${handle}".` };

    await env.DB.prepare(
      `INSERT INTO product_families (id, handle, name_it, name_en, created_at, updated_at)
       VALUES (?1, ?2, ?3, ?3, ?4, ?4)`,
    )
      .bind(cryptoIds.generate(), handle, name, now)
      .run();

    return { success: `Famiglia "${name}" creata.` };
  }

  if (intent === "add-member") {
    const familyId = String(form.get("familyId") ?? "");
    const slug = String(form.get("product") ?? "").trim();

    const product = await env.DB.prepare(
      `SELECT id FROM products WHERE slug = ?1 AND archived_at IS NULL`,
    )
      .bind(slug)
      .first<{ id: string }>();
    if (!product) return { error: "Prodotto non trovato." };

    const already = await env.DB.prepare(
      `SELECT id FROM product_family_members WHERE product_id = ?1`,
    )
      .bind(product.id)
      .first<{ id: string }>();
    if (already) {
      return { error: "Questo prodotto è già in una famiglia. Toglilo da quella prima." };
    }

    const last = await env.DB.prepare(
      `SELECT COALESCE(MAX(sort_order), 0) AS n FROM product_family_members
        WHERE product_family_id = ?1`,
    )
      .bind(familyId)
      .first<{ n: number }>();

    await env.DB.prepare(
      `INSERT INTO product_family_members (id, product_family_id, product_id, sort_order)
       VALUES (?1, ?2, ?3, ?4)`,
    )
      .bind(cryptoIds.generate(), familyId, product.id, (last?.n ?? 0) + 10)
      .run();

    return { success: "Prodotto aggiunto alla famiglia." };
  }

  if (intent === "remove-member") {
    const memberId = String(form.get("memberId") ?? "");
    // The membership row goes; the product does not. Worth stating because
    // "remove" on a screen full of products is an ambiguous word.
    await env.DB.prepare(`DELETE FROM product_family_members WHERE id = ?1`).bind(memberId).run();
    return { success: "Prodotto tolto dalla famiglia. Il prodotto resta a catalogo." };
  }

  if (intent === "archive") {
    const familyId = String(form.get("familyId") ?? "");
    await env.DB.batch([
      env.DB.prepare(`DELETE FROM product_family_members WHERE product_family_id = ?1`).bind(
        familyId,
      ),
      env.DB.prepare(
        `UPDATE product_families SET archived_at = ?2, updated_at = ?2 WHERE id = ?1`,
      ).bind(familyId, now),
    ]);
    return { success: "Famiglia archiviata. I prodotti restano a catalogo." };
  }

  return { error: "Azione non riconosciuta." };
}

export default function AdminProductFamilies({ loaderData, actionData }: Route.ComponentProps) {
  const { families, unassigned, canWrite } = loaderData;

  return (
    <>
      <PageHeader title="Famiglie prodotto" breadcrumbs={breadcrumbsFor("/admin/famiglie")} />

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
        <p className="small">
          Una famiglia raggruppa lo stesso identico articolo tagliato per telefoni diversi: una
          cover in silicone, undici modelli. Serve perché la scheda prodotto possa dire
          &ldquo;disponibile anche per il tuo telefono&rdquo; e sia vero.
        </p>
        <p className="small">
          Non è la compatibilità. La compatibilità risponde a &ldquo;questo va bene per il mio
          telefono?&rdquo;; una famiglia risponde a &ldquo;ne esiste una versione per il mio
          telefono?&rdquo;. Sono due domande diverse con due risposte diverse, e confonderle è il
          modo in cui un cliente si sente dire che una cover per iPhone va bene su un Galaxy.
        </p>
      </section>

      {canWrite ? (
        <section className="panel">
          <h2>Nuova famiglia</h2>
          <Form method="post" className="stack">
            <input type="hidden" name="intent" value="create" />
            <label>
              Nome
              <input name="name" required maxLength={80} placeholder="Cover in silicone" />
            </label>
            <label>
              Identificativo
              <input name="handle" required maxLength={60} placeholder="cover-silicone" />
              <span className="field-help">Minuscole, numeri e trattini. Non è pubblico.</span>
            </label>
            <button className="btn btn--primary" type="submit">
              Crea famiglia
            </button>
          </Form>
        </section>
      ) : null}

      {families.length === 0 ? (
        <div className="empty-state">
          <p>Nessuna famiglia.</p>
          <p className="small">
            Ha senso crearne una quando lo stesso articolo esiste per più modelli di telefono.
          </p>
        </div>
      ) : (
        <div className="stack">
          {families.map((family) => (
            <details className="panel" key={family.id} open={family.members.length === 0}>
              <summary>
                <strong>{family.name_it}</strong>{" "}
                <span className="badge">{family.members.length} prodotti</span>{" "}
                <code className="small">{family.handle}</code>
              </summary>

              {family.members.length === 0 ? (
                <p className="small muted">
                  Ancora vuota. Una famiglia con meno di due prodotti non compare sul sito: non
                  avrebbe niente da suggerire.
                </p>
              ) : (
                <ul className="stack">
                  {family.members.map((m) => (
                    <li key={m.id} className="cluster">
                      <Link to={`/admin/prodotti/${m.slug}`}>{m.name}</Link>
                      {canWrite ? (
                        <Form method="post">
                          <input type="hidden" name="intent" value="remove-member" />
                          <input type="hidden" name="memberId" value={m.id} />
                          <button className="btn" type="submit">
                            Togli
                          </button>
                        </Form>
                      ) : null}
                    </li>
                  ))}
                </ul>
              )}

              {canWrite && unassigned.length > 0 ? (
                <Form method="post" className="stack">
                  <input type="hidden" name="intent" value="add-member" />
                  <input type="hidden" name="familyId" value={family.id} />
                  <label>
                    Aggiungi un prodotto
                    <select name="product" required defaultValue="">
                      <option value="" disabled>
                        Scegli…
                      </option>
                      {unassigned.map((p) => (
                        <option key={p.slug} value={p.slug}>
                          {p.name}
                        </option>
                      ))}
                    </select>
                    <span className="field-help">
                      Solo i prodotti non ancora in una famiglia: un articolo può stare in una sola.
                    </span>
                  </label>
                  <button className="btn" type="submit">
                    Aggiungi
                  </button>
                </Form>
              ) : null}

              {canWrite ? (
                <Form method="post">
                  <input type="hidden" name="intent" value="archive" />
                  <input type="hidden" name="familyId" value={family.id} />
                  <button className="btn btn--danger" type="submit">
                    Archivia famiglia
                  </button>
                </Form>
              ) : null}
            </details>
          ))}
        </div>
      )}
    </>
  );
}
