import { Form, useLocation } from "react-router";
import type { Route } from "./+types/catalogue-taxonomy";
import { cloudflareContext } from "../../../workers/app";
import { requireStaff } from "~/infrastructure/auth/session.server";
import { systemClock, cryptoIds } from "~/infrastructure/primitives";
import { uniqueSlug } from "~/domain/catalogue/slug";
import { breadcrumbsFor } from "~/lib/admin-nav";
import { PageHeader } from "~/components/admin/admin-shell";

/**
 * Brands and categories.
 *
 * Two lists that behave identically, on one screen, because they are the same
 * kind of thing: a short label a product is filed under. Splitting them into
 * two routes would double the code to say the same thing twice, and a merchant
 * setting up their catalogue does both in one sitting.
 *
 * These are the shop's OWN brands (Spigen, Anker) and categories (cover, cavi),
 * which is a different axis from `/admin/dispositivi` — those are the phones an
 * accessory fits. Confusing the two is easy from the outside, so the screen
 * says which is which rather than assuming.
 *
 * Neither is ever deleted. A product references its brand with ON DELETE
 * RESTRICT, so a delete would be refused by the database anyway for exactly the
 * brands that matter — the ones in use. Hiding is the honest operation.
 */

export function meta() {
  return [{ title: "Marchi e categorie" }, { name: "robots", content: "noindex, nofollow" }];
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const { env } = context.get(cloudflareContext);
  const actor = await requireStaff(request, env, "product.read");

  const [brands, categories] = await Promise.all([
    env.DB.prepare(
      `SELECT b.id, b.name, b.slug, b.website_url,
              (SELECT COUNT(*) FROM products p
                WHERE p.brand_id = b.id AND p.archived_at IS NULL) AS product_count
         FROM brands b ORDER BY b.sort_order, b.name`,
    ).all<{
      id: string;
      name: string;
      slug: string;
      website_url: string | null;
      product_count: number;
    }>(),

    env.DB.prepare(
      `SELECT c.id, c.slug, c.visible, c.accessory_type, ct.name,
              (SELECT COUNT(*) FROM products p
                WHERE p.primary_category_id = c.id AND p.archived_at IS NULL) AS product_count
         FROM categories c
         LEFT JOIN category_translations ct ON ct.category_id = c.id AND ct.locale = 'it'
        ORDER BY c.sort_order, ct.name`,
    ).all<{
      id: string;
      slug: string;
      visible: number;
      accessory_type: string | null;
      name: string | null;
      product_count: number;
    }>(),
  ]);

  return {
    brands: brands.results,
    categories: categories.results,
    canWrite: actor.permissions.includes("product.write"),
  };
}

export async function action({ request, context }: Route.ActionArgs) {
  const { env } = context.get(cloudflareContext);
  const actor = await requireStaff(request, env, "product.write");
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");
  const now = systemClock.now();

  const audit = (action: string, entityType: string, entityId: string, after: unknown) =>
    env.DB.prepare(
      `INSERT INTO audit_logs
         (id, actor_id, actor_label, action, entity_type, entity_id, after_value, created_at)
       VALUES (?1,?2,?3,?4,?5,?6,?7,?8)`,
    ).bind(
      cryptoIds.generate(),
      actor.userId,
      actor.displayName,
      action,
      entityType,
      entityId,
      JSON.stringify(after),
      now,
    );

  if (intent === "add-brand") {
    const name = String(form.get("name") ?? "").trim();
    const website = String(form.get("websiteUrl") ?? "").trim() || null;
    if (name.length < 1) return { error: "Il nome è obbligatorio." };

    const taken = await env.DB.prepare(`SELECT slug FROM brands`).all<{ slug: string }>();
    const slug = uniqueSlug(
      name,
      taken.results.map((r) => r.slug),
    );

    const id = cryptoIds.generate();
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO brands (id, slug, name, website_url, sort_order, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, 0, ?5, ?5)`,
      ).bind(id, slug, name, website, now),
      audit("brand.create", "brand", id, { name, slug }),
    ]);

    return { success: `Marchio "${name}" aggiunto.` };
  }

  if (intent === "add-category") {
    const name = String(form.get("name") ?? "").trim();
    const accessoryType = String(form.get("accessoryType") ?? "").trim() || null;
    if (name.length < 1) return { error: "Il nome è obbligatorio." };

    const taken = await env.DB.prepare(`SELECT slug FROM categories`).all<{ slug: string }>();
    const slug = uniqueSlug(
      name,
      taken.results.map((r) => r.slug),
    );

    const id = cryptoIds.generate();
    await env.DB.batch([
      env.DB.prepare(
        // `path` and `depth` support nesting. Only flat categories are created
        // here: a shop with fourteen accessory types does not need a tree, and
        // an unnecessary hierarchy is a filing decision the merchant has to
        // make on every single product.
        `INSERT INTO categories
           (id, slug, parent_id, path, depth, accessory_type, sort_order, visible,
            created_at, updated_at)
         VALUES (?1, ?2, NULL, ?2, 0, ?3, 0, 1, ?4, ?4)`,
      ).bind(id, slug, accessoryType, now),

      env.DB.prepare(
        `INSERT INTO category_translations (id, category_id, locale, name)
         VALUES (?1, ?2, 'it', ?3)`,
      ).bind(cryptoIds.generate(), id, name),

      audit("category.create", "category", id, { name, slug }),
    ]);

    return { success: `Categoria "${name}" aggiunta.` };
  }

  if (intent === "toggle-category") {
    const id = String(form.get("id") ?? "");
    const row = await env.DB.prepare(`SELECT visible FROM categories WHERE id = ?1`)
      .bind(id)
      .first<{ visible: number }>();
    if (!row) return { error: "Categoria non trovata." };

    const next = row.visible === 1 ? 0 : 1;
    await env.DB.batch([
      env.DB.prepare(`UPDATE categories SET visible = ?1, updated_at = ?2 WHERE id = ?3`).bind(
        next,
        now,
        id,
      ),
      audit("category.visible", "category", id, { visible: next === 1 }),
    ]);

    return {
      success:
        next === 1
          ? "Categoria di nuovo visibile sul sito."
          : "Categoria nascosta dal sito. I prodotti che vi appartengono restano invariati.",
    };
  }

  if (intent === "rename-brand") {
    const id = String(form.get("id") ?? "");
    const name = String(form.get("name") ?? "").trim();
    if (name.length < 1) return { error: "Il nome è obbligatorio." };

    // The slug is NOT regenerated. It is in the storefront's URLs and in links
    // people have shared; renaming a brand should fix a typo, not break every
    // link to it.
    await env.DB.batch([
      env.DB.prepare(`UPDATE brands SET name = ?1, updated_at = ?2 WHERE id = ?3`).bind(
        name,
        now,
        id,
      ),
      audit("brand.rename", "brand", id, { name }),
    ]);

    return { success: "Marchio rinominato. L'indirizzo della pagina resta invariato." };
  }

  return { error: "Azione non riconosciuta." };
}

export default function CatalogueTaxonomy({ loaderData, actionData }: Route.ComponentProps) {
  const { pathname } = useLocation();
  const { brands, categories, canWrite } = loaderData;

  return (
    <>
      <PageHeader
        title="Marchi e categorie"
        description="Come è organizzato il vostro catalogo. Diverso dai dispositivi, che sono i telefoni con cui un accessorio è compatibile."
        breadcrumbs={breadcrumbsFor(pathname)}
      />

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

      <div className="ac-columns">
        {/* ── Brands ────────────────────────────────────────────────────── */}
        <section className="panel stack">
          <h2>Marchi</h2>
          <p className="small muted">
            Chi produce l&apos;accessorio: Spigen, Anker, Baseus. Non il telefono a cui è destinato.
          </p>

          {brands.length === 0 ? (
            <p className="small muted">Nessun marchio. Si può anche non usarli.</p>
          ) : (
            <ul className="ac-picker">
              {brands.map((brand) => (
                <li key={brand.id}>
                  <div className="ac-pick">
                    {canWrite ? (
                      <Form method="post" className="cluster">
                        <input type="hidden" name="intent" value="rename-brand" />
                        <input type="hidden" name="id" value={brand.id} />
                        <label className="visually-hidden" htmlFor={`bn-${brand.id}`}>
                          Nome del marchio
                        </label>
                        <input
                          id={`bn-${brand.id}`}
                          name="name"
                          className="input"
                          defaultValue={brand.name}
                          maxLength={80}
                        />
                        <button type="submit" className="btn btn--ghost btn--small">
                          Salva
                        </button>
                      </Form>
                    ) : (
                      <span>{brand.name}</span>
                    )}
                    <span
                      className="ac-pick__count numeric"
                      title={`${brand.product_count} prodotti`}
                    >
                      {brand.product_count}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          )}

          {canWrite ? (
            <Form method="post" className="stack">
              <input type="hidden" name="intent" value="add-brand" />
              <div className="field">
                <label className="field__label" htmlFor="brand-name">
                  Nuovo marchio
                </label>
                <input
                  id="brand-name"
                  name="name"
                  className="input"
                  required
                  maxLength={80}
                  placeholder="Spigen"
                />
              </div>
              <div className="field">
                <label className="field__label" htmlFor="brand-site">
                  Sito del produttore
                </label>
                <input
                  id="brand-site"
                  name="websiteUrl"
                  className="input"
                  type="url"
                  placeholder="https://"
                />
              </div>
              <button type="submit" className="btn btn--secondary">
                Aggiungi marchio
              </button>
            </Form>
          ) : null}
        </section>

        {/* ── Categories ────────────────────────────────────────────────── */}
        <section className="panel stack">
          <h2>Categorie</h2>
          <p className="small muted">
            Che cosa è l&apos;accessorio: cover, cavi, caricabatterie, pellicole.
          </p>

          {categories.length === 0 ? (
            <p className="small muted">Nessuna categoria.</p>
          ) : (
            <ul className="ac-picker">
              {categories.map((category) => (
                <li key={category.id}>
                  <div className="ac-pick">
                    <span>
                      {category.name ?? category.slug}
                      {category.name === null ? (
                        <span className="badge badge--warning"> traduzione mancante</span>
                      ) : null}
                      {category.visible === 0 ? (
                        <span className="badge badge--muted"> nascosta</span>
                      ) : null}
                    </span>
                    <span className="cluster">
                      <span
                        className="ac-pick__count numeric"
                        title={`${category.product_count} prodotti`}
                      >
                        {category.product_count}
                      </span>
                      {canWrite ? (
                        <Form method="post">
                          <input type="hidden" name="intent" value="toggle-category" />
                          <input type="hidden" name="id" value={category.id} />
                          <button type="submit" className="btn btn--ghost btn--small">
                            {category.visible === 1 ? "Nascondi" : "Mostra"}
                          </button>
                        </Form>
                      ) : null}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          )}

          {canWrite ? (
            <Form method="post" className="stack">
              <input type="hidden" name="intent" value="add-category" />
              <div className="field">
                <label className="field__label" htmlFor="cat-name">
                  Nuova categoria
                </label>
                <input
                  id="cat-name"
                  name="name"
                  className="input"
                  required
                  maxLength={80}
                  placeholder="Cover e custodie"
                />
              </div>
              <div className="field">
                <label className="field__label" htmlFor="cat-type">
                  Tipo di accessorio
                </label>
                <input
                  id="cat-type"
                  name="accessoryType"
                  className="input"
                  list="accessory-types"
                  maxLength={50}
                  aria-describedby="cat-type-help"
                />
                <datalist id="accessory-types">
                  <option value="case" />
                  <option value="cable" />
                  <option value="charger" />
                  <option value="screen_protector" />
                  <option value="powerbank" />
                  <option value="audio" />
                </datalist>
                <span className="field__hint" id="cat-type-help">
                  Facoltativo. Serve al sito per sapere quali dettagli tecnici mostrare — la
                  lunghezza per un cavo, i watt per un caricabatterie.
                </span>
              </div>
              <button type="submit" className="btn btn--secondary">
                Aggiungi categoria
              </button>
            </Form>
          ) : null}
        </section>
      </div>

      <p className="caption muted">
        Né i marchi né le categorie si eliminano. Un prodotto vi fa riferimento, e il database
        rifiuterebbe comunque la cancellazione proprio per quelli in uso. Nascondere è
        l&apos;operazione onesta.
      </p>
    </>
  );
}
