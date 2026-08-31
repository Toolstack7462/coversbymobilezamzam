import { Form, useLocation } from "react-router";
import type { Route } from "./+types/imports";
import { cloudflareContext } from "../../../workers/app";
import { requireStaff } from "~/infrastructure/auth/session.server";
import { systemClock, cryptoIds } from "~/infrastructure/primitives";
import { money, format as formatMoney } from "~/domain/pricing/money";
import { parseCsv, toCsv } from "~/domain/import/csv";
import {
  planProductImport,
  type CatalogueSnapshot,
  type ImportPlan,
} from "~/domain/import/product-import";
import { createProduct, CreateProductInput } from "~/application/commands/create-product";
import { breadcrumbsFor } from "~/lib/admin-nav";
import { PageHeader } from "~/components/admin/admin-shell";

/**
 * Bulk import and export.
 *
 * **Two steps, always.** Upload produces a PLAN and shows it; a second,
 * explicit confirmation applies it. There is no one-click import, and the
 * missing button is the feature: a bulk import is the most destructive thing a
 * merchant can do to their own catalogue, and one mis-mapped column silently
 * rewrites every price in the shop. The first sign of that is a customer paying
 * 3,99 for a 39,90 product.
 *
 * The plan is held in the form between the two steps rather than in a session
 * or a temporary table. That keeps the confirmation honest: what gets applied
 * is exactly the file that was analysed, not whatever the file happens to be by
 * the time the merchant presses the button.
 *
 * Export writes semicolon-delimited CSV with a BOM, because the file is going
 * to be opened in Italian Excel. A comma-delimited export opens there as a
 * single column, so a merchant who exports, edits and re-imports loses
 * everything.
 */

export function meta() {
  return [{ title: "Importa ed esporta" }, { name: "robots", content: "noindex, nofollow" }];
}

/** The columns an export writes and an import understands. */
const EXPORT_COLUMNS = ["sku", "nome", "prezzo", "giacenza", "descrizione", "marchio"];

export async function loader({ request, context }: Route.LoaderArgs) {
  const { env } = context.get(cloudflareContext);
  const actor = await requireStaff(request, env, "product.read");

  const recent = await env.DB.prepare(
    `SELECT id, filename, status, rows_total, rows_to_create, rows_to_update,
            rows_unchanged, rows_with_errors, created_at, confirmed_at
       FROM import_jobs ORDER BY created_at DESC LIMIT 10`,
  ).all<{
    id: string;
    filename: string;
    status: string;
    rows_total: number;
    rows_to_create: number;
    rows_to_update: number;
    rows_unchanged: number;
    rows_with_errors: number;
    created_at: number;
    confirmed_at: number | null;
  }>();

  const counts = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM products WHERE archived_at IS NULL`,
  ).first<{ n: number }>();

  return {
    recent: recent.results,
    productCount: Number(counts?.n ?? 0),
    canImport: actor.permissions.includes("import.run"),
    canWrite: actor.permissions.includes("product.write"),
  };
}

/** Everything the planner needs about what already exists. */
async function loadSnapshot(env: Env): Promise<CatalogueSnapshot> {
  const { results } = await env.DB.prepare(
    `SELECT v.sku,
            COALESCE(pt.name, '') AS name,
            (SELECT vp.amount FROM variant_prices vp
               JOIN price_lists pl ON pl.id = vp.price_list_id AND pl.is_default = 1
              WHERE vp.variant_id = v.id) AS price_minor,
            (SELECT il.on_hand FROM inventory_levels il WHERE il.variant_id = v.id) AS stock
       FROM product_variants v
       JOIN products p ON p.id = v.product_id
       LEFT JOIN product_translations pt ON pt.product_id = p.id AND pt.locale = 'it'
      WHERE p.archived_at IS NULL AND v.archived_at IS NULL`,
  ).all<{ sku: string; name: string; price_minor: number | null; stock: number | null }>();

  return {
    bySku: new Map(
      results.map((r) => [
        r.sku.toUpperCase(),
        { name: r.name, priceMinor: r.price_minor, stock: r.stock },
      ]),
    ),
  };
}

export async function action({ request, context }: Route.ActionArgs) {
  const { env } = context.get(cloudflareContext);
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");
  const now = systemClock.now();

  // ── Export ───────────────────────────────────────────────────────────────
  if (intent === "export") {
    await requireStaff(request, env, "product.read");

    const { results } = await env.DB.prepare(
      `SELECT v.sku,
              COALESCE(pt.name, '') AS nome,
              (SELECT vp.amount FROM variant_prices vp
                 JOIN price_lists pl ON pl.id = vp.price_list_id AND pl.is_default = 1
                WHERE vp.variant_id = v.id) AS prezzo_minor,
              (SELECT il.on_hand FROM inventory_levels il WHERE il.variant_id = v.id) AS giacenza,
              COALESCE(pt.short_description, '') AS descrizione,
              COALESCE(b.name, '') AS marchio
         FROM product_variants v
         JOIN products p ON p.id = v.product_id
         LEFT JOIN product_translations pt ON pt.product_id = p.id AND pt.locale = 'it'
         LEFT JOIN brands b ON b.id = p.brand_id
        WHERE p.archived_at IS NULL AND v.archived_at IS NULL
        ORDER BY pt.name, v.sku`,
    ).all<Record<string, string | number | null>>();

    const csv = toCsv(
      EXPORT_COLUMNS,
      results.map((row) => ({
        sku: String(row.sku ?? ""),
        nome: String(row.nome ?? ""),
        // Written the way Italian Excel reads it, and the way the importer
        // parses it back: a comma decimal, never a float.
        prezzo:
          row.prezzo_minor === null
            ? ""
            : formatMoney(money(Number(row.prezzo_minor)))
                .replace("€", "")
                .trim(),
        giacenza: row.giacenza === null ? "" : String(row.giacenza),
        descrizione: String(row.descrizione ?? ""),
        marchio: String(row.marchio ?? ""),
      })),
    );

    const stamp = new Date(now).toISOString().slice(0, 10);
    return new Response(csv, {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="prodotti-${stamp}.csv"`,
      },
    });
  }

  // ── Step one: analyse ────────────────────────────────────────────────────
  if (intent === "analyse") {
    await requireStaff(request, env, "import.run");
    const file = form.get("file");

    if (!(file instanceof File) || file.size === 0) {
      return { error: "Nessun file selezionato." };
    }
    if (file.size > 5 * 1024 * 1024) {
      return { error: "Il file supera 5 MB. Dividilo in più file." };
    }

    const text = await file.text();
    const parsed = parseCsv(text);

    if (parsed.headers.length === 0) {
      return { error: "Il file sembra vuoto." };
    }

    const plan = planProductImport(parsed.headers, parsed.rows, await loadSnapshot(env));

    return {
      plan,
      malformed: parsed.malformed,
      filename: file.name,
      delimiter: parsed.delimiter,
      // Carried forward so the confirmation applies exactly the file that was
      // analysed, rather than whatever the file is by then.
      payload: text,
    };
  }

  // ── Step two: apply ──────────────────────────────────────────────────────
  if (intent === "apply") {
    const actor = await requireStaff(request, env, "import.run");
    const payload = String(form.get("payload") ?? "");
    const filename = String(form.get("filename") ?? "importazione.csv");

    if (payload === "") return { error: "Nessun dato da applicare. Ricarica il file." };

    const parsed = parseCsv(payload);
    // Re-planned against the CURRENT catalogue, not the one from a minute ago.
    // Another member of staff may have changed a price in between, and applying
    // a stale plan would quietly undo their work.
    const plan = planProductImport(parsed.headers, parsed.rows, await loadSnapshot(env));

    if (!plan.applicable) {
      return { error: "Non c'è nulla da applicare, o manca la colonna del codice SKU." };
    }

    const location = await env.DB.prepare(
      `SELECT id FROM inventory_locations ORDER BY created_at LIMIT 1`,
    ).first<{ id: string }>();
    const priceList = await env.DB.prepare(
      `SELECT id FROM price_lists WHERE is_default = 1 LIMIT 1`,
    ).first<{ id: string }>();
    if (!location || !priceList) {
      return { error: "Sede di magazzino o listino predefinito mancante." };
    }

    const jobId = cryptoIds.generate();
    await env.DB.prepare(
      `INSERT INTO import_jobs
         (id, import_type, filename, status, rows_total, rows_to_create, rows_to_update,
          rows_unchanged, rows_with_errors, created_by, confirmed_by, confirmed_at,
          created_at, updated_at)
       VALUES (?1,'products',?2,'applied',?3,?4,?5,?6,?7,?8,?8,?9,?9,?9)`,
    )
      .bind(
        jobId,
        filename,
        plan.rows.length,
        plan.counts.create,
        plan.counts.update,
        plan.counts.unchanged,
        plan.counts.error,
        actor.userId,
        now,
      )
      .run();

    let created = 0;
    let updated = 0;
    const failures: string[] = [];

    for (const row of plan.rows) {
      if (row.outcome === "error" || row.outcome === "unchanged") continue;

      if (row.outcome === "create") {
        const result = await createProduct(
          CreateProductInput.parse({
            name: row.values.name ?? row.sku,
            sku: row.sku,
            ...(row.values.priceMinor !== undefined
              ? { price: (row.values.priceMinor / 100).toFixed(2).replace(".", ",") }
              : {}),
            onHand: row.values.stock ?? 0,
            ...(row.values.description ? { shortDescription: row.values.description } : {}),
          }),
          {
            d1: env.DB,
            clock: systemClock,
            ids: cryptoIds,
            defaultLocationId: location.id,
            actorId: actor.userId,
            actorLabel: actor.displayName,
          },
        );

        if (result.ok) created += 1;
        else failures.push(`riga ${row.rowNumber}: ${result.error}`);
        continue;
      }

      // An update touches only the fields the file actually carried. A price
      // change still writes price_history, exactly as a manual edit does — an
      // import must not be a way to change a price without a record of it
      // (D.Lgs. 84/2022).
      const variant = await env.DB.prepare(`SELECT id FROM product_variants WHERE sku = ?1`)
        .bind(row.sku)
        .first<{ id: string }>();
      if (!variant) {
        failures.push(`riga ${row.rowNumber}: ${row.sku} non trovato`);
        continue;
      }

      const statements: D1PreparedStatement[] = [];

      if (row.values.priceMinor !== undefined) {
        const current = await env.DB.prepare(
          `SELECT id, amount FROM variant_prices WHERE variant_id = ?1 AND price_list_id = ?2`,
        )
          .bind(variant.id, priceList.id)
          .first<{ id: string; amount: number }>();

        if (current && current.amount !== row.values.priceMinor) {
          statements.push(
            env.DB.prepare(
              `UPDATE variant_prices SET amount = ?1, updated_at = ?2 WHERE id = ?3`,
            ).bind(row.values.priceMinor, now, current.id),
            env.DB.prepare(
              `UPDATE price_history SET effective_to = ?1
                WHERE variant_id = ?2 AND effective_to IS NULL`,
            ).bind(now, variant.id),
            env.DB.prepare(
              `INSERT INTO price_history
                 (id, variant_id, price_list_id, old_amount, new_amount, currency, channel,
                  effective_from, reason, changed_by, created_at)
               VALUES (?1,?2,?3,?4,?5,'EUR','online',?6,'import',?7,?6)`,
            ).bind(
              cryptoIds.generate(),
              variant.id,
              priceList.id,
              current.amount,
              row.values.priceMinor,
              now,
              actor.userId,
            ),
          );
        }
      }

      if (row.values.name !== undefined) {
        statements.push(
          env.DB.prepare(
            `UPDATE product_translations SET name = ?1
              WHERE product_id = (SELECT product_id FROM product_variants WHERE id = ?2)
                AND locale = 'it'`,
          ).bind(row.values.name, variant.id),
        );
      }

      if (statements.length > 0) {
        statements.push(
          env.DB.prepare(
            `INSERT INTO audit_logs
               (id, actor_id, actor_label, action, entity_type, entity_id, after_value, created_at)
             VALUES (?1,?2,?3,'import.update','product_variant',?4,?5,?6)`,
          ).bind(
            cryptoIds.generate(),
            actor.userId,
            actor.displayName,
            variant.id,
            JSON.stringify({ jobId, sku: row.sku, values: row.values }),
            now,
          ),
        );
        await env.DB.batch(statements);
        updated += 1;
      }

      // Stock deliberately NOT changed here: an inventory movement needs a
      // reason and a ledger entry (invariant 4), and a spreadsheet column is
      // not a reason. The import reports it instead.
    }

    return {
      success:
        `Importazione completata: ${created} prodotti creati, ${updated} aggiornati.` +
        (plan.counts.error > 0 ? ` ${plan.counts.error} righe saltate per errori.` : "") +
        (failures.length > 0 ? ` Problemi: ${failures.slice(0, 3).join("; ")}` : ""),
      stockNote: plan.rows.some((r) => r.values.stock !== undefined)
        ? "Le giacenze nel file NON sono state applicate: ogni rettifica di magazzino richiede un motivo e va fatta dall'inventario."
        : null,
    };
  }

  return { error: "Azione non riconosciuta." };
}

export default function Imports({ loaderData, actionData }: Route.ComponentProps) {
  const { pathname } = useLocation();
  const { recent, productCount, canImport } = loaderData;

  const plan = actionData && "plan" in actionData ? (actionData.plan as ImportPlan) : null;
  const malformed = actionData && "malformed" in actionData ? actionData.malformed : [];

  return (
    <>
      <PageHeader
        title="Importa ed esporta"
        description="Per aggiornare molti prodotti in una volta, con un foglio di calcolo."
        breadcrumbs={breadcrumbsFor(pathname)}
      />

      {actionData && "error" in actionData && actionData.error ? (
        <p className="notice notice--danger" role="alert">
          {actionData.error}
        </p>
      ) : null}
      {actionData && "success" in actionData && actionData.success ? (
        <p className="notice notice--success" role="status">
          {actionData.success}
        </p>
      ) : null}
      {actionData && "stockNote" in actionData && actionData.stockNote ? (
        <p className="notice notice--warning" role="status">
          {actionData.stockNote}
        </p>
      ) : null}

      {/* ── Export ────────────────────────────────────────────────────────── */}
      <section className="panel stack">
        <h2>Esporta il catalogo</h2>
        <p className="small muted">
          Scarica <strong className="numeric">{productCount}</strong> prodotti in un file per Excel.
          Modificatelo e ricaricatelo qui: le righe si riconoscono dal codice SKU.
        </p>
        <Form method="post">
          <button type="submit" name="intent" value="export" className="btn btn--secondary">
            Scarica CSV
          </button>
        </Form>
      </section>

      {/* ── Import, step one ──────────────────────────────────────────────── */}
      {canImport ? (
        <section className="panel stack">
          <h2>Importa un file</h2>
          <p className="small muted">
            Il file viene <strong>analizzato prima</strong>: vedrete esattamente quante righe
            creano, aggiornano o non cambiano nulla, e solo dopo deciderete se applicarle. Nessuna
            modifica avviene al caricamento.
          </p>

          <Form method="post" encType="multipart/form-data" className="stack">
            <input type="hidden" name="intent" value="analyse" />
            <div className="field">
              <label className="field__label" htmlFor="file">
                File CSV
              </label>
              <input
                id="file"
                name="file"
                type="file"
                accept=".csv,text/csv"
                className="input"
                required
                aria-describedby="file-help"
              />
              <span className="field__hint" id="file-help">
                Colonne riconosciute: <code>sku</code>, <code>nome</code>, <code>prezzo</code>,{" "}
                <code>giacenza</code>, <code>descrizione</code>, <code>marchio</code>. Vanno bene
                sia i file separati da punto e virgola (quelli di Excel italiano) sia da virgola.
              </span>
            </div>
            <button type="submit" className="btn btn--secondary">
              Analizza il file
            </button>
          </Form>
        </section>
      ) : (
        <p className="notice notice--warning small">
          Serve il permesso <code>import.run</code> per importare.
        </p>
      )}

      {/* ── Import, step two ──────────────────────────────────────────────── */}
      {plan ? (
        <section className="panel stack">
          <h2>Cosa succederà</h2>

          <div className="ac-metrics">
            <div className="ac-metric">
              <span className="ac-metric__label">Da creare</span>
              <span className="ac-metric__value numeric">{plan.counts.create}</span>
            </div>
            <div className="ac-metric">
              <span className="ac-metric__label">Da aggiornare</span>
              <span className="ac-metric__value numeric">{plan.counts.update}</span>
            </div>
            <div className="ac-metric">
              <span className="ac-metric__label">Invariate</span>
              <span className="ac-metric__value numeric">{plan.counts.unchanged}</span>
            </div>
            <div className="ac-metric">
              <span className="ac-metric__label">Con errori</span>
              <span className="ac-metric__value numeric">{plan.counts.error}</span>
              <span className="ac-metric__note">Saltate, non applicate</span>
            </div>
          </div>

          {plan.missingColumns.length > 0 ? (
            <p className="notice notice--danger small">
              Manca la colonna <code>{plan.missingColumns.join(", ")}</code>. Senza il codice SKU
              non si può sapere a quale prodotto si riferisce ogni riga.
            </p>
          ) : null}

          {plan.unknownColumns.length > 0 ? (
            <p className="notice notice--warning small">
              Colonne non riconosciute, che verranno ignorate:{" "}
              <code>{plan.unknownColumns.join(", ")}</code>. Se una di queste conteneva dati
              importanti, rinominatela prima di procedere.
            </p>
          ) : null}

          {malformed.length > 0 ? (
            <p className="notice notice--warning small">
              {malformed.length} righe hanno un numero di colonne diverso dall&apos;intestazione e
              sono state saltate (righe {malformed.map((m) => m.rowNumber).join(", ")}). Una riga
              disallineata metterebbe il prezzo nella descrizione.
            </p>
          ) : null}

          {plan.rows.some((r) => r.warning !== null || r.outcome === "error") ? (
            <div
              className="ac-table-scroll"
              tabIndex={0}
              role="region"
              aria-label="Righe da controllare"
            >
              <table className="ac-table">
                <caption className="visually-hidden">Righe con errori o avvisi</caption>
                <thead>
                  <tr>
                    <th scope="col">Riga</th>
                    <th scope="col">SKU</th>
                    <th scope="col">Cosa succede</th>
                  </tr>
                </thead>
                <tbody>
                  {plan.rows
                    .filter((r) => r.warning !== null || r.outcome === "error")
                    .slice(0, 50)
                    .map((row) => (
                      <tr key={row.rowNumber}>
                        <td data-label="Riga" className="numeric">
                          {row.rowNumber}
                        </td>
                        <td data-label="SKU" className="numeric">
                          {row.sku || "—"}
                        </td>
                        <td data-label="Cosa succede">
                          {row.outcome === "error" ? (
                            <span className="badge badge--sale">saltata</span>
                          ) : (
                            <span className="badge badge--warning">da controllare</span>
                          )}{" "}
                          {row.message ?? row.warning}
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          ) : null}

          {plan.applicable ? (
            <Form method="post" className="stack">
              <input type="hidden" name="intent" value="apply" />
              <input
                type="hidden"
                name="payload"
                value={actionData && "payload" in actionData ? actionData.payload : ""}
              />
              <input
                type="hidden"
                name="filename"
                value={actionData && "filename" in actionData ? actionData.filename : ""}
              />
              <p className="notice notice--warning small">
                Le giacenze eventualmente presenti nel file <strong>non</strong> verranno applicate:
                una rettifica di magazzino richiede un motivo e si fa dall&apos;inventario, dove
                resta registrata.
              </p>
              <button type="submit" className="btn btn--primary">
                Applica {plan.counts.create + plan.counts.update} modifiche
              </button>
            </Form>
          ) : (
            <p className="small muted">Non c&apos;è nulla da applicare.</p>
          )}
        </section>
      ) : null}

      {/* ── History ───────────────────────────────────────────────────────── */}
      {recent.length > 0 ? (
        <section className="panel stack">
          <h2>Importazioni precedenti</h2>
          <ul className="stack small">
            {recent.map((job) => (
              <li key={job.id}>
                <strong>{job.filename}</strong> — {job.rows_to_create} creati, {job.rows_to_update}{" "}
                aggiornati, {job.rows_with_errors} con errori
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </>
  );
}
