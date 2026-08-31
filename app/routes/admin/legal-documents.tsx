import { Form, Link } from "react-router";
import type { Route } from "./+types/legal-documents";
import { cloudflareContext } from "../../../workers/app";
import { requireStaff } from "~/infrastructure/auth/session.server";
import { systemClock, cryptoIds } from "~/infrastructure/primitives";
import { formatDateTime } from "~/lib/i18n";
import { breadcrumbsFor } from "~/lib/admin-nav";
import { PageHeader } from "~/components/admin/admin-shell";

/**
 * Legal documents.
 *
 * **This system does not write these documents and will not generate them.**
 *
 * That is a deliberate refusal, not a gap. Privacy policy, terms of sale,
 * withdrawal instructions and warranty terms are legally binding statements
 * about a specific business, and a plausible-looking template is more dangerous
 * than an empty page: an empty page is obviously not finished, while a
 * generated one reads as done and gets published. If it is wrong, the shop
 * carries the consequence, not the software.
 *
 * So this screen does four things and no more:
 *
 *   1. Lists the documents the shop is required to have, so nothing is
 *      forgotten.
 *   2. Holds the text a lawyer supplied.
 *   3. Records versions, because consumers are entitled to the terms that were
 *      in force when they bought — not today's.
 *   4. Tracks whether a professional actually reviewed each one, separately
 *      from whether it is published.
 *
 * Point 3 is why versions are never edited in place. An order references the
 * terms version it was placed under; rewriting that row would silently change
 * what a past customer agreed to.
 */

export function meta() {
  return [{ title: "Documenti legali" }, { name: "robots", content: "noindex, nofollow" }];
}

/**
 * The documents this shop needs before it can lawfully sell online in Italy.
 *
 * Sources are named so a lawyer reviewing this list can check it rather than
 * trust it. `docs/legal-review-checklist.md` carries the detail.
 */
const REQUIRED_DOCUMENTS = [
  { code: "privacy_policy", name: "Informativa privacy", basis: "GDPR art. 13-14" },
  { code: "cookie_policy", name: "Informativa cookie", basis: "Direttiva ePrivacy" },
  { code: "terms_of_sale", name: "Condizioni generali di vendita", basis: "Codice del Consumo" },
  { code: "terms_of_use", name: "Condizioni d'uso del sito", basis: "D.Lgs. 70/2003" },
  { code: "withdrawal", name: "Diritto di recesso", basis: "Codice del Consumo art. 52-59" },
  {
    code: "withdrawal_form",
    name: "Modulo di recesso tipo",
    basis: "Codice del Consumo, allegato I-B",
  },
  { code: "warranty", name: "Garanzia legale di conformità", basis: "D.Lgs. 170/2021" },
  { code: "returns", name: "Politica di reso e rimborso", basis: "Codice del Consumo" },
  { code: "shipping", name: "Tempi e costi di consegna", basis: "Codice del Consumo art. 49" },
  { code: "dispute_resolution", name: "Risoluzione delle controversie", basis: "Reg. UE 524/2013" },
  {
    code: "accessibility",
    name: "Dichiarazione di accessibilità",
    basis: "European Accessibility Act",
  },
] as const;

export async function loader({ request, context }: Route.LoaderArgs) {
  const { env } = context.get(cloudflareContext);
  const actor = await requireStaff(request, env, "content.read");

  const documents = await env.DB.prepare(
    `SELECT d.id, d.code, d.name_it, d.current_version_id,
            v.id AS version_id, v.version, v.published_at, v.reviewed_by_lawyer,
            v.effective_from, v.review_note,
            (SELECT COUNT(*) FROM legal_document_versions vv WHERE vv.document_id = d.id) AS version_count,
            (LENGTH(COALESCE(v.body_it, '')) > 0) AS has_body
       FROM legal_documents d
       LEFT JOIN legal_document_versions v ON v.id = d.current_version_id
      ORDER BY d.code`,
  ).all<{
    id: string;
    code: string;
    name_it: string;
    current_version_id: string | null;
    version_id: string | null;
    version: string | null;
    published_at: number | null;
    reviewed_by_lawyer: number | null;
    effective_from: number | null;
    review_note: string | null;
    version_count: number;
    has_body: number;
  }>();

  const byCode = new Map(documents.results.map((d) => [d.code, d]));

  return {
    // The required list drives the screen, so a document that has never been
    // created still appears — as missing. Listing only what exists would hide
    // exactly the ones that matter.
    rows: REQUIRED_DOCUMENTS.map((required) => ({
      ...required,
      document: byCode.get(required.code) ?? null,
    })),
    extra: documents.results.filter((d) => !REQUIRED_DOCUMENTS.some((r) => r.code === d.code)),
    canWrite: actor.permissions.includes("content.write"),
    canPublish: actor.permissions.includes("content.publish"),
  };
}

export async function action({ request, context }: Route.ActionArgs) {
  const { env } = context.get(cloudflareContext);
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");
  const now = systemClock.now();

  if (intent === "save-draft") {
    const actor = await requireStaff(request, env, "content.write");
    const code = String(form.get("code") ?? "");
    const body = String(form.get("body") ?? "").trim();
    const versionLabel =
      String(form.get("version") ?? "").trim() || new Date(now).toISOString().slice(0, 10);

    const required = REQUIRED_DOCUMENTS.find((d) => d.code === code);
    if (!required) return { error: "Documento non riconosciuto." };
    if (body === "") return { error: "Il testo è vuoto." };

    const document = await env.DB.prepare(`SELECT id FROM legal_documents WHERE code = ?1`)
      .bind(code)
      .first<{ id: string }>();

    const statements: D1PreparedStatement[] = [];
    let documentId = document?.id ?? "";

    if (!document) {
      documentId = cryptoIds.generate();
      statements.push(
        env.DB.prepare(
          `INSERT INTO legal_documents (id, code, name_it, name_en, created_at, updated_at)
           VALUES (?1, ?2, ?3, ?3, ?4, ?4)`,
        ).bind(documentId, code, required.name, now),
      );
    }

    const versionId = cryptoIds.generate();
    statements.push(
      // A NEW version every time, never an edit of the existing one. An order
      // references the terms it was placed under; rewriting that row would
      // silently change what a past customer agreed to.
      env.DB.prepare(
        `INSERT INTO legal_document_versions
           (id, document_id, version, body_it, effective_from, reviewed_by_lawyer, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, 0, ?5)`,
      ).bind(versionId, documentId, versionLabel, body, now),

      env.DB.prepare(
        `INSERT INTO audit_logs
           (id, actor_id, actor_label, action, entity_type, entity_id, after_value, created_at)
         VALUES (?1,?2,?3,'legal.draft','legal_document_version',?4,?5,?6)`,
      ).bind(
        cryptoIds.generate(),
        actor.userId,
        actor.displayName,
        versionId,
        JSON.stringify({ code, version: versionLabel }),
        now,
      ),
    );

    await env.DB.batch(statements);
    return {
      success: `Bozza salvata come versione "${versionLabel}". Non è ancora pubblicata.`,
    };
  }

  if (intent === "publish") {
    const actor = await requireStaff(request, env, "content.publish");
    const versionId = String(form.get("versionId") ?? "");
    // getAll, not get: the hidden "false" companion comes first in the form
    // data, so form.get() would return it and ticking the box would never
    // register. Same trap as the settings booleans.
    const reviewed = form.getAll("reviewed").includes("true");
    const reviewNote = String(form.get("reviewNote") ?? "").trim();

    // Publishing without a professional review is allowed — it is the
    // merchant's business and their decision — but it must be a decision, made
    // in words, not something that happens by clicking through.
    if (!reviewed && reviewNote === "") {
      return {
        error:
          "Per pubblicare senza revisione legale, scrivi perché. Resta registrato: serve a te, se un domani qualcuno contesta questo testo.",
      };
    }

    const version = await env.DB.prepare(
      `SELECT id, document_id, version FROM legal_document_versions WHERE id = ?1`,
    )
      .bind(versionId)
      .first<{ id: string; document_id: string; version: string }>();
    if (!version) return { error: "Versione non trovata." };

    await env.DB.batch([
      env.DB.prepare(
        `UPDATE legal_document_versions
            SET published_at = ?1, published_by = ?2, reviewed_by_lawyer = ?3, review_note = ?4
          WHERE id = ?5`,
      ).bind(now, actor.userId, reviewed ? 1 : 0, reviewNote || null, versionId),

      env.DB.prepare(
        `UPDATE legal_documents SET current_version_id = ?1, updated_at = ?2 WHERE id = ?3`,
      ).bind(versionId, now, version.document_id),

      env.DB.prepare(
        `INSERT INTO audit_logs
           (id, actor_id, actor_label, action, entity_type, entity_id, after_value, created_at)
         VALUES (?1,?2,?3,'legal.publish','legal_document_version',?4,?5,?6)`,
      ).bind(
        cryptoIds.generate(),
        actor.userId,
        actor.displayName,
        versionId,
        JSON.stringify({ version: version.version, reviewedByLawyer: reviewed, reviewNote }),
        now,
      ),
    ]);

    return { success: `Versione "${version.version}" pubblicata.` };
  }

  return { error: "Azione non riconosciuta." };
}

export default function LegalDocuments({ loaderData, actionData }: Route.ComponentProps) {
  const { rows, extra, canWrite, canPublish } = loaderData;

  const published = rows.filter((r) => r.document?.published_at != null).length;
  const reviewed = rows.filter((r) => r.document?.reviewed_by_lawyer === 1).length;

  return (
    <>
      <PageHeader
        title="Documenti legali"
        description="I testi che il negozio è tenuto ad avere online. Il sistema non li scrive."
        breadcrumbs={breadcrumbsFor("/admin/contenuti/legale")}
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

      <p className="notice notice--warning">
        <strong>Questi testi non vengono generati dal sistema, e non lo saranno.</strong> Sono
        dichiarazioni vincolanti su questa azienda: un modello dall&apos;aria plausibile è più
        pericoloso di una pagina vuota, perché sembra finito e viene pubblicato. Fateli scrivere o
        rivedere da un professionista. Se sono sbagliati, la conseguenza è del negozio.
      </p>

      <section className="panel">
        <div className="ac-metrics">
          <div className="ac-metric">
            <span className="ac-metric__label">Pubblicati</span>
            <span className="ac-metric__value numeric">
              {published} / {rows.length}
            </span>
          </div>
          <div className="ac-metric">
            <span className="ac-metric__label">Rivisti da un professionista</span>
            <span className="ac-metric__value numeric">
              {reviewed} / {rows.length}
            </span>
            <span className="ac-metric__note">Diverso da &ldquo;pubblicato&rdquo;</span>
          </div>
        </div>
      </section>

      <div className="stack">
        {rows.map((row) => {
          const doc = row.document;
          const isPublished = doc?.published_at != null;

          return (
            <details key={row.code} className="panel" open={!isPublished}>
              <summary>
                <strong>{row.name}</strong>{" "}
                {isPublished ? (
                  <span className="badge badge--success">pubblicato</span>
                ) : doc && doc.version_count > 0 ? (
                  <span className="badge badge--warning">bozza non pubblicata</span>
                ) : (
                  <span className="badge badge--warning">mancante</span>
                )}{" "}
                {doc?.reviewed_by_lawyer === 1 ? (
                  <span className="badge badge--info">rivisto</span>
                ) : null}
              </summary>

              <div className="stack">
                <p className="caption muted">
                  Riferimento normativo: {row.basis} · codice <code>{row.code}</code>
                </p>

                {isPublished && doc ? (
                  <p className="small">
                    Versione <strong>{doc.version}</strong>, pubblicata il{" "}
                    {formatDateTime(doc.published_at!, "it")}.
                    {doc.reviewed_by_lawyer === 1
                      ? " Dichiarata rivista da un professionista."
                      : " Pubblicata senza revisione professionale."}
                    {doc.review_note ? (
                      <>
                        <br />
                        <span className="muted">Nota: {doc.review_note}</span>
                      </>
                    ) : null}
                  </p>
                ) : null}

                {canWrite ? (
                  <Form method="post" className="stack">
                    <input type="hidden" name="intent" value="save-draft" />
                    <input type="hidden" name="code" value={row.code} />

                    <div className="field">
                      <label className="field__label" htmlFor={`body-${row.code}`}>
                        Testo del documento
                      </label>
                      <textarea
                        id={`body-${row.code}`}
                        name="body"
                        className="input"
                        rows={10}
                        aria-describedby={`body-help-${row.code}`}
                      />
                      <span className="field__hint" id={`body-help-${row.code}`}>
                        Incollate qui il testo fornito dal vostro consulente. Salvando create una{" "}
                        <strong>nuova versione</strong>: quelle precedenti restano, perché un
                        cliente ha diritto alle condizioni in vigore quando ha comprato, non a
                        quelle di oggi.
                      </span>
                    </div>

                    <div className="field">
                      <label className="field__label" htmlFor={`version-${row.code}`}>
                        Etichetta della versione
                      </label>
                      <input
                        id={`version-${row.code}`}
                        name="version"
                        className="input"
                        placeholder="2026-08-31"
                      />
                      <span className="field__hint">Lasciate vuoto per usare la data di oggi.</span>
                    </div>

                    <button type="submit" className="btn btn--secondary">
                      Salva come bozza
                    </button>
                  </Form>
                ) : (
                  <p className="small muted">
                    Serve il permesso <code>content.write</code> per modificare.
                  </p>
                )}

                {canPublish && doc?.version_id && !isPublished ? (
                  <Form method="post" className="stack">
                    <input type="hidden" name="intent" value="publish" />
                    <input type="hidden" name="versionId" value={doc.version_id} />

                    <div className="field">
                      <input type="hidden" name="reviewed" value="false" />
                      <label className="field__checkbox" htmlFor={`rev-${row.code}`}>
                        <input
                          id={`rev-${row.code}`}
                          name="reviewed"
                          type="checkbox"
                          value="true"
                        />
                        <span>Questo testo è stato rivisto da un professionista</span>
                      </label>
                    </div>

                    <div className="field">
                      <label className="field__label" htmlFor={`note-${row.code}`}>
                        Nota
                      </label>
                      <input id={`note-${row.code}`} name="reviewNote" className="input" />
                      <span className="field__hint">
                        Se pubblicate senza revisione, scrivete perché. Resta registrato e serve a
                        voi, se un domani qualcuno contesta questo testo.
                      </span>
                    </div>

                    <button type="submit" className="btn btn--primary">
                      Pubblica sul sito
                    </button>
                  </Form>
                ) : null}
              </div>
            </details>
          );
        })}
      </div>

      {extra.length > 0 ? (
        <section className="panel stack">
          <h2>Altri documenti</h2>
          <p className="small muted">
            Documenti presenti nel database ma non nell&apos;elenco obbligatorio.
          </p>
          <ul className="stack small">
            {extra.map((d) => (
              <li key={d.id}>
                {d.name_it} — <code>{d.code}</code>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <p className="caption muted">
        L&apos;elenco completo dei controlli, con i riferimenti normativi, è in{" "}
        <code>docs/legal-review-checklist.md</code>. Vedi anche la{" "}
        <Link to="/admin/configurazione">configurazione</Link>.
      </p>
    </>
  );
}
