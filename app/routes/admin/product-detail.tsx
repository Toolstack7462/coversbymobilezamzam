import { Form, Link, useLocation, useSearchParams } from "react-router";
import type { Route } from "./+types/product-detail";
import { cloudflareContext } from "../../../workers/app";
import { requireStaff } from "~/infrastructure/auth/session.server";
import { systemClock, cryptoIds } from "~/infrastructure/primitives";
import { money, format as formatMoney, parseAmountToMinorUnits } from "~/domain/pricing/money";
import { formatDateTime } from "~/lib/i18n";
import { breadcrumbsFor } from "~/lib/admin-nav";
import { PageHeader } from "~/components/admin/admin-shell";

/**
 * One product.
 *
 * Organised by what the merchant came to change, not by which table the data
 * lives in. Details, price, stock and publication are four separate forms, each
 * saving independently, because a single save button over the whole page means
 * a failed price makes you retype the description.
 *
 * Two operations here carry real weight and are handled accordingly:
 *
 *   - **A price change writes `price_history`.** Without it the 30-day prior
 *     price cannot be evidenced and a discount could not lawfully be announced
 *     (D.Lgs. 84/2022). The old row is closed and a new one opened.
 *   - **Archiving is not deleting.** Orders reference this product and their
 *     snapshots must stay readable (invariant 13). The foreign key would refuse
 *     a delete anyway; archiving is the honest name for what actually happens.
 */

export function meta({ loaderData }: Route.MetaArgs) {
  const name = loaderData?.product?.name ?? loaderData?.product?.slug ?? "Prodotto";
  return [{ title: `${name} — prodotto` }, { name: "robots", content: "noindex, nofollow" }];
}

/**
 * Every database read this screen needs.
 *
 * Exported so `tests/integration/detail-queries.test.ts` can run exactly these
 * statements against the real schema. Raw SQL is invisible to TypeScript, and a
 * column renamed by a migration typechecks, builds, and throws a 500 the first
 * time a merchant opens the page.
 */
export async function loadProductDetail(env: Env, productId: string) {
  const product = await env.DB.prepare(
    `SELECT p.id, p.slug, p.status, p.archived_at, p.brand_id, p.primary_category_id,
            p.accessory_type, p.published_at, p.created_at, p.updated_at,
            pt.name, pt.short_description, pt.full_description, pt.seo_title, pt.seo_description,
            b.name AS brand_name
       FROM products p
       LEFT JOIN product_translations pt ON pt.product_id = p.id AND pt.locale = 'it'
       LEFT JOIN brands b ON b.id = p.brand_id
      WHERE p.id = ?1`,
  )
    .bind(productId)
    .first<{
      id: string;
      slug: string;
      status: string;
      archived_at: number | null;
      brand_id: string | null;
      primary_category_id: string | null;
      accessory_type: string | null;
      published_at: number | null;
      created_at: number;
      updated_at: number;
      name: string | null;
      short_description: string | null;
      full_description: string | null;
      seo_title: string | null;
      seo_description: string | null;
      brand_name: string | null;
    }>();

  // A 404 rather than an empty page: a product id that does not exist is a
  // stale link or a typo, and saying so is more use than a blank editor.
  if (!product) {
    throw new Response("Prodotto non trovato", { status: 404 });
  }

  const [variants, images, compatibility, priceHistory, brands, categories] = await Promise.all([
    env.DB.prepare(
      `SELECT v.id, v.sku, v.variant_label, v.colour, v.is_default, v.active,
              vp.amount, vp.currency,
              il.on_hand, il.reserved, il.reorder_threshold
         FROM product_variants v
         LEFT JOIN variant_prices vp ON vp.variant_id = v.id
         LEFT JOIN price_lists pl ON pl.id = vp.price_list_id AND pl.is_default = 1
         LEFT JOIN inventory_levels il ON il.variant_id = v.id
        WHERE v.product_id = ?1 AND v.archived_at IS NULL
        ORDER BY v.is_default DESC, v.sort_order, v.sku`,
    )
      .bind(productId)
      .all<{
        id: string;
        sku: string;
        variant_label: string | null;
        colour: string | null;
        is_default: number;
        active: number;
        amount: number | null;
        currency: string | null;
        on_hand: number | null;
        reserved: number | null;
        reorder_threshold: number | null;
      }>(),

    env.DB.prepare(
      `SELECT id, object_key, alt_it, width, height, is_primary
         FROM product_images
        WHERE product_id = ?1 ORDER BY is_primary DESC, sort_order LIMIT 20`,
    )
      .bind(productId)
      .all<{
        id: string;
        object_key: string;
        alt_it: string | null;
        width: number;
        height: number;
        is_primary: number;
      }>(),

    env.DB.prepare(
      // `device_models.name` is the model's own name; the translation table
      // only carries an optional per-locale display override, so COALESCE
      // rather than a plain join — otherwise every untranslated model would
      // render as a blank row.
      `SELECT pc.compatibility_level, pc.verified, dm.id AS model_id,
              COALESCE(dmt.display_name, dm.name) AS model_name,
              db.name AS brand_name
         FROM product_compatibility pc
         LEFT JOIN device_models dm ON dm.id = pc.device_model_id
         LEFT JOIN device_model_translations dmt
                ON dmt.device_model_id = dm.id AND dmt.locale = 'it'
         LEFT JOIN device_brands db ON db.id = dm.device_brand_id
        WHERE pc.product_id = ?1
        ORDER BY db.name, model_name
        LIMIT 200`,
    )
      .bind(productId)
      .all<{
        compatibility_level: string;
        verified: number;
        model_id: string | null;
        model_name: string | null;
        brand_name: string | null;
      }>(),

    env.DB.prepare(
      `SELECT ph.old_amount, ph.new_amount, ph.effective_from, ph.reason
         FROM price_history ph
         JOIN product_variants v ON v.id = ph.variant_id
        WHERE v.product_id = ?1
        ORDER BY ph.effective_from DESC
        LIMIT 10`,
    )
      .bind(productId)
      .all<{
        old_amount: number | null;
        new_amount: number;
        effective_from: number;
        reason: string | null;
      }>(),

    env.DB.prepare(`SELECT id, name FROM brands ORDER BY name`).all<{ id: string; name: string }>(),

    env.DB.prepare(
      `SELECT c.id, ct.name FROM categories c
         LEFT JOIN category_translations ct ON ct.category_id = c.id AND ct.locale = 'it'
        ORDER BY ct.name`,
    ).all<{ id: string; name: string | null }>(),
  ]);

  return {
    product,
    variants: variants.results,
    images: images.results,
    compatibility: compatibility.results,
    priceHistory: priceHistory.results,
    brands: brands.results,
    categories: categories.results.filter((c) => c.name !== null),
  };
}

export async function loader({ request, params, context }: Route.LoaderArgs) {
  const { env } = context.get(cloudflareContext);
  const actor = await requireStaff(request, env, "product.read");

  const data = await loadProductDetail(env, params.productId);

  return {
    ...data,
    canWrite: actor.permissions.includes("product.write"),
    canArchive: actor.permissions.includes("product.archive"),
    canPrice: actor.permissions.includes("price.write"),
  };
}

export async function action({ request, params, context }: Route.ActionArgs) {
  const { env } = context.get(cloudflareContext);
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");
  const now = systemClock.now();
  const productId = params.productId;

  const audit = (
    actorId: string,
    actorLabel: string,
    action: string,
    entityType: string,
    entityId: string,
    before: unknown,
    after: unknown,
  ) =>
    env.DB.prepare(
      `INSERT INTO audit_logs
         (id, actor_id, actor_label, action, entity_type, entity_id, before_value, after_value, created_at)
       VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9)`,
    ).bind(
      cryptoIds.generate(),
      actorId,
      actorLabel,
      action,
      entityType,
      entityId,
      before === null ? null : JSON.stringify(before),
      JSON.stringify(after),
      now,
    );

  if (intent === "save-details") {
    const actor = await requireStaff(request, env, "product.write");

    const name = String(form.get("name") ?? "").trim();
    if (name.length < 2) return { error: "Il nome è troppo corto." };

    const shortDescription = String(form.get("shortDescription") ?? "").trim() || null;
    const fullDescription = String(form.get("fullDescription") ?? "").trim() || null;
    const brandId = String(form.get("brandId") ?? "") || null;
    const categoryId = String(form.get("categoryId") ?? "") || null;

    await env.DB.batch([
      env.DB.prepare(
        `UPDATE products SET brand_id = ?1, primary_category_id = ?2, updated_at = ?3 WHERE id = ?4`,
      ).bind(brandId, categoryId, now, productId),

      // The translation row may not exist for a product imported without one.
      env.DB.prepare(
        `INSERT INTO product_translations
           (id, product_id, locale, name, short_description, full_description)
         VALUES (?1, ?2, 'it', ?3, ?4, ?5)
         ON CONFLICT(product_id, locale) DO UPDATE SET
           name = excluded.name,
           short_description = excluded.short_description,
           full_description = excluded.full_description`,
      ).bind(cryptoIds.generate(), productId, name, shortDescription, fullDescription),

      audit(actor.userId, actor.displayName, "product.update", "product", productId, null, {
        name,
        brandId,
        categoryId,
      }),
    ]);

    return { success: "Dettagli salvati." };
  }

  if (intent === "set-price") {
    const actor = await requireStaff(request, env, "price.write");
    const variantId = String(form.get("variantId") ?? "");
    const raw = String(form.get("amount") ?? "");

    let amount: number;
    try {
      amount = parseAmountToMinorUnits(raw);
    } catch {
      return { error: `Importo non leggibile: "${raw}". Usa la forma 39,90.` };
    }
    if (amount < 0) return { error: "Il prezzo non può essere negativo." };

    const priceList = await env.DB.prepare(
      `SELECT id FROM price_lists WHERE is_default = 1 LIMIT 1`,
    ).first<{ id: string }>();
    if (!priceList) return { error: "Nessun listino predefinito configurato." };

    const current = await env.DB.prepare(
      `SELECT id, amount FROM variant_prices WHERE variant_id = ?1 AND price_list_id = ?2`,
    )
      .bind(variantId, priceList.id)
      .first<{ id: string; amount: number }>();

    if (current && current.amount === amount) return { success: "Nessuna modifica." };

    const statements: D1PreparedStatement[] = [];

    if (current) {
      statements.push(
        env.DB.prepare(`UPDATE variant_prices SET amount = ?1, updated_at = ?2 WHERE id = ?3`).bind(
          amount,
          now,
          current.id,
        ),
      );
    } else {
      statements.push(
        env.DB.prepare(
          `INSERT INTO variant_prices
             (id, variant_id, price_list_id, amount, currency, created_at, updated_at)
           VALUES (?1, ?2, ?3, ?4, 'EUR', ?5, ?5)`,
        ).bind(cryptoIds.generate(), variantId, priceList.id, amount, now),
      );
    }

    statements.push(
      // Close the open history row, then open a new one. This pair is what
      // makes the 30-day prior price evidenced rather than asserted.
      env.DB.prepare(
        `UPDATE price_history SET effective_to = ?1
          WHERE variant_id = ?2 AND effective_to IS NULL`,
      ).bind(now, variantId),

      env.DB.prepare(
        `INSERT INTO price_history
           (id, variant_id, price_list_id, old_amount, new_amount, currency, channel,
            effective_from, reason, changed_by, created_at)
         VALUES (?1,?2,?3,?4,?5,'EUR','online',?6,'admin edit',?7,?6)`,
      ).bind(
        cryptoIds.generate(),
        variantId,
        priceList.id,
        current?.amount ?? null,
        amount,
        now,
        actor.userId,
      ),

      audit(
        actor.userId,
        actor.displayName,
        "price.update",
        "variant_price",
        variantId,
        current ? { amount: current.amount } : null,
        { amount },
      ),
    );

    await env.DB.batch(statements);
    return {
      success: current
        ? `Prezzo aggiornato: ${formatMoney(money(current.amount))} → ${formatMoney(money(amount))}.`
        : `Prezzo impostato: ${formatMoney(money(amount))}.`,
    };
  }

  if (intent === "set-status") {
    const actor = await requireStaff(request, env, "product.write");
    const status = String(form.get("status") ?? "");
    if (!["draft", "active"].includes(status)) return { error: "Stato non valido." };

    if (status === "active") {
      // Publishing a product nobody can buy produces a live page with no price
      // and no way to add it to a cart. Refused with the reason, rather than
      // allowed and then reported by the setup centre after the fact.
      const sellable = await env.DB.prepare(
        `SELECT
           (SELECT COUNT(*) FROM product_variants v
              JOIN variant_prices vp ON vp.variant_id = v.id
             WHERE v.product_id = ?1 AND v.archived_at IS NULL) AS priced`,
      )
        .bind(productId)
        .first<{ priced: number }>();

      if (!sellable || sellable.priced === 0) {
        return {
          error:
            "Non si può pubblicare un prodotto senza prezzo: sul sito comparirebbe una pagina che nessuno può acquistare. Imposta prima il prezzo.",
        };
      }
    }

    await env.DB.batch([
      env.DB.prepare(
        `UPDATE products SET status = ?1, published_at = COALESCE(published_at, ?2), updated_at = ?2
          WHERE id = ?3`,
      ).bind(status, now, productId),
      audit(actor.userId, actor.displayName, "product.status", "product", productId, null, {
        status,
      }),
    ]);

    return {
      success: status === "active" ? "Prodotto pubblicato." : "Prodotto riportato in bozza.",
    };
  }

  if (intent === "archive") {
    const actor = await requireStaff(request, env, "product.archive");

    await env.DB.batch([
      env.DB.prepare(
        `UPDATE products SET archived_at = ?1, status = 'archived', updated_at = ?1 WHERE id = ?2`,
      ).bind(now, productId),
      audit(actor.userId, actor.displayName, "product.archive", "product", productId, null, {
        archived: true,
      }),
    ]);

    return { success: "Prodotto archiviato. Gli ordini storici restano intatti." };
  }

  if (intent === "restore") {
    const actor = await requireStaff(request, env, "product.archive");

    await env.DB.batch([
      env.DB.prepare(
        `UPDATE products SET archived_at = NULL, status = 'draft', updated_at = ?1 WHERE id = ?2`,
      ).bind(now, productId),
      audit(actor.userId, actor.displayName, "product.restore", "product", productId, null, {
        archived: false,
      }),
    ]);

    // Back to draft rather than straight to active: what was true when it was
    // archived may not be true now.
    return { success: "Prodotto ripristinato in bozza." };
  }

  if (intent === "set-stock") {
    const actor = await requireStaff(request, env, "inventory.adjust");
    // Stock changes go through the inventory screen, which requires a reason
    // and writes a movement (invariant 4). Offering a bare field here would be
    // a second, unaudited path to the same number.
    return {
      error: "Le giacenze si modificano dall'inventario, dove ogni rettifica registra un motivo.",
      actorHint: actor.displayName,
    };
  }

  return { error: "Azione non riconosciuta." };
}

export default function ProductDetail({ loaderData, actionData }: Route.ComponentProps) {
  const { pathname } = useLocation();
  const [searchParams] = useSearchParams();
  const {
    product,
    variants,
    images,
    compatibility,
    priceHistory,
    brands,
    categories,
    canWrite,
    canArchive,
    canPrice,
  } = loaderData;

  const justCreated = searchParams.get("creato") === "1";
  const unverifiedExact = compatibility.filter(
    (c) => c.compatibility_level === "exact_fit" && c.verified === 0,
  ).length;

  return (
    <>
      <PageHeader
        title={product.name ?? product.slug}
        description={`SKU ${variants[0]?.sku ?? "—"} · /prodotti/${product.slug}`}
        breadcrumbs={breadcrumbsFor(pathname)}
        secondaryActions={[{ label: "Torna all'elenco", to: "/admin/prodotti" }]}
      />

      {justCreated ? (
        <p className="notice notice--success" role="status">
          Prodotto creato. È in bozza: non è ancora visibile sul sito. Da qui potete aggiungere
          foto, compatibilità e descrizione, poi pubblicarlo.
        </p>
      ) : null}

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

      {product.archived_at !== null ? (
        <p className="notice notice--warning" role="status">
          Questo prodotto è archiviato: non compare sul sito. Gli ordini che lo contengono restano
          intatti e leggibili.
        </p>
      ) : null}

      {/* ── What is missing ───────────────────────────────────────────────── */}
      <section className="panel stack">
        <h2>Stato del prodotto</h2>
        <ul className="ac-actions">
          <Check
            done={variants.some((v) => v.amount !== null)}
            label="Prezzo impostato"
            missing="Senza prezzo il prodotto non è acquistabile e non può essere pubblicato."
          />
          <Check
            done={images.length > 0}
            label="Almeno una foto"
            missing="Sul sito comparirebbe un riquadro vuoto al posto dell'immagine."
          />
          <Check
            done={compatibility.length > 0}
            label="Compatibilità registrata"
            missing="I clienti non possono filtrare questo prodotto per il proprio telefono."
          />
          <Check
            done={unverifiedExact === 0}
            label="Compatibilità verificate"
            missing={`${unverifiedExact} dichiarazioni di compatibilità esatta non sono state verificate. È il tipo di errore che genera resi.`}
          />
          <Check
            done={variants.every((v) => v.on_hand !== null)}
            label="Giacenza registrata"
            missing="Una variante senza riga di giacenza non risulta disponibile."
          />
        </ul>
      </section>

      {/* ── Publication ───────────────────────────────────────────────────── */}
      {canWrite && product.archived_at === null ? (
        <section className="panel stack">
          <h2>Pubblicazione</h2>
          <p className="small muted">
            {product.status === "active"
              ? "Il prodotto è visibile sul sito."
              : "Il prodotto è in bozza: lo vedete solo voi."}
          </p>
          <Form method="post" className="cluster">
            <input
              type="hidden"
              name="status"
              value={product.status === "active" ? "draft" : "active"}
            />
            <button type="submit" name="intent" value="set-status" className="btn btn--primary">
              {product.status === "active" ? "Riporta in bozza" : "Pubblica sul sito"}
            </button>
          </Form>
        </section>
      ) : null}

      {/* ── Details ───────────────────────────────────────────────────────── */}
      <section className="panel stack">
        <h2>Dettagli</h2>
        <Form method="post" className="stack">
          <input type="hidden" name="intent" value="save-details" />

          <div className="field">
            <label className="field__label" htmlFor="name">
              Nome
            </label>
            <input
              id="name"
              name="name"
              className="input"
              defaultValue={product.name ?? ""}
              disabled={!canWrite}
              maxLength={200}
              aria-describedby="name-help"
            />
            <span className="field__hint" id="name-help">
              Cambiare il nome <strong>non</strong> cambia l&apos;indirizzo della pagina (
              <code>/prodotti/{product.slug}</code>): i link già condivisi continuano a funzionare.
            </span>
          </div>

          <div className="field">
            <label className="field__label" htmlFor="shortDescription">
              Descrizione breve
            </label>
            <textarea
              id="shortDescription"
              name="shortDescription"
              className="input"
              rows={2}
              maxLength={500}
              defaultValue={product.short_description ?? ""}
              disabled={!canWrite}
            />
          </div>

          <div className="field">
            <label className="field__label" htmlFor="fullDescription">
              Descrizione completa
            </label>
            <textarea
              id="fullDescription"
              name="fullDescription"
              className="input"
              rows={6}
              defaultValue={product.full_description ?? ""}
              disabled={!canWrite}
            />
          </div>

          <div className="field">
            <label className="field__label" htmlFor="brandId">
              Marchio
            </label>
            <select
              id="brandId"
              name="brandId"
              className="input"
              defaultValue={product.brand_id ?? ""}
              disabled={!canWrite}
            >
              <option value="">— nessuno —</option>
              {brands.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </div>

          <div className="field">
            <label className="field__label" htmlFor="categoryId">
              Categoria
            </label>
            <select
              id="categoryId"
              name="categoryId"
              className="input"
              defaultValue={product.primary_category_id ?? ""}
              disabled={!canWrite}
            >
              <option value="">— nessuna —</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>

          {canWrite ? (
            <button type="submit" className="btn btn--primary">
              Salva dettagli
            </button>
          ) : (
            <p className="small muted">
              Serve il permesso <code>product.write</code> per modificare.
            </p>
          )}
        </Form>
      </section>

      {/* ── Variants, price and stock ─────────────────────────────────────── */}
      <section className="panel stack">
        <h2>Varianti</h2>
        <div className="ac-table-scroll">
          <table className="ac-table">
            <caption className="visually-hidden">Varianti del prodotto</caption>
            <thead>
              <tr>
                <th scope="col">SKU</th>
                <th scope="col">Variante</th>
                <th scope="col" className="ac-table__numeric">
                  Disponibile
                </th>
                <th scope="col">Prezzo</th>
              </tr>
            </thead>
            <tbody>
              {variants.map((variant) => (
                <tr key={variant.id}>
                  <td data-label="SKU" className="numeric">
                    {variant.sku}
                  </td>
                  <td data-label="Variante">
                    {variant.variant_label ?? variant.colour ?? "Unica"}
                    {variant.is_default === 1 ? (
                      <span className="badge badge--muted"> predefinita</span>
                    ) : null}
                  </td>
                  <td data-label="Disponibile" className="ac-table__numeric numeric">
                    {variant.on_hand === null ? (
                      <span className="badge badge--warning">non registrata</span>
                    ) : (
                      Math.max(0, variant.on_hand - (variant.reserved ?? 0))
                    )}
                  </td>
                  <td data-label="Prezzo">
                    {canPrice ? (
                      <Form method="post" className="cluster">
                        <input type="hidden" name="intent" value="set-price" />
                        <input type="hidden" name="variantId" value={variant.id} />
                        <label className="visually-hidden" htmlFor={`price-${variant.id}`}>
                          Prezzo per {variant.sku}
                        </label>
                        <input
                          id={`price-${variant.id}`}
                          name="amount"
                          className="input"
                          inputMode="decimal"
                          placeholder="39,90"
                          defaultValue={
                            variant.amount === null
                              ? ""
                              : formatMoney(money(variant.amount)).replace("€", "").trim()
                          }
                        />
                        <button type="submit" className="btn btn--secondary btn--small">
                          Salva
                        </button>
                      </Form>
                    ) : variant.amount === null ? (
                      <span className="badge badge--warning">nessun prezzo</span>
                    ) : (
                      formatMoney(money(variant.amount))
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="caption muted">
          Le giacenze si modificano dall&apos;<Link to="/admin/inventario">inventario</Link>, dove
          ogni rettifica registra un motivo e resta nel registro.
        </p>
      </section>

      {/* ── Price history ─────────────────────────────────────────────────── */}
      {priceHistory.length > 0 ? (
        <section className="panel stack">
          <h2>Storico prezzi</h2>
          <p className="small muted">
            Serve a dimostrare il prezzo più basso praticato negli ultimi 30 giorni. Senza questo
            storico uno sconto non può essere annunciato per legge (D.Lgs. 84/2022).
          </p>
          <ul className="stack small">
            {priceHistory.map((row, i) => (
              <li key={i}>
                <span className="numeric">{formatDateTime(row.effective_from, "it")}</span> —{" "}
                {row.old_amount === null ? (
                  <>prezzo iniziale {formatMoney(money(row.new_amount))}</>
                ) : (
                  <>
                    da {formatMoney(money(row.old_amount))} a {formatMoney(money(row.new_amount))}
                  </>
                )}
                {row.reason ? <span className="muted"> · {row.reason}</span> : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {/* ── Compatibility ─────────────────────────────────────────────────── */}
      <section className="panel stack">
        <h2>Compatibilità</h2>
        {compatibility.length === 0 ? (
          <div className="empty-state">
            <p>
              <strong>Nessuna compatibilità registrata</strong>
            </p>
            <p className="small muted">
              Finché non indicate con quali telefoni funziona, i clienti non possono trovarlo
              filtrando per dispositivo. La compatibilità non viene mai dedotta dalla categoria: se
              non è registrata, per il sito è sconosciuta.
            </p>
          </div>
        ) : (
          <ul className="stack small">
            {compatibility.map((row, i) => (
              <li key={i}>
                {row.brand_name ?? "—"} {row.model_name ?? row.model_id ?? "—"} ·{" "}
                <span className="badge badge--muted">{row.compatibility_level}</span>
                {row.compatibility_level === "exact_fit" && row.verified === 0 ? (
                  <span className="badge badge--warning"> non verificata</span>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* ── Archive ───────────────────────────────────────────────────────── */}
      {canArchive ? (
        <section className="panel stack">
          <h2>{product.archived_at === null ? "Archivia" : "Ripristina"}</h2>
          <p className="small muted">
            {product.archived_at === null
              ? "L'archiviazione toglie il prodotto dal sito senza cancellarlo. Gli ordini che lo contengono restano leggibili: per questo non esiste un pulsante per eliminarlo."
              : "Il prodotto tornerà in bozza, non direttamente online: quello che era vero quando è stato archiviato potrebbe non esserlo più."}
          </p>
          <Form method="post">
            <button
              type="submit"
              name="intent"
              value={product.archived_at === null ? "archive" : "restore"}
              className="btn btn--secondary"
            >
              {product.archived_at === null ? "Archivia prodotto" : "Ripristina prodotto"}
            </button>
          </Form>
        </section>
      ) : null}

      <p className="caption muted">
        Creato il {formatDateTime(product.created_at, "it")} · ultima modifica{" "}
        {formatDateTime(product.updated_at, "it")}
      </p>
    </>
  );
}

/** One readiness line. A mark AND a word AND a border — never colour alone. */
function Check({ done, label, missing }: { done: boolean; label: string; missing: string }) {
  return (
    <li className={`ac-action ${done ? "" : "ac-action--warning"}`}>
      <span className="ac-action__count" aria-hidden="true">
        {done ? "✓" : "—"}
      </span>
      <div className="ac-action__body">
        <p className="ac-action__label">
          {label}
          <span className="visually-hidden">{done ? " — fatto" : " — da completare"}</span>
        </p>
        {!done ? <p className="ac-action__detail small muted">{missing}</p> : null}
      </div>
    </li>
  );
}
