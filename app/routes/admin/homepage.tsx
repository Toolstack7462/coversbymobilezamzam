import { Form } from "react-router";
import type { Route } from "./+types/homepage";
import { cloudflareContext } from "../../../workers/app";
import { requireStaff } from "~/infrastructure/auth/session.server";
import { systemClock, cryptoIds } from "~/infrastructure/primitives";
import { breadcrumbsFor } from "~/lib/admin-nav";
import { PageHeader } from "~/components/admin/admin-shell";

/**
 * Homepage sections.
 *
 * The homepage is assembled from a fixed set of section TYPES, each of which
 * knows how to render itself from the catalogue. This screen decides which of
 * them appear, in what order, and what the words above them say.
 *
 * ── What this screen deliberately does not do ────────────────────────────────
 *
 * It is not a page builder. There is no free canvas, no arbitrary HTML, no
 * drag-and-drop of unrelated blocks — because every section here is backed by
 * real data the shop already has, and a block that renders whatever somebody
 * pasted into it is how a careful storefront turns into a flyer.
 *
 * The consequence worth stating: a section can be reordered or hidden, and its
 * heading rewritten, but it cannot be made to show something the shop does not
 * have. A "featured products" section with no featured products renders
 * nothing rather than an empty row with a heading over it.
 */
export function meta() {
  return [{ title: "Homepage" }, { name: "robots", content: "noindex, nofollow" }];
}

/**
 * The sections the storefront knows how to render.
 *
 * Adding one here without building it would put a switch in the admin that
 * does nothing — the exact failure this project keeps finding elsewhere — so
 * this list is the storefront's real repertoire and nothing more.
 */
const SECTION_TYPES = [
  {
    type: "hero",
    label: "Apertura",
    describe: "Il titolo grande e l'immagine in cima alla pagina.",
  },
  {
    type: "trust",
    label: "Perché noi",
    describe: "Le tre ragioni per comprare qui invece che da un marketplace.",
  },
  {
    type: "device_finder",
    label: "Trova il tuo dispositivo",
    describe: "La scorciatoia per marca e modello.",
  },
  {
    type: "categories",
    label: "Categorie",
    describe: "I riquadri delle categorie, con le loro immagini.",
  },
  {
    type: "featured_products",
    label: "Prodotti in evidenza",
    describe: "I prodotti contrassegnati in evidenza. Vuoto se non ce ne sono.",
  },
  {
    type: "store",
    label: "Il negozio",
    describe: "La fascia scura con l'indirizzo e gli orari.",
  },
] as const;

export async function loader({ request, context }: Route.LoaderArgs) {
  const { env } = context.get(cloudflareContext);
  const actor = await requireStaff(request, env, "content.read");

  const sections = await env.DB.prepare(
    `SELECT s.id, s.section_type, s.sort_order, s.visible,
            t.heading, t.subheading, t.cta_label, t.cta_url
       FROM homepage_sections s
       LEFT JOIN homepage_section_translations t
         ON t.section_id = s.id AND t.locale = 'it'
      ORDER BY s.sort_order`,
  ).all<{
    id: string;
    section_type: string;
    sort_order: number;
    visible: number;
    heading: string | null;
    subheading: string | null;
    cta_label: string | null;
    cta_url: string | null;
  }>();

  /*
   * A section type with no row yet is offered rather than hidden.
   *
   * Otherwise the only way to discover that the shop can show a "why us" band
   * is to read the source, and a capability nobody can find is the same as one
   * that does not exist.
   */
  const configured = new Set(sections.results.map((s) => s.section_type));

  return {
    sections: sections.results,
    available: SECTION_TYPES.filter((s) => !configured.has(s.type)),
    types: SECTION_TYPES,
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
    const type = String(form.get("section_type") ?? "");
    if (!SECTION_TYPES.some((s) => s.type === type)) {
      return { error: "Tipo di sezione non riconosciuto." };
    }

    const last = await env.DB.prepare(
      `SELECT COALESCE(MAX(sort_order), 0) AS n FROM homepage_sections`,
    ).first<{ n: number }>();

    await env.DB.prepare(
      `INSERT INTO homepage_sections (id, section_type, sort_order, visible, created_at, updated_at)
       VALUES (?1, ?2, ?3, 1, ?4, ?4)`,
    )
      .bind(cryptoIds.generate(), type, (last?.n ?? 0) + 10, now)
      .run();

    return { success: "Sezione aggiunta." };
  }

  if (intent === "save") {
    const id = String(form.get("sectionId") ?? "");
    const heading = String(form.get("heading") ?? "").trim();
    const subheading = String(form.get("subheading") ?? "").trim();
    const ctaLabel = String(form.get("cta_label") ?? "").trim();
    const ctaUrl = String(form.get("cta_url") ?? "").trim();

    /*
     * A call to action needs both halves.
     *
     * A label with no destination renders a button that goes nowhere; a
     * destination with no label renders nothing at all and looks like the
     * setting was ignored. Refusing here is clearer than either.
     */
    if ((ctaLabel === "") !== (ctaUrl === "")) {
      return { error: "Il pulsante ha bisogno sia del testo sia della destinazione." };
    }

    // Relative paths only. An absolute URL here would let a content editor
    // point the homepage's main button at another site.
    if (ctaUrl !== "" && !ctaUrl.startsWith("/")) {
      return { error: "La destinazione deve essere un indirizzo interno, che inizia con /." };
    }

    await env.DB.prepare(
      `INSERT INTO homepage_section_translations
         (id, section_id, locale, heading, subheading, cta_label, cta_url)
       VALUES (?1, ?2, 'it', ?3, ?4, ?5, ?6)
       ON CONFLICT(section_id, locale) DO UPDATE SET
         heading = excluded.heading, subheading = excluded.subheading,
         cta_label = excluded.cta_label, cta_url = excluded.cta_url`,
    )
      .bind(
        cryptoIds.generate(),
        id,
        heading || null,
        subheading || null,
        ctaLabel || null,
        ctaUrl || null,
      )
      .run();

    await env.DB.prepare(`UPDATE homepage_sections SET updated_at = ?2 WHERE id = ?1`)
      .bind(id, now)
      .run();

    return { success: "Testi salvati." };
  }

  if (intent === "toggle" || intent === "move") {
    const id = String(form.get("sectionId") ?? "");

    if (intent === "toggle") {
      await env.DB.prepare(
        `UPDATE homepage_sections SET visible = 1 - visible, updated_at = ?2 WHERE id = ?1`,
      )
        .bind(id, now)
        .run();
      return { success: "Visibilità aggiornata." };
    }

    // Reordering by swapping with the neighbour, rather than by typing a
    // number: "move this above that" is the decision being made, and a
    // sort_order field makes the person do the arithmetic instead.
    const direction = String(form.get("direction") ?? "up");
    const current = await env.DB.prepare(
      `SELECT id, sort_order FROM homepage_sections WHERE id = ?1`,
    )
      .bind(id)
      .first<{ id: string; sort_order: number }>();
    if (!current) return { error: "Sezione non trovata." };

    const neighbour = await env.DB.prepare(
      direction === "up"
        ? `SELECT id, sort_order FROM homepage_sections WHERE sort_order < ?1
            ORDER BY sort_order DESC LIMIT 1`
        : `SELECT id, sort_order FROM homepage_sections WHERE sort_order > ?1
            ORDER BY sort_order ASC LIMIT 1`,
    )
      .bind(current.sort_order)
      .first<{ id: string; sort_order: number }>();

    if (!neighbour) return { success: "È già in fondo alla sua direzione." };

    await env.DB.batch([
      env.DB.prepare(
        `UPDATE homepage_sections SET sort_order = ?2, updated_at = ?3 WHERE id = ?1`,
      ).bind(current.id, neighbour.sort_order, now),
      env.DB.prepare(
        `UPDATE homepage_sections SET sort_order = ?2, updated_at = ?3 WHERE id = ?1`,
      ).bind(neighbour.id, current.sort_order, now),
    ]);

    return { success: "Ordine aggiornato." };
  }

  if (intent === "remove") {
    const id = String(form.get("sectionId") ?? "");
    await env.DB.prepare(`DELETE FROM homepage_sections WHERE id = ?1`).bind(id).run();
    return { success: "Sezione rimossa dalla homepage." };
  }

  return { error: "Azione non riconosciuta." };
}

export default function AdminHomepage({ loaderData, actionData }: Route.ComponentProps) {
  const { sections, available, types, canWrite } = loaderData;
  const labelFor = (type: string) => types.find((t) => t.type === type);

  return (
    <>
      <PageHeader title="Homepage" breadcrumbs={breadcrumbsFor("/admin/contenuti/homepage")} />

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
          La homepage si compone di sezioni. Ognuna sa già disegnarsi da sola con i dati del
          negozio: qui si decide quali compaiono, in che ordine, e cosa dicono i testi sopra.
        </p>
        <p className="small">
          Non è un editor libero, di proposito. Una sezione può essere spostata, nascosta o
          riscritta, ma non può mostrare qualcosa che il negozio non ha — e se non ha niente da
          mostrare non compare, invece di lasciare un titolo sopra il vuoto.
        </p>
        {sections.length === 0 ? (
          <p className="notice notice--info">
            Nessuna sezione configurata: la homepage sta usando la sua composizione predefinita.
            Aggiungendone una qui, l&apos;ordine passa sotto il tuo controllo.
          </p>
        ) : null}
      </section>

      {canWrite && available.length > 0 ? (
        <section className="panel">
          <h2>Aggiungi una sezione</h2>
          <div className="stack">
            {available.map((s) => (
              <Form method="post" key={s.type} className="cluster">
                <input type="hidden" name="intent" value="add" />
                <input type="hidden" name="section_type" value={s.type} />
                <span>
                  <strong>{s.label}</strong>
                  <br />
                  <span className="small muted">{s.describe}</span>
                </span>
                <button className="btn" type="submit">
                  Aggiungi
                </button>
              </Form>
            ))}
          </div>
        </section>
      ) : null}

      <div className="stack">
        {sections.map((section, index) => {
          const meta = labelFor(section.section_type);
          return (
            <details className="panel" key={section.id} open={!section.visible}>
              <summary>
                <strong>{meta?.label ?? section.section_type}</strong>{" "}
                {section.visible ? (
                  <span className="badge badge--success">visibile</span>
                ) : (
                  <span className="badge badge--warning">nascosta</span>
                )}{" "}
                <span className="small muted">posizione {index + 1}</span>
              </summary>

              <p className="small muted">{meta?.describe}</p>

              {canWrite ? (
                <>
                  <Form method="post" className="stack">
                    <input type="hidden" name="intent" value="save" />
                    <input type="hidden" name="sectionId" value={section.id} />
                    <label>
                      Titolo
                      <input name="heading" defaultValue={section.heading ?? ""} maxLength={120} />
                    </label>
                    <label>
                      Sottotitolo
                      <input
                        name="subheading"
                        defaultValue={section.subheading ?? ""}
                        maxLength={200}
                      />
                    </label>
                    <label>
                      Testo del pulsante
                      <input
                        name="cta_label"
                        defaultValue={section.cta_label ?? ""}
                        maxLength={40}
                      />
                    </label>
                    <label>
                      Destinazione del pulsante
                      <input
                        name="cta_url"
                        defaultValue={section.cta_url ?? ""}
                        maxLength={200}
                        placeholder="/shop"
                      />
                      <span className="field-help">
                        Un indirizzo interno, che inizia con /. Servono sia il testo sia la
                        destinazione, o nessuno dei due.
                      </span>
                    </label>
                    <button className="btn" type="submit">
                      Salva testi
                    </button>
                  </Form>

                  <div className="cluster">
                    <Form method="post">
                      <input type="hidden" name="intent" value="move" />
                      <input type="hidden" name="sectionId" value={section.id} />
                      <input type="hidden" name="direction" value="up" />
                      <button className="btn" type="submit" disabled={index === 0}>
                        Sposta su
                      </button>
                    </Form>
                    <Form method="post">
                      <input type="hidden" name="intent" value="move" />
                      <input type="hidden" name="sectionId" value={section.id} />
                      <input type="hidden" name="direction" value="down" />
                      <button
                        className="btn"
                        type="submit"
                        disabled={index === sections.length - 1}
                      >
                        Sposta giù
                      </button>
                    </Form>
                    <Form method="post">
                      <input type="hidden" name="intent" value="toggle" />
                      <input type="hidden" name="sectionId" value={section.id} />
                      <button className="btn" type="submit">
                        {section.visible ? "Nascondi" : "Mostra"}
                      </button>
                    </Form>
                    <Form method="post">
                      <input type="hidden" name="intent" value="remove" />
                      <input type="hidden" name="sectionId" value={section.id} />
                      <button className="btn btn--danger" type="submit">
                        Rimuovi
                      </button>
                    </Form>
                  </div>
                </>
              ) : null}
            </details>
          );
        })}
      </div>
    </>
  );
}
