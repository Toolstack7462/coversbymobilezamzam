import { Form, Link } from "react-router";
import type { Route } from "./+types/navigation";
import { cloudflareContext } from "../../../workers/app";
import { requireStaff } from "~/infrastructure/auth/session.server";
import { systemClock, cryptoIds } from "~/infrastructure/primitives";
import { breadcrumbsFor } from "~/lib/admin-nav";
import { PageHeader } from "~/components/admin/admin-shell";

/**
 * Navigation.
 *
 * ── The part that is NOT editable here, and why ──────────────────────────────
 *
 * The category rail in the header and the category column in the footer are
 * read from the categories table. They are not editable here and they should
 * not be.
 *
 * That is not a missing feature, it is the fix for the worst defect this
 * storefront has had. The rail used to be a hardcoded list of eight slugs while
 * the catalogue held four under different names, so every category link in the
 * header and the footer led to a page reading "0 prodotti". A hand-maintained
 * menu is a foreign key with nothing enforcing it: the day somebody renames a
 * category, the menu keeps pointing at the old name and nothing says so.
 *
 * So the taxonomy stays derived. Rename a category and the menu renames itself;
 * hide one and it disappears from the menu at the same instant.
 *
 * ── What IS editable here ────────────────────────────────────────────────────
 *
 * Extra links, for the things that are not categories: a seasonal landing page,
 * the repairs page, a phone number. They are appended to the derived rail
 * rather than replacing it.
 *
 * Every destination is checked against something that actually exists — a
 * published page, a real category, or one of the shop's own routes — when it is
 * saved AND again when it is rendered. A link that stops resolving stops being
 * shown, rather than becoming a 404 the merchant finds out about from a
 * customer.
 */
export function meta() {
  return [{ title: "Menu e navigazione" }, { name: "robots", content: "noindex, nofollow" }];
}

/** The menus the storefront renders. Nothing else is offered. */
const MENUS = [
  { code: "header_extra", name: "Barra in alto", where: "Dopo le categorie, nell'intestazione." },
  { code: "footer_extra", name: "Piè di pagina", where: "Nella colonna Acquista, in fondo." },
] as const;

/** Routes the storefront actually has. A destination outside this set, or
 *  outside the pages and categories checked below, is refused. */
const FIXED_ROUTES = ["/", "/shop", "/trova-dispositivo", "/negozio", "/carrello"] as const;

async function resolvableTargets(db: D1Database) {
  const pages = await db
    .prepare(`SELECT slug FROM pages WHERE status = 'published' AND archived_at IS NULL`)
    .all<{ slug: string }>();
  const categories = await db
    .prepare(`SELECT slug FROM categories WHERE visible = 1 AND archived_at IS NULL`)
    .all<{ slug: string }>();

  return new Set([
    ...FIXED_ROUTES,
    ...pages.results.map((p) => `/pagine/${p.slug}`),
    ...categories.results.map((c) => `/shop?categoria=${c.slug}`),
  ]);
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const { env } = context.get(cloudflareContext);
  const actor = await requireStaff(request, env, "content.read");

  const items = await env.DB.prepare(
    `SELECT i.id, i.menu_id, i.label_it, i.label_en, i.url, i.sort_order, i.visible,
            m.code AS menu_code
       FROM navigation_items i
       JOIN navigation_menus m ON m.id = i.menu_id
      ORDER BY m.code, i.sort_order`,
  ).all<{
    id: string;
    menu_id: string;
    label_it: string;
    label_en: string;
    url: string;
    sort_order: number;
    visible: number;
    menu_code: string;
  }>();

  const targets = await resolvableTargets(env.DB);

  const categories = await env.DB.prepare(
    `SELECT c.slug, COALESCE(ct.name, c.slug) AS name
       FROM categories c
       LEFT JOIN category_translations ct ON ct.category_id = c.id AND ct.locale = 'it'
      WHERE c.visible = 1 AND c.archived_at IS NULL
      ORDER BY c.sort_order`,
  ).all<{ slug: string; name: string }>();

  const pages = await env.DB.prepare(
    `SELECT p.slug, COALESCE(t.title, p.slug) AS title
       FROM pages p
       LEFT JOIN page_translations t ON t.page_id = p.id AND t.locale = 'it'
      WHERE p.status = 'published' AND p.archived_at IS NULL
      ORDER BY p.sort_order`,
  ).all<{ slug: string; title: string }>();

  return {
    menus: MENUS,
    items: items.results.map((i) => ({ ...i, resolves: targets.has(i.url) })),
    // The derived rail, shown read-only so it is obvious why it is not a form.
    derivedCategories: categories.results,
    choices: [
      ...FIXED_ROUTES.map((url) => ({ url, label: url })),
      ...pages.results.map((p) => ({ url: `/pagine/${p.slug}`, label: p.title })),
    ],
    canWrite: actor.permissions.includes("content.write"),
  };
}

export async function action({ request, context }: Route.ActionArgs) {
  const { env } = context.get(cloudflareContext);
  await requireStaff(request, env, "content.write");

  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");
  const now = systemClock.now();

  if (intent === "add") {
    const menuCode = String(form.get("menu") ?? "");
    const labelIt = String(form.get("label_it") ?? "").trim();
    const labelEn = String(form.get("label_en") ?? "").trim() || labelIt;
    const url = String(form.get("url") ?? "").trim();

    if (!MENUS.some((m) => m.code === menuCode)) return { error: "Menu non riconosciuto." };
    if (labelIt === "") return { error: "L'etichetta è obbligatoria." };

    /*
     * The destination must resolve NOW.
     *
     * Checked against real published pages, visible categories and the shop's
     * own routes rather than against a regular expression. "Starts with a
     * slash" would happily accept /pagine/pagina-che-non-esiste.
     */
    const targets = await resolvableTargets(env.DB);
    if (!targets.has(url)) {
      return {
        error:
          `"${url}" non corrisponde a nessuna pagina pubblicata, categoria visibile ` +
          "o sezione del sito. Un link nel menu deve portare da qualche parte.",
      };
    }

    let menu = await env.DB.prepare(`SELECT id FROM navigation_menus WHERE code = ?1`)
      .bind(menuCode)
      .first<{ id: string }>();

    if (!menu) {
      const id = cryptoIds.generate();
      await env.DB.prepare(
        `INSERT INTO navigation_menus (id, code, name, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?4)`,
      )
        .bind(id, menuCode, MENUS.find((m) => m.code === menuCode)!.name, now)
        .run();
      menu = { id };
    }

    const last = await env.DB.prepare(
      `SELECT COALESCE(MAX(sort_order), 0) AS n FROM navigation_items WHERE menu_id = ?1`,
    )
      .bind(menu.id)
      .first<{ n: number }>();

    await env.DB.prepare(
      `INSERT INTO navigation_items
         (id, menu_id, parent_id, label_it, label_en, url, depth, sort_order, visible,
          created_at, updated_at)
       VALUES (?1, ?2, NULL, ?3, ?4, ?5, 0, ?6, 1, ?7, ?7)`,
    )
      .bind(cryptoIds.generate(), menu.id, labelIt, labelEn, url, (last?.n ?? 0) + 10, now)
      .run();

    return { success: "Voce aggiunta." };
  }

  if (intent === "remove") {
    const id = String(form.get("itemId") ?? "");
    await env.DB.prepare(`DELETE FROM navigation_items WHERE id = ?1`).bind(id).run();
    return { success: "Voce rimossa." };
  }

  if (intent === "toggle") {
    const id = String(form.get("itemId") ?? "");
    await env.DB.prepare(
      `UPDATE navigation_items SET visible = 1 - visible, updated_at = ?2 WHERE id = ?1`,
    )
      .bind(id, now)
      .run();
    return { success: "Visibilità aggiornata." };
  }

  return { error: "Azione non riconosciuta." };
}

export default function AdminNavigation({ loaderData, actionData }: Route.ComponentProps) {
  const { menus, items, derivedCategories, choices, canWrite } = loaderData;
  const broken = items.filter((i) => !i.resolves);

  return (
    <>
      <PageHeader
        title="Menu e navigazione"
        breadcrumbs={breadcrumbsFor("/admin/contenuti/menu")}
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

      <section className="panel">
        <h2>Le categorie non si modificano da qui</h2>
        <p className="small">
          La barra delle categorie viene letta dal catalogo. Se rinomini una categoria si rinomina
          anche nel menu; se la nascondi, sparisce dal menu nello stesso istante.
        </p>
        <p className="small">
          Non è una funzione mancante: è la correzione del difetto peggiore che questo sito abbia
          avuto. La barra era un elenco fisso di otto voci mentre il catalogo ne aveva quattro con
          nomi diversi, e{" "}
          <strong>ogni link di categoria portava a una pagina con zero prodotti</strong>. Un menu
          scritto a mano è un riferimento che nessuno controlla.
        </p>
        <ul className="cluster">
          {derivedCategories.map((c) => (
            <li key={c.slug} className="chip">
              {c.name}
            </li>
          ))}
        </ul>
        <p className="small">
          Si gestiscono da <Link to="/admin/marchi">Marchi e categorie</Link>.
        </p>
      </section>

      {broken.length > 0 ? (
        <p className="notice notice--warning">
          <strong>{broken.length} voci puntano a qualcosa che non esiste più.</strong> Non vengono
          mostrate sul sito — una pagina è stata spostata, spubblicata o archiviata dopo che il link
          era stato creato.
        </p>
      ) : null}

      {menus.map((menu) => {
        const menuItems = items.filter((i) => i.menu_code === menu.code);
        return (
          <section className="panel" key={menu.code}>
            <h2>{menu.name}</h2>
            <p className="small muted">{menu.where}</p>

            {menuItems.length === 0 ? (
              <p className="small">Nessuna voce aggiuntiva.</p>
            ) : (
              <div
                className="admin-table-wrap"
                /* Focusable and labelled: a region that scrolls sideways and cannot
             take focus is unscrollable without a mouse. */
                tabIndex={0}
                role="region"
                aria-label="Tabella scorrevole"
              >
                <table className="admin-table">
                  <caption className="visually-hidden">Voci di {menu.name}</caption>
                  <thead>
                    <tr>
                      <th scope="col">Etichetta</th>
                      <th scope="col">Destinazione</th>
                      <th scope="col">Stato</th>
                      {canWrite ? <th scope="col">Azioni</th> : null}
                    </tr>
                  </thead>
                  <tbody>
                    {menuItems.map((item) => (
                      <tr key={item.id}>
                        <td>
                          {item.label_it}
                          <br />
                          <span className="small muted">{item.label_en}</span>
                        </td>
                        <td>
                          <code className="small">{item.url}</code>
                        </td>
                        <td>
                          {!item.resolves ? (
                            <span className="badge badge--danger">non risolve</span>
                          ) : item.visible ? (
                            <span className="badge badge--success">visibile</span>
                          ) : (
                            <span className="badge badge--warning">nascosta</span>
                          )}
                        </td>
                        {canWrite ? (
                          <td>
                            <div className="cluster">
                              <Form method="post">
                                <input type="hidden" name="intent" value="toggle" />
                                <input type="hidden" name="itemId" value={item.id} />
                                <button className="btn" type="submit">
                                  {item.visible ? "Nascondi" : "Mostra"}
                                </button>
                              </Form>
                              <Form method="post">
                                <input type="hidden" name="intent" value="remove" />
                                <input type="hidden" name="itemId" value={item.id} />
                                <button className="btn btn--danger" type="submit">
                                  Rimuovi
                                </button>
                              </Form>
                            </div>
                          </td>
                        ) : null}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {canWrite ? (
              <Form method="post" className="stack">
                <input type="hidden" name="intent" value="add" />
                <input type="hidden" name="menu" value={menu.code} />
                <label>
                  Etichetta (italiano)
                  <input name="label_it" required maxLength={40} />
                </label>
                <label>
                  Etichetta (inglese)
                  <input name="label_en" maxLength={40} />
                  <span className="field-help">Vuota: viene usata quella italiana.</span>
                </label>
                <label>
                  Destinazione
                  <select name="url" required defaultValue="">
                    <option value="" disabled>
                      Scegli…
                    </option>
                    {choices.map((c) => (
                      <option key={c.url} value={c.url}>
                        {c.label} — {c.url}
                      </option>
                    ))}
                  </select>
                  <span className="field-help">
                    Solo pagine pubblicate e sezioni che esistono. Un menu non può puntare a una
                    pagina che non c&apos;è.
                  </span>
                </label>
                <button className="btn" type="submit">
                  Aggiungi voce
                </button>
              </Form>
            ) : null}
          </section>
        );
      })}
    </>
  );
}
