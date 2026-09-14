import { saleableImageKey } from "~/domain/media/storefront-image";
import { Form, Link, redirect, useLocation, useSearchParams } from "react-router";
import type { Route } from "./+types/product-detail";
import { appContext, type AppEnv } from "~/runtime/context";
import { requireStaff } from "~/infrastructure/auth/session.server";
import { systemClock, cryptoIds } from "~/infrastructure/primitives";
import { money, format as formatMoney, parseAmountToMinorUnits } from "~/domain/pricing/money";
import { isCompatibilityLevel, COMPATIBILITY_LEVELS } from "~/domain/compatibility/resolve";
import {
  ACCESSORY_TYPES,
  ACCESSORY_TYPE_LABELS,
  accessoryTypeLabel,
  isAccessoryType,
  parseSpecValues,
  specColumnAllowed,
  specFieldsFor,
  type SpecColumn,
} from "~/domain/catalogue/product-types";
import {
  inspectImage,
  hashImage,
  imageObjectKey,
  ACCEPTED_IMAGE_TYPES,
  MAX_IMAGE_BYTES,
} from "~/domain/media/image";
import {
  COMPATIBILITY_LABELS,
  COMPATIBILITY_MEANING,
  compatibilityTone,
} from "~/lib/compatibility-views";
import { slugify, uniqueSlug } from "~/domain/catalogue/slug";
import { formatDateTime } from "~/lib/i18n";
import { breadcrumbsFor } from "~/lib/admin-nav";
import { PageHeader } from "~/components/admin/admin-shell";
import type { SqlStatement } from "~/infrastructure/db/sql";

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
export async function loadProductDetail(env: AppEnv, productId: string) {
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

  const [variants, images, compatibility, priceHistory, brands, categories, deviceModels] =
    await Promise.all([
      env.DB.prepare(
        `SELECT v.id, v.sku, v.variant_label, v.colour, v.is_default, v.active,
              v.capacity_mah, v.length_mm, v.connector, v.pack_size,
              v.weight_grams, v.dimensions_mm,
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
          capacity_mah: number | null;
          length_mm: number | null;
          connector: string | null;
          pack_size: number | null;
          weight_grams: number | null;
          dimensions_mm: string | null;
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
        `SELECT pc.id, pc.compatibility_level, pc.verified, pc.note, dm.id AS model_id,
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
          id: string;
          compatibility_level: string;
          verified: number;
          note: string | null;
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

      env.DB.prepare(`SELECT id, name FROM brands ORDER BY name`).all<{
        id: string;
        name: string;
      }>(),

      env.DB.prepare(
        `SELECT c.id, ct.name FROM categories c
         LEFT JOIN category_translations ct ON ct.category_id = c.id AND ct.locale = 'it'
        ORDER BY ct.name`,
      ).all<{ id: string; name: string | null }>(),

      // Only active models: an inactive one is a phone the shop has stopped
      // listing, and offering it here would put it straight back on the site.
      env.DB.prepare(
        `SELECT m.id, m.name, b.name AS brand_name, f.name AS family_name
         FROM device_models m
         LEFT JOIN device_brands b ON b.id = m.device_brand_id
         LEFT JOIN device_families f ON f.id = m.device_family_id
        WHERE m.active = 1
        ORDER BY b.name, f.release_year DESC, m.name`,
      ).all<{ id: string; name: string; brand_name: string | null; family_name: string | null }>(),
    ]);

  return {
    product,
    variants: variants.results,
    images: images.results,
    compatibility: compatibility.results,
    priceHistory: priceHistory.results,
    brands: brands.results,
    categories: categories.results.filter((c) => c.name !== null),
    deviceModels: deviceModels.results,
  };
}

export async function loader({ request, params, context }: Route.LoaderArgs) {
  const { env } = context.get(appContext);
  const actor = await requireStaff(request, env, "product.read");

  const data = await loadProductDetail(env, params.productId);

  return {
    ...data,
    // Where images are served from on this deployment. With a CDN configured
    // the storefront links straight there; without one, the Worker serves
    // them. The admin has to know which, or it renders broken thumbnails.
    mediaBaseUrl: env.PUBLIC_MEDIA_BASE_URL?.replace(/\/$/, "") ?? "/media",
    canWrite: actor.permissions.includes("product.write"),
    canArchive: actor.permissions.includes("product.archive"),
    canPrice: actor.permissions.includes("price.write"),
  };
}

export async function action({ request, params, context }: Route.ActionArgs) {
  const { env } = context.get(appContext);
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
      after === null ? null : JSON.stringify(after),
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

    /*
     * The kind of accessory this is.
     *
     * It decides which specification fields the variants section offers, so a
     * value outside the known list would produce a product with no fields and
     * no explanation. Validated here rather than trusted: the column is a
     * free-text VARCHAR and the select is only a suggestion to a browser.
     */
    const rawType = String(form.get("accessoryType") ?? "").trim();
    if (rawType !== "" && !isAccessoryType(rawType)) {
      return { error: "Tipo di prodotto non riconosciuto." };
    }
    const accessoryType = rawType === "" ? null : rawType;

    /*
     * ── THE CONFLICT GUARD ──────────────────────────────────────────────────
     *
     * The form carries the `updated_at` the page was LOADED with. If the row
     * has moved on since, somebody else saved while this form was open, and
     * writing now would silently discard their work — the merchant on the
     * other laptop would see their change vanish with no error anywhere.
     *
     * Two people editing one catalogue is not an exotic case in a shop with a
     * counter and a back office; it is Tuesday.
     *
     * The write is refused rather than merged. A merge needs to know which
     * field each person changed, and this form submits every field on every
     * save — so "merging" would mean picking a winner per field with no basis
     * for the choice. Refusing and saying so lets a person decide, which is
     * the only party that can.
     *
     * Compared as a NUMBER: `updated_at` is epoch milliseconds, and a string
     * comparison would quietly succeed for "1789000000000" versus
     * 1789000000000 and defeat the whole check.
     */
    const loadedAt = Number(form.get("loadedUpdatedAt") ?? 0);
    const current = await env.DB.prepare(`SELECT updated_at FROM products WHERE id = ?1`)
      .bind(productId)
      .first<{ updated_at: number }>();

    if (!current) return { error: "Prodotto non trovato." };

    if (Number.isFinite(loadedAt) && loadedAt > 0 && Number(current.updated_at) !== loadedAt) {
      return {
        conflict:
          "Qualcun altro ha salvato questo prodotto mentre lo stavate modificando. " +
          "Le vostre modifiche NON sono state salvate, e nemmeno sovrascritte le loro. " +
          "Ricaricate la pagina per vedere la versione aggiornata, poi riapplicate le vostre modifiche.",
      };
    }

    await env.DB.batch([
      env.DB.prepare(
        `UPDATE products SET brand_id = ?1, primary_category_id = ?2, accessory_type = ?3,
                             updated_at = ?4
          WHERE id = ?5`,
      ).bind(brandId, categoryId, accessoryType, now, productId),

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
        accessoryType,
      }),
    ]);

    return { success: "Dettagli salvati.", savedAt: now };
  }

  /*
   * ── SPECIFICATIONS, PER PRODUCT TYPE ────────────────────────────────────
   *
   * `product_variants` has carried `capacity_mah`, `length_mm`, `connector`,
   * `pack_size`, `weight_grams` and `dimensions_mm` since the first migration
   * and the admin surfaced NONE of them. The wattage of a charger — the first
   * thing a customer asks — could only go in the free-text description.
   *
   * Which of those six a given variant may write is decided by the PRODUCT's
   * accessory type, not by the form. A form field is a suggestion; this is the
   * rule, and it is applied again here so that a crafted post cannot put a
   * battery capacity on a phone case.
   */
  if (intent === "save-variant-specs") {
    const actor = await requireStaff(request, env, "product.write");
    const variantId = String(form.get("variantId") ?? "");

    const variant = await env.DB.prepare(
      `SELECT id FROM product_variants WHERE id = ?1 AND product_id = ?2 AND archived_at IS NULL`,
    )
      .bind(variantId, productId)
      .first<{ id: string }>();
    // Scoped to THIS product: a variant id from another product would
    // otherwise be editable by anybody who could guess one.
    if (!variant) return { error: "Variante non trovata." };

    const typeRow = await env.DB.prepare(`SELECT accessory_type FROM products WHERE id = ?1`)
      .bind(productId)
      .first<{ accessory_type: string | null }>();
    const accessoryType = typeRow?.accessory_type ?? null;

    if (!isAccessoryType(accessoryType)) {
      return {
        error:
          "Scegliete prima il tipo di prodotto in Dettagli: sono le specifiche da chiedere a " +
          "cambiare, non solo le etichette.",
      };
    }

    const parsed = parseSpecValues(accessoryType, (name) => {
      const value = form.get(name);
      return typeof value === "string" ? value : null;
    });

    if (parsed.errors.length > 0) return { error: parsed.errors.join(" ") };

    const columns = Object.keys(parsed.values) as SpecColumn[];
    if (columns.length === 0) return { error: "Nessuna specifica da salvare per questo tipo." };

    /*
     * The column names come from the template, and are checked against it
     * again before being interpolated.
     *
     * They cannot be bound as parameters — an identifier is not a value — so
     * the only thing standing between this and an injected identifier is that
     * every name came from a fixed table and is verified against that same
     * table one line before it is used.
     */
    for (const column of columns) {
      if (!specColumnAllowed(accessoryType, column)) {
        return { error: "Specifica non valida per questo tipo di prodotto." };
      }
    }

    const assignments = columns.map((column, index) => `${column} = ?${index + 1}`).join(", ");
    const binds = columns.map((column) => parsed.values[column] ?? null);

    await env.DB.batch([
      env.DB.prepare(
        `UPDATE product_variants SET ${assignments}, updated_at = ?${columns.length + 1}
          WHERE id = ?${columns.length + 2}`,
      ).bind(...binds, now, variantId),
      audit(
        actor.userId,
        actor.displayName,
        "product.variant.specs",
        "product_variant",
        variantId,
        null,
        parsed.values,
      ),
    ]);

    return { success: "Specifiche salvate.", savedAt: now };
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

    const statements: SqlStatement[] = [];

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

  if (intent === "add-variant") {
    const actor = await requireStaff(request, env, "product.write");
    const sku = String(form.get("sku") ?? "")
      .trim()
      .toUpperCase();
    const label = String(form.get("variantLabel") ?? "").trim() || null;
    const colour = String(form.get("colour") ?? "").trim() || null;
    const rawPrice = String(form.get("price") ?? "").trim();
    /*
     * Read strictly, like every other quantity in the admin.
     *
     * It was `Math.max(0, Math.trunc(Number(...) || 0))`, which turns anything
     * unreadable into zero WITHOUT saying so: "12 pezzi", "1,5", a pasted
     * "12 " with a non-breaking space - each one created a variant silently
     * holding no stock. The adjustment screens next door already refuse a
     * quantity they cannot read; this one guessed.
     */
    const rawOnHand = String(form.get("onHand") ?? "").trim();
    const onHand = rawOnHand === "" ? 0 : Number(rawOnHand);

    if (sku === "") return { error: "Il codice SKU è obbligatorio." };
    if (!Number.isInteger(onHand) || onHand < 0) {
      return { error: "La giacenza iniziale deve essere un numero intero non negativo." };
    }
    if (label === null && colour === null) {
      // Two variants that differ in nothing a customer can see are two rows the
      // shop cannot tell apart at the counter.
      return {
        error:
          "Dai un nome alla variante (colore, lunghezza, capacità). Senza, in cassa non si distingue da quella che esiste già.",
      };
    }

    let amount: number | null = null;
    if (rawPrice !== "") {
      try {
        amount = parseAmountToMinorUnits(rawPrice);
      } catch {
        return { error: `Prezzo non leggibile: "${rawPrice}". Usa la forma 39,90.` };
      }
      if (amount < 0) return { error: "Il prezzo non può essere negativo." };
    }

    const duplicate = await env.DB.prepare(`SELECT id FROM product_variants WHERE sku = ?1`)
      .bind(sku)
      .first<{ id: string }>();
    if (duplicate) return { error: `Il codice SKU "${sku}" è già usato.` };

    const location = await env.DB.prepare(
      `SELECT id FROM inventory_locations ORDER BY created_at LIMIT 1`,
    ).first<{ id: string }>();
    if (!location) return { error: "Nessuna sede di magazzino configurata." };

    const priceList = await env.DB.prepare(
      `SELECT id FROM price_lists WHERE is_default = 1 LIMIT 1`,
    ).first<{ id: string }>();
    if (!priceList) return { error: "Nessun listino predefinito configurato." };

    const nextSort = await env.DB.prepare(
      `SELECT COALESCE(MAX(sort_order), -1) + 1 AS n FROM product_variants WHERE product_id = ?1`,
    )
      .bind(productId)
      .first<{ n: number }>();

    const variantId = cryptoIds.generate();
    const statements: SqlStatement[] = [
      env.DB.prepare(
        // Never is_default: the product already has one, and two defaults would
        // make the storefront's initial selection arbitrary.
        `INSERT INTO product_variants
           (id, product_id, sku, variant_label, colour, is_default, active, sort_order,
            created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, 0, 1, ?6, ?7, ?7)`,
      ).bind(variantId, productId, sku, label, colour, nextSort?.n ?? 0, now),

      // Same reasoning as product creation: a variant with no inventory row is
      // at UNKNOWN stock, not zero, and would never be sellable.
      env.DB.prepare(
        `INSERT INTO inventory_levels
           (id, variant_id, location_id, on_hand, reserved, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, 0, ?5, ?5)`,
      ).bind(cryptoIds.generate(), variantId, location.id, onHand, now),
    ];

    if (amount !== null) {
      statements.push(
        env.DB.prepare(
          `INSERT INTO variant_prices
             (id, variant_id, price_list_id, amount, currency, created_at, updated_at)
           VALUES (?1, ?2, ?3, ?4, 'EUR', ?5, ?5)`,
        ).bind(cryptoIds.generate(), variantId, priceList.id, amount, now),

        env.DB.prepare(
          `INSERT INTO price_history
             (id, variant_id, price_list_id, old_amount, new_amount, currency, channel,
              effective_from, reason, changed_by, created_at)
           VALUES (?1,?2,?3,NULL,?4,'EUR','online',?5,'variant created',?6,?5)`,
        ).bind(cryptoIds.generate(), variantId, priceList.id, amount, now, actor.userId),
      );
    }

    statements.push(
      audit(actor.userId, actor.displayName, "variant.create", "product_variant", variantId, null, {
        productId,
        sku,
        label,
        colour,
      }),
    );

    await env.DB.batch(statements);
    return { success: `Variante "${label ?? colour}" aggiunta.` };
  }

  if (intent === "archive-variant") {
    const actor = await requireStaff(request, env, "product.write");
    const variantId = String(form.get("variantId") ?? "");

    const variant = await env.DB.prepare(
      `SELECT sku, is_default FROM product_variants WHERE id = ?1 AND product_id = ?2`,
    )
      .bind(variantId, productId)
      .first<{ sku: string; is_default: number }>();
    if (!variant) return { error: "Variante non trovata." };

    if (variant.is_default === 1) {
      // Removing the default would leave the storefront with nothing selected
      // when the page opens, and no rule for what to pick instead.
      return {
        error:
          "Non si può archiviare la variante predefinita. Rendine predefinita un'altra, poi archivia questa.",
      };
    }

    const remaining = await env.DB.prepare(
      `SELECT COUNT(*) AS n FROM product_variants WHERE product_id = ?1 AND archived_at IS NULL`,
    )
      .bind(productId)
      .first<{ n: number }>();
    if ((remaining?.n ?? 0) <= 1) {
      return { error: "Un prodotto deve avere almeno una variante." };
    }

    // Archived, never deleted: order_items reference this row (invariant 13).
    await env.DB.batch([
      env.DB.prepare(
        `UPDATE product_variants SET archived_at = ?1, active = 0, updated_at = ?1 WHERE id = ?2`,
      ).bind(now, variantId),
      audit(
        actor.userId,
        actor.displayName,
        "variant.archive",
        "product_variant",
        variantId,
        { sku: variant.sku },
        { archived: true },
      ),
    ]);

    return { success: `Variante ${variant.sku} archiviata. Gli ordini storici restano intatti.` };
  }

  if (intent === "set-default-variant") {
    const actor = await requireStaff(request, env, "product.write");
    const variantId = String(form.get("variantId") ?? "");

    await env.DB.batch([
      env.DB.prepare(`UPDATE product_variants SET is_default = 0 WHERE product_id = ?1`).bind(
        productId,
      ),
      env.DB.prepare(
        `UPDATE product_variants SET is_default = 1, updated_at = ?1
          WHERE id = ?2 AND product_id = ?3 AND archived_at IS NULL`,
      ).bind(now, variantId, productId),
      audit(
        actor.userId,
        actor.displayName,
        "variant.default",
        "product_variant",
        variantId,
        null,
        { productId },
      ),
    ]);

    return { success: "Variante predefinita aggiornata." };
  }

  if (intent === "upload-image") {
    const actor = await requireStaff(request, env, "product.write");
    const file = form.get("image");

    if (!(file instanceof File) || file.size === 0) {
      return { error: "Nessun file selezionato." };
    }

    const buffer = await file.arrayBuffer();

    // Validated from the file's own bytes, never from the browser-supplied
    // type: a file claiming to be a PNG while containing something else must
    // not be stored under a name that lies about it.
    const check = inspectImage(buffer);
    if (!check.ok) return { error: check.error };

    const hash = await hashImage(buffer);
    const key = imageObjectKey(productId, hash, check.facts.extension);

    // The key contains the content hash, so re-uploading the same photo is a
    // no-op on storage rather than a second copy. The database row is still
    // checked separately, because the same file could legitimately be attached
    // to two different products.
    const duplicate = await env.DB.prepare(
      `SELECT id FROM product_images WHERE product_id = ?1 AND object_key = ?2`,
    )
      .bind(productId, key)
      .first<{ id: string }>();
    if (duplicate) {
      return { error: "Questa immagine è già caricata su questo prodotto." };
    }

    const existingCount = await env.DB.prepare(
      `SELECT COUNT(*) AS n FROM product_images WHERE product_id = ?1`,
    )
      .bind(productId)
      .first<{ n: number }>();

    // R2 first, then the row. If the upload succeeds and the insert fails we
    // are left with an unreferenced object, which costs a fraction of a cent
    // and is invisible. The other order would leave a row pointing at nothing,
    // which renders a broken image on the shop.
    await env.MEDIA.put(key, buffer, {
      contentType: check.facts.type,
      // The key carries a content hash, so an object at a key never changes.
      cacheControl: "public, max-age=31536000, immutable",
    });

    const id = cryptoIds.generate();
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO product_images
           (id, product_id, object_key, alt_it, width, height, mime_type, file_size, file_hash,
            is_primary, sort_order, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)`,
      ).bind(
        id,
        productId,
        key,
        String(form.get("alt") ?? "").trim() || null,
        check.facts.width,
        check.facts.height,
        check.facts.type,
        check.facts.bytes,
        hash,
        // The first image uploaded becomes the primary one. Making the merchant
        // choose when there is only one candidate is a question with one answer.
        (existingCount?.n ?? 0) === 0 ? 1 : 0,
        existingCount?.n ?? 0,
        now,
      ),
      audit(actor.userId, actor.displayName, "product.image.add", "product_image", id, null, {
        productId,
        key,
        width: check.facts.width,
        height: check.facts.height,
      }),
    ]);

    return {
      success: `Immagine caricata (${check.facts.width}×${check.facts.height}).`,
    };
  }

  if (intent === "set-primary-image") {
    const actor = await requireStaff(request, env, "product.write");
    const id = String(form.get("imageId") ?? "");

    await env.DB.batch([
      env.DB.prepare(`UPDATE product_images SET is_primary = 0 WHERE product_id = ?1`).bind(
        productId,
      ),
      env.DB.prepare(
        `UPDATE product_images SET is_primary = 1 WHERE id = ?1 AND product_id = ?2`,
      ).bind(id, productId),
      audit(actor.userId, actor.displayName, "product.image.primary", "product_image", id, null, {
        productId,
      }),
    ]);

    return { success: "Immagine principale aggiornata." };
  }

  /*
   * ── ALT TEXT, AFTER THE FACT ────────────────────────────────────────────
   *
   * The gallery has always shown a "senza descrizione" warning on a photo with
   * no alt text, and there was no way to act on it: alt could only be set
   * during upload, so the only route to fixing one was to delete the photo and
   * upload it again.
   *
   * A warning a merchant cannot act on is worse than no warning. It teaches
   * them that the badges on this screen are decoration.
   */
  if (intent === "save-image-alt") {
    const actor = await requireStaff(request, env, "product.write");
    const id = String(form.get("imageId") ?? "");
    const alt = String(form.get("alt") ?? "").trim();

    const image = await env.DB.prepare(
      `SELECT id FROM product_images WHERE id = ?1 AND product_id = ?2`,
    )
      .bind(id, productId)
      .first<{ id: string }>();
    // Scoped to THIS product, so an id belonging to another product's photo is
    // not editable by anybody who can guess one.
    if (!image) return { error: "Immagine non trovata." };

    if (alt.length > 200)
      return { error: "La descrizione è troppo lunga (massimo 200 caratteri)." };

    await env.DB.batch([
      // An empty box CLEARS it rather than storing "". A photo with no
      // description and a photo described as nothing are the same thing, and
      // the warning badge keys on NULL.
      env.DB.prepare(`UPDATE product_images SET alt_it = ?1 WHERE id = ?2`).bind(
        alt === "" ? null : alt,
        id,
      ),
      audit(actor.userId, actor.displayName, "product.image.alt", "product_image", id, null, {
        alt: alt === "" ? null : alt,
      }),
    ]);

    return { success: alt === "" ? "Descrizione rimossa." : "Descrizione salvata.", savedAt: now };
  }

  /*
   * ── ORDER ───────────────────────────────────────────────────────────────
   *
   * `sort_order` decides the order of the gallery on the product page and has
   * never been editable. "Rendi principale" moves ONE photo to the front; it
   * says nothing about the other four, and a merchant photographing a case
   * from the front, the back and the side has an opinion about which comes
   * second.
   *
   * A swap with the neighbour rather than a drag-and-drop list: a swap works
   * with no JavaScript, works with a keyboard, works on a phone, and is two
   * buttons instead of a component.
   */
  if (intent === "move-image") {
    const actor = await requireStaff(request, env, "product.write");
    const id = String(form.get("imageId") ?? "");
    const direction = String(form.get("direction") ?? "");
    if (direction !== "up" && direction !== "down") {
      return { error: "Direzione non valida." };
    }

    /*
     * Read the whole gallery and swap in memory.
     *
     * `sort_order` is not guaranteed to be contiguous — a delete leaves a gap,
     * and every row imported at once starts at zero — so "find the row with
     * sort_order - 1" finds nothing. Position in the ORDERED list is the only
     * reliable notion of "the one above".
     */
    /*
     * The PRIMARY photo is pinned and is not part of the ordering.
     *
     * Every consumer of this gallery sorts `is_primary DESC, sort_order`, so a
     * primary photo is first whatever its sort_order says. Including it here
     * produced a button that did nothing: pressing ↑ on the second photo swapped
     * two numbers and changed no order at all, which is the worst kind of
     * control — it looks like it worked.
     *
     * So "principale" answers which photo leads, and the arrows answer the
     * order of the rest. Two controls, two questions, neither pretending to
     * override the other.
     */
    const { results: gallery } = await env.DB.prepare(
      `SELECT id, sort_order FROM product_images
        WHERE product_id = ?1 AND is_primary = 0 ORDER BY sort_order, id`,
    )
      .bind(productId)
      .all<{ id: string; sort_order: number }>();

    const index = gallery.findIndex((row) => row.id === id);
    if (index === -1) {
      return {
        error:
          "La foto principale è sempre la prima. Per cambiarla, rendete principale un'altra foto.",
      };
    }

    const target = direction === "up" ? index - 1 : index + 1;
    if (target < 0 || target >= gallery.length) {
      return { error: "La foto è già in fondo o in cima." };
    }

    /*
     * Renumber the WHOLE gallery from the swapped order.
     *
     * Swapping just the two `sort_order` values fails whenever they are equal
     * — which they are for everything the importer created — and the symptom
     * is a button that does nothing. Rewriting all of them costs one statement
     * per photo on a list capped at twenty, and it leaves the column
     * contiguous, which is the state everything else assumes.
     */
    const reordered = [...gallery];
    const moved = reordered[index];
    const other = reordered[target];
    if (moved === undefined || other === undefined) return { error: "Immagine non trovata." };
    reordered[index] = other;
    reordered[target] = moved;

    await env.DB.batch([
      ...reordered.map((row, position) =>
        env.DB.prepare(`UPDATE product_images SET sort_order = ?1 WHERE id = ?2`).bind(
          position,
          row.id,
        ),
      ),
      audit(actor.userId, actor.displayName, "product.image.reorder", "product_image", id, null, {
        direction,
        order: reordered.map((row) => row.id),
      }),
    ]);

    return { success: "Ordine delle foto aggiornato." };
  }

  if (intent === "delete-image") {
    const actor = await requireStaff(request, env, "product.write");
    const id = String(form.get("imageId") ?? "");

    const image = await env.DB.prepare(
      `SELECT object_key, is_primary FROM product_images WHERE id = ?1 AND product_id = ?2`,
    )
      .bind(id, productId)
      .first<{ object_key: string; is_primary: number }>();
    if (!image) return { error: "Immagine non trovata." };

    // The same object may be referenced by another product, since the key is a
    // content hash. Only remove the bytes when this was the last reference —
    // otherwise deleting one product's photo would blank another's.
    const otherReferences = await env.DB.prepare(
      `SELECT COUNT(*) AS n FROM product_images WHERE object_key = ?1 AND id <> ?2`,
    )
      .bind(image.object_key, id)
      .first<{ n: number }>();

    await env.DB.batch([
      env.DB.prepare(`DELETE FROM product_images WHERE id = ?1`).bind(id),
      audit(
        actor.userId,
        actor.displayName,
        "product.image.delete",
        "product_image",
        id,
        {
          key: image.object_key,
        },
        null,
      ),
    ]);

    if ((otherReferences?.n ?? 0) === 0) {
      await env.MEDIA.delete(image.object_key);
    }

    // Promote another image rather than leaving the product with none marked
    // primary, which would render no photo at all on the storefront.
    if (image.is_primary === 1) {
      const next = await env.DB.prepare(
        `SELECT id FROM product_images WHERE product_id = ?1 ORDER BY sort_order LIMIT 1`,
      )
        .bind(productId)
        .first<{ id: string }>();
      if (next) {
        await env.DB.prepare(`UPDATE product_images SET is_primary = 1 WHERE id = ?1`)
          .bind(next.id)
          .run();
      }
    }

    return { success: "Immagine eliminata." };
  }

  if (intent === "add-compatibility") {
    const actor = await requireStaff(request, env, "product.write");
    const deviceModelId = String(form.get("deviceModelId") ?? "");
    const level = String(form.get("level") ?? "");
    const note = String(form.get("note") ?? "").trim() || null;

    if (!isCompatibilityLevel(level)) return { error: "Livello non valido." };
    if (!deviceModelId) return { error: "Scegli un modello di telefono." };

    // A product-level record: variant_id NULL. The partial unique index on
    // (product_id, device_model_id) WHERE variant_id IS NULL is what actually
    // prevents two contradictory claims about the same phone — SQLite treats
    // NULLs as distinct, so a single index over all three columns would not.
    const existing = await env.DB.prepare(
      `SELECT id FROM product_compatibility
        WHERE product_id = ?1 AND device_model_id = ?2 AND variant_id IS NULL`,
    )
      .bind(productId, deviceModelId)
      .first<{ id: string }>();

    if (existing) {
      return {
        error:
          "Esiste già una dichiarazione per questo modello. Modificate quella invece di aggiungerne una seconda: due righe che dicono cose diverse sullo stesso telefono sono peggio di nessuna riga.",
      };
    }

    const id = cryptoIds.generate();
    await env.DB.batch([
      env.DB.prepare(
        // verified = 0 always. Nobody can assert a fit by filling in a form;
        // exact_fit in particular needs someone holding both objects.
        `INSERT INTO product_compatibility
           (id, product_id, variant_id, device_model_id, compatibility_level, note,
            verified, created_at, updated_at)
         VALUES (?1, ?2, NULL, ?3, ?4, ?5, 0, ?6, ?6)`,
      ).bind(id, productId, deviceModelId, level, note, now),

      audit(
        actor.userId,
        actor.displayName,
        "compatibility.create",
        "product_compatibility",
        id,
        null,
        {
          productId,
          deviceModelId,
          level,
        },
      ),
    ]);

    return {
      success:
        level === "exact_fit"
          ? "Compatibilità aggiunta. Va ancora verificata su un telefono vero prima che il sito la presenti come certa."
          : "Compatibilità aggiunta.",
    };
  }

  if (intent === "remove-compatibility") {
    const actor = await requireStaff(request, env, "product.write");
    const id = String(form.get("compatibilityId") ?? "");

    const row = await env.DB.prepare(
      `SELECT compatibility_level, device_model_id FROM product_compatibility WHERE id = ?1`,
    )
      .bind(id)
      .first<{ compatibility_level: string; device_model_id: string }>();
    if (!row) return { error: "Riga non trovata." };

    // A genuine delete, unlike products and devices. This row is not referenced
    // by any order: an order snapshots the compatibility state it was placed
    // under into `order_items.compatibility_state`, so removing the rule here
    // cannot rewrite history.
    await env.DB.batch([
      env.DB.prepare(`DELETE FROM product_compatibility WHERE id = ?1`).bind(id),
      audit(
        actor.userId,
        actor.displayName,
        "compatibility.delete",
        "product_compatibility",
        id,
        { level: row.compatibility_level, deviceModelId: row.device_model_id },
        null,
      ),
    ]);

    return { success: "Compatibilità rimossa." };
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

  /*
   * ── DUPLICATE ───────────────────────────────────────────────────────────
   *
   * "The same case, in a second colour" was a full re-entry: name, brand,
   * category, type, descriptions, every device it fits. For a shop whose whole
   * catalogue is variations on a theme, that is the most repeated task in the
   * admin and it was the one with no support at all.
   *
   * ── WHAT IS COPIED, AND WHAT IS DELIBERATELY NOT ────────────────────────
   *
   *   Copied      name, descriptions, brand, category, accessory type, the
   *               variants and their specifications, prices, the photographs
   *               (as references to the SAME stored objects — the picture of a
   *               case is the picture of a case), and device compatibility,
   *               which is the field that takes longest to enter by hand.
   *
   *   NOT copied  STOCK. Inventory rows are created at zero. Stock is a
   *               physical fact about a shelf, and a duplicate that arrives
   *               claiming twelve in hand is a duplicate that oversells on its
   *               first day.
   *
   *   NOT copied  publication. The copy is a DRAFT, always. A duplicate that
   *               went live on save would put a product named "… (copia)" in
   *               front of customers.
   */
  if (intent === "duplicate") {
    const actor = await requireStaff(request, env, "product.write");

    const source = await env.DB.prepare(
      `SELECT p.id, p.slug, p.brand_id, p.primary_category_id, p.accessory_type,
              p.product_family_id, pt.name, pt.short_description, pt.full_description
         FROM products p
         LEFT JOIN product_translations pt ON pt.product_id = p.id AND pt.locale = 'it'
        WHERE p.id = ?1`,
    )
      .bind(productId)
      .first<{
        id: string;
        slug: string;
        brand_id: string | null;
        primary_category_id: string | null;
        accessory_type: string | null;
        product_family_id: string | null;
        name: string | null;
        short_description: string | null;
        full_description: string | null;
      }>();

    if (!source) return { error: "Prodotto non trovato." };

    const newId = cryptoIds.generate();
    const newName = `${source.name ?? source.slug} (copia)`;

    /*
     * Every slug in the catalogue, so `uniqueSlug` can append the first free
     * suffix. Reading them all is fine at this size and the reason is honest:
     * there is no way to ask the database for "the next free variant of this
     * slug" without either a scan or a loop of failing inserts.
     */
    const { results: slugRows } = await env.DB.prepare(`SELECT slug FROM products`).all<{
      slug: string;
    }>();
    const newSlug = uniqueSlug(
      slugify(newName),
      slugRows.map((r) => r.slug),
    );

    const { results: skuRows } = await env.DB.prepare(`SELECT sku FROM product_variants`).all<{
      sku: string;
    }>();
    const takenSkus = new Set(skuRows.map((r) => r.sku));

    const { results: sourceVariants } = await env.DB.prepare(
      `SELECT id, sku, variant_label, colour, capacity_mah, length_mm, connector,
              pack_size, weight_grams, dimensions_mm, allow_backorder, is_default, sort_order
         FROM product_variants
        WHERE product_id = ?1 AND archived_at IS NULL
        ORDER BY is_default DESC, sort_order`,
    )
      .bind(productId)
      .all<{
        id: string;
        sku: string;
        variant_label: string | null;
        colour: string | null;
        capacity_mah: number | null;
        length_mm: number | null;
        connector: string | null;
        pack_size: number | null;
        weight_grams: number | null;
        dimensions_mm: string | null;
        allow_backorder: number;
        is_default: number;
        sort_order: number;
      }>();

    if (sourceVariants.length === 0) {
      return { error: "Questo prodotto non ha varianti da duplicare." };
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

    const statements: SqlStatement[] = [
      env.DB.prepare(
        `INSERT INTO products
           (id, slug, status, brand_id, primary_category_id, accessory_type,
            product_family_id, is_featured, is_new, is_bestseller, published_at,
            created_at, updated_at)
         VALUES (?1, ?2, 'draft', ?3, ?4, ?5, ?6, 0, 0, 0, NULL, ?7, ?7)`,
      ).bind(
        newId,
        newSlug,
        source.brand_id,
        source.primary_category_id,
        source.accessory_type,
        source.product_family_id,
        now,
      ),
      env.DB.prepare(
        `INSERT INTO product_translations
           (id, product_id, locale, name, short_description, full_description)
         VALUES (?1, ?2, 'it', ?3, ?4, ?5)`,
      ).bind(
        cryptoIds.generate(),
        newId,
        newName,
        source.short_description,
        source.full_description,
      ),
    ];

    const variantIdMap = new Map<string, string>();

    for (const variant of sourceVariants) {
      const copyId = cryptoIds.generate();
      variantIdMap.set(variant.id, copyId);

      /*
       * A SKU is what a person reads off a box, so the copy's SKU has to be
       * both unique AND recognisably related to the original: `-C`, then `-C2`,
       * `-C3`. Checked against every SKU in the catalogue rather than against
       * this product's, because the unique index is global and a collision here
       * is a failed insert in the middle of a batch.
       */
      let sku = `${variant.sku}-C`;
      let attempt = 2;
      while (takenSkus.has(sku)) {
        sku = `${variant.sku}-C${attempt}`;
        attempt += 1;
      }
      takenSkus.add(sku);

      statements.push(
        env.DB.prepare(
          `INSERT INTO product_variants
             (id, product_id, sku, variant_label, colour, capacity_mah, length_mm,
              connector, pack_size, weight_grams, dimensions_mm, allow_backorder,
              active, is_default, available_online, available_for_pickup,
              sort_order, created_at, updated_at)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, 1, ?13, 1, 1, ?14, ?15, ?15)`,
        ).bind(
          copyId,
          newId,
          sku,
          variant.variant_label,
          variant.colour,
          variant.capacity_mah,
          variant.length_mm,
          variant.connector,
          variant.pack_size,
          variant.weight_grams,
          variant.dimensions_mm,
          variant.allow_backorder,
          variant.is_default,
          variant.sort_order,
          now,
        ),

        // Zero on hand, always. See the note above the action.
        env.DB.prepare(
          `INSERT INTO inventory_levels
             (id, variant_id, location_id, on_hand, reserved, incoming, allow_backorder,
              created_at, updated_at)
           VALUES (?1, ?2, ?3, 0, 0, 0, ?4, ?5, ?5)`,
        ).bind(cryptoIds.generate(), copyId, location.id, variant.allow_backorder, now),
      );
    }

    // Prices, read once for every source variant rather than once per variant.
    const { results: sourcePrices } = await env.DB.prepare(
      `SELECT vp.variant_id, vp.amount, vp.currency
         FROM variant_prices vp
         JOIN product_variants v ON v.id = vp.variant_id
        WHERE v.product_id = ?1 AND vp.price_list_id = ?2`,
    )
      .bind(productId, priceList.id)
      .all<{ variant_id: string; amount: number; currency: string }>();

    for (const price of sourcePrices) {
      const copyId = variantIdMap.get(price.variant_id);
      if (copyId === undefined) continue;
      statements.push(
        env.DB.prepare(
          `INSERT INTO variant_prices
             (id, variant_id, price_list_id, amount, currency, created_at, updated_at)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6)`,
        ).bind(cryptoIds.generate(), copyId, priceList.id, price.amount, price.currency, now),
      );
    }

    /*
     * Photographs: new rows, the SAME object keys.
     *
     * The stored bytes are shared, so duplicating a product costs no storage
     * and the copy is not sitting there waiting for somebody to re-upload a
     * photograph of the identical object.
     */
    const { results: sourceImages } = await env.DB.prepare(
      `SELECT object_key, alt_it, alt_en, width, height, mime_type, file_size,
              file_hash, is_primary, sort_order
         FROM product_images WHERE product_id = ?1`,
    )
      .bind(productId)
      .all<{
        object_key: string;
        alt_it: string | null;
        alt_en: string | null;
        width: number;
        height: number;
        mime_type: string;
        file_size: number;
        file_hash: string | null;
        is_primary: number;
        sort_order: number;
      }>();

    for (const image of sourceImages) {
      statements.push(
        env.DB.prepare(
          `INSERT INTO product_images
             (id, product_id, object_key, alt_it, alt_en, width, height, mime_type,
              file_size, file_hash, is_primary, sort_order, created_at)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)`,
        ).bind(
          cryptoIds.generate(),
          newId,
          image.object_key,
          image.alt_it,
          image.alt_en,
          image.width,
          image.height,
          image.mime_type,
          image.file_size,
          image.file_hash,
          image.is_primary,
          image.sort_order,
          now,
        ),
      );
    }

    /*
     * Compatibility, at PRODUCT level only.
     *
     * Rows scoped to one variant are skipped rather than remapped. A
     * variant-scoped statement says "the 2 m version fits this phone", and
     * re-asserting that about a copy nobody has looked at yet would be
     * inventing a claim about fit — which is the one thing this catalogue
     * exists to get right. The copy keeps the product-wide statements, which
     * are the part that takes twenty minutes to type, and anything
     * variant-specific is re-confirmed by a person.
     */
    const { results: sourceCompat } = await env.DB.prepare(
      `SELECT device_model_id, compatibility_level, note
         FROM product_compatibility
        WHERE product_id = ?1 AND variant_id IS NULL`,
    )
      .bind(productId)
      .all<{ device_model_id: string; compatibility_level: string; note: string | null }>();

    for (const row of sourceCompat) {
      statements.push(
        env.DB.prepare(
          `INSERT INTO product_compatibility
             (id, product_id, variant_id, device_model_id, compatibility_level, note,
              verified, created_at, updated_at)
           VALUES (?1, ?2, NULL, ?3, ?4, ?5, 0, ?6, ?6)`,
        ).bind(
          cryptoIds.generate(),
          newId,
          row.device_model_id,
          row.compatibility_level,
          row.note,
          now,
        ),
      );
    }

    statements.push(
      audit(actor.userId, actor.displayName, "product.duplicate", "product", newId, null, {
        copiedFrom: productId,
        slug: newSlug,
        variants: sourceVariants.length,
        images: sourceImages.length,
        compatibility: sourceCompat.length,
      }),
    );

    await env.DB.batch(statements);

    // Straight to the copy. The merchant duplicated it in order to change
    // something, and landing back on the original means finding the copy by
    // hand in a list where its name differs by one word.
    return redirect(`/admin/prodotti/${newId}?duplicato=1`);
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
    deviceModels,
    mediaBaseUrl,
    canWrite,
    canArchive,
    canPrice,
  } = loaderData;

  const justCreated = searchParams.get("creato") === "1";
  const justDuplicated = searchParams.get("duplicato") === "1";
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

      {/*
        A copy says what it did NOT copy.

        The dangerous half of a duplicate is the part a merchant assumes came
        across. Stock did not — it starts at zero, because a copy is not merch-
        andise on a shelf — and saying so here is the difference between a
        deliberate zero and one discovered when the shop refuses a sale.
      */}
      {justDuplicated ? (
        <p className="notice notice--success" role="status">
          Copia creata, in bozza. Foto, compatibilità e prezzi sono stati copiati.{" "}
          <strong>Le giacenze sono a zero</strong> e i codici finiscono con <code>-C</code>:
          cambiate il nome, poi registrate le giacenze reali dall&apos;inventario.
        </p>
      ) : null}

      {actionData && "conflict" in actionData && actionData.conflict ? (
        /*
          A conflict is its own notice, not an error.

          An error invites "try again"; a conflict must NOT be retried blindly,
          because the second attempt is what would overwrite the other person's
          work. So it says what happened, what did not happen to either side,
          and what to do — and it is focusable, because on a long form the
          message would otherwise be off-screen above the save button that was
          just pressed.
        */
        <p className="notice notice--warning ac-conflict" role="alert" tabIndex={-1}>
          {actionData.conflict}{" "}
          <button
            type="button"
            className="btn btn--secondary btn--small"
            onClick={() => window.location.reload()}
          >
            Ricarica la pagina
          </button>
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

      {/*
        Section navigation.

        §7 of the brief: a guided path for a new product, and DIRECT section
        navigation for staff who already know what they are changing. This
        screen is seven panels long, and a merchant fixing one price should not
        scroll past the photo manager and the compatibility matrix to reach it.

        Anchor links, not tabs. Tabs hide six sections behind a click and lose
        the reader's place; anchors keep the whole product on one page — which
        is what "check everything before publishing" needs — while giving the
        experienced user one jump. They also work with no JavaScript, cost
        nothing in the bundle, and each is a real URL somebody can bookmark or
        send to a colleague.

        `Pubblicazione` and `Storico prezzi` are conditional panels, so their
        links are conditional too: a link to an anchor that is not on the page
        is a link that silently does nothing.
      */}
      <nav className="ac-sectionnav" aria-label="Sezioni del prodotto">
        <a href="#sez-stato">Stato</a>
        {canWrite && product.archived_at === null ? (
          <a href="#sez-pubblicazione">Pubblicazione</a>
        ) : null}
        <a href="#sez-dettagli">Dettagli</a>
        <a href="#sez-varianti">Varianti e prezzo</a>
        <a href="#sez-foto">Foto</a>
        <a href="#sez-compatibilita">Compatibilità</a>
      </nav>

      {/* ── What is missing ───────────────────────────────────────────────── */}
      <section id="sez-stato" className="panel stack" aria-labelledby="h-stato">
        <h2 id="h-stato">Stato del prodotto</h2>
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
        <section id="sez-pubblicazione" className="panel stack" aria-labelledby="h-pubblicazione">
          <h2 id="h-pubblicazione">Pubblicazione</h2>
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
      <section id="sez-dettagli" className="panel stack" aria-labelledby="h-dettagli">
        <h2 id="h-dettagli">Dettagli</h2>
        <Form method="post" className="stack">
          <input type="hidden" name="intent" value="save-details" />
          {/*
            The version this page was rendered from.

            The action compares it against the row before writing, so a save
            from a form that was open while somebody else saved is refused
            rather than silently overwriting them. See the conflict guard in
            the action.
          */}
          <input type="hidden" name="loadedUpdatedAt" value={String(product.updated_at)} />

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

          {/*
            The kind of accessory — and therefore which specifications the
            variants section asks for.

            Placed in Dettagli rather than in Varianti because it is a fact
            about the PRODUCT: every variant of one product is the same kind of
            thing. A per-variant type would allow a product whose blue version
            is a cable and whose red version is a power bank.
          */}
          <div className="field">
            <label className="field__label" htmlFor="accessoryType">
              Tipo di prodotto
            </label>
            <select
              id="accessoryType"
              name="accessoryType"
              className="input"
              defaultValue={product.accessory_type ?? ""}
              disabled={!canWrite}
              aria-describedby="accessoryType-help"
            >
              <option value="">— non impostato —</option>
              {ACCESSORY_TYPES.map((type) => (
                <option key={type} value={type}>
                  {ACCESSORY_TYPE_LABELS[type]}
                </option>
              ))}
            </select>
            <span className="field__hint" id="accessoryType-help">
              Decide quali specifiche vi vengono chieste nelle varianti: un caricabatterie e una
              cover non si descrivono con gli stessi campi. Cambiandolo e salvando, i campi qui
              sotto cambiano.
            </span>
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
            <div className="cluster">
              <button type="submit" className="btn btn--primary">
                Salva dettagli
              </button>
              {/*
                Set from the SERVER's response, never from the click. An
                optimistic "saved" that appears before the write lands is the
                most expensive lie an admin can tell: the merchant closes the
                laptop.
              */}
              {actionData && "savedAt" in actionData && actionData.savedAt ? (
                <span className="small muted" role="status">
                  Salvato alle{" "}
                  {new Intl.DateTimeFormat("it-IT", {
                    hour: "2-digit",
                    minute: "2-digit",
                    timeZone: "Europe/Rome",
                  }).format(new Date(Number(actionData.savedAt)))}
                </span>
              ) : null}
            </div>
          ) : (
            <p className="small muted">
              Serve il permesso <code>product.write</code> per modificare.
            </p>
          )}
        </Form>
      </section>

      {/* ── Variants, price and stock ─────────────────────────────────────── */}
      <section id="sez-varianti" className="panel stack" aria-labelledby="h-varianti">
        <h2 id="h-varianti">Varianti</h2>
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
                    {canWrite && variants.length > 1 ? (
                      <span className="cluster">
                        {variant.is_default === 0 ? (
                          <>
                            <Form method="post">
                              <input type="hidden" name="intent" value="set-default-variant" />
                              <input type="hidden" name="variantId" value={variant.id} />
                              <button type="submit" className="btn btn--ghost btn--small">
                                Rendi predefinita
                              </button>
                            </Form>
                            <Form method="post">
                              <input type="hidden" name="intent" value="archive-variant" />
                              <input type="hidden" name="variantId" value={variant.id} />
                              <button type="submit" className="btn btn--ghost btn--small">
                                Archivia
                              </button>
                            </Form>
                          </>
                        ) : null}
                      </span>
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

        {/*
          ── SPECIFICATIONS, DRIVEN BY THE PRODUCT TYPE ────────────────────

          Not a fixed set of fields. A charger is asked for its connector, a
          cable for its length, a power bank for its capacity, and none of them
          is asked for a field that means nothing to it — which is what the
          editor did before, for the excellent reason that it asked for none of
          them at all.

          Collapsed by default: most visits to this screen are to change a
          price, and a specification is filled in once.
        */}
        <SpecificationEditor
          accessoryType={product.accessory_type}
          variants={variants}
          canWrite={canWrite}
        />

        {canWrite ? (
          <details className="panel">
            <summary>Aggiungi una variante</summary>
            <Form method="post" className="stack">
              <input type="hidden" name="intent" value="add-variant" />
              <p className="small muted">
                Una variante è lo stesso prodotto in una versione diversa: un altro colore,
                un&apos;altra lunghezza, un&apos;altra capacità. Ognuna ha il proprio codice e la
                propria giacenza.
              </p>

              <div className="field">
                <label className="field__label" htmlFor="v-sku">
                  Codice SKU
                </label>
                <input id="v-sku" name="sku" className="input" required maxLength={64} />
              </div>

              <div className="field">
                <label className="field__label" htmlFor="v-label">
                  Nome della variante
                </label>
                <input
                  id="v-label"
                  name="variantLabel"
                  className="input"
                  maxLength={80}
                  placeholder="Trasparente"
                  aria-describedby="v-label-help"
                />
                <span className="field__hint" id="v-label-help">
                  Come la chiedereste in negozio. Serve per distinguerla: senza, in cassa due
                  varianti sono indistinguibili.
                </span>
              </div>

              <div className="field">
                <label className="field__label" htmlFor="v-colour">
                  Colore
                </label>
                <input id="v-colour" name="colour" className="input" maxLength={40} />
              </div>

              <div className="field">
                <label className="field__label" htmlFor="v-price">
                  Prezzo
                </label>
                <input
                  id="v-price"
                  name="price"
                  className="input"
                  inputMode="decimal"
                  placeholder="39,90"
                />
              </div>

              <div className="field">
                <label className="field__label" htmlFor="v-stock">
                  Quantità disponibile
                </label>
                <input
                  id="v-stock"
                  name="onHand"
                  className="input"
                  type="number"
                  min={0}
                  step={1}
                  defaultValue="0"
                />
              </div>

              <button type="submit" className="btn btn--secondary">
                Aggiungi variante
              </button>
            </Form>
          </details>
        ) : null}
      </section>

      {/* ── Price history ─────────────────────────────────────────────────── */}
      {priceHistory.length > 0 ? (
        <section id="sez-prezzi" className="panel stack" aria-labelledby="h-prezzi">
          <h2 id="h-prezzi">Storico prezzi</h2>
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

      {/* ── Images ────────────────────────────────────────────────────────── */}
      <section id="sez-foto" className="panel stack" aria-labelledby="h-foto">
        <h2 id="h-foto">Foto</h2>
        <p className="small muted">
          Carica fotografie del prodotto esatto, controllando modello, colore e connettori. La foto
          principale utilizzabile compare negli elenchi; le altre nella scheda prodotto.
        </p>

        {images.some((image) => !saleableImageKey(image.object_key)) ? (
          <p className="notice notice--warning">
            Alcune vecchie immagini sono escluse dal negozio perché non rappresentano il prodotto.
            Carica le fotografie corrette: la prima immagine utilizzabile apparirà subito sul sito.
          </p>
        ) : null}
        {images.length === 0 ? (
          <div className="empty-state">
            <p>
              <strong>Nessuna foto</strong>
            </p>
            <p className="small muted">
              Sul sito compare un riquadro vuoto al posto dell&apos;immagine.
            </p>
          </div>
        ) : (
          <ul className="ac-thumbs">
            {/*
              The first photo the arrows can move.

              The primary is pinned at the top, so "already at the top" means
              "first among the ones that can move", not index zero.
            */}
            {images.map((image, index, all) => (
              <li key={image.id} className="ac-thumb">
                <img
                  src={`${mediaBaseUrl}/${image.object_key}`}
                  alt={image.alt_it ?? ""}
                  width={image.width}
                  height={image.height}
                  loading="lazy"
                  decoding="async"
                />
                <div className="ac-thumb__meta">
                  {!saleableImageKey(image.object_key) ? (
                    <span className="badge badge--warning">Da sostituire · esclusa dal sito</span>
                  ) : null}
                  <span className="caption numeric">
                    {image.width}×{image.height}
                  </span>
                  {image.is_primary === 1 ? (
                    <span className="badge badge--success">principale</span>
                  ) : null}
                  {image.alt_it === null ? (
                    <span
                      className="badge badge--warning"
                      title="Chi usa un lettore di schermo non sa cosa mostra questa foto"
                    >
                      senza descrizione
                    </span>
                  ) : null}
                </div>

                {canWrite ? (
                  <div className="stack">
                    {/*
                      Alt text, editable HERE.

                      The "senza descrizione" badge above has always been
                      right and, until now, unactionable: alt could only be set
                      while uploading, so fixing one meant deleting the photo
                      and uploading it again. A warning a merchant cannot act
                      on teaches them the badges are decoration.
                    */}
                    <Form method="post" className="cluster">
                      <input type="hidden" name="intent" value="save-image-alt" />
                      <input type="hidden" name="imageId" value={image.id} />
                      <label className="visually-hidden" htmlFor={`alt-${image.id}`}>
                        Descrizione della foto {index + 1}
                      </label>
                      <input
                        id={`alt-${image.id}`}
                        name="alt"
                        className="input"
                        maxLength={200}
                        defaultValue={image.alt_it ?? ""}
                        placeholder="Cosa si vede nella foto"
                      />
                      <button type="submit" className="btn btn--ghost btn--small">
                        Salva descrizione
                      </button>
                    </Form>

                    <div className="cluster">
                      {/*
                        Order, as two buttons rather than a drag-and-drop list.

                        A swap with the neighbour works with no JavaScript,
                        works with a keyboard, works on a phone, and is two
                        buttons instead of a component. The ends are disabled
                        rather than hidden, so the control does not move under
                        the pointer as photos are reordered.

                        The PRIMARY photo has no arrows. Every consumer sorts
                        `is_primary DESC, sort_order`, so it leads whatever its
                        sort_order says — giving it arrows produced a button
                        that swapped two numbers and changed nothing, which
                        looks exactly like a button that worked.
                      */}
                      {image.is_primary === 1 ? (
                        <span className="small muted">Sempre per prima</span>
                      ) : (
                        <>
                          <Form method="post">
                            <input type="hidden" name="intent" value="move-image" />
                            <input type="hidden" name="imageId" value={image.id} />
                            <input type="hidden" name="direction" value="up" />
                            <button
                              type="submit"
                              className="btn btn--ghost btn--small"
                              disabled={index === all.findIndex((row) => row.is_primary === 0)}
                              aria-label={`Sposta la foto ${index + 1} più in alto`}
                            >
                              ↑
                            </button>
                          </Form>
                          <Form method="post">
                            <input type="hidden" name="intent" value="move-image" />
                            <input type="hidden" name="imageId" value={image.id} />
                            <input type="hidden" name="direction" value="down" />
                            <button
                              type="submit"
                              className="btn btn--ghost btn--small"
                              disabled={index === images.length - 1}
                              aria-label={`Sposta la foto ${index + 1} più in basso`}
                            >
                              ↓
                            </button>
                          </Form>
                        </>
                      )}

                      {image.is_primary === 0 ? (
                        <Form method="post">
                          <input type="hidden" name="intent" value="set-primary-image" />
                          <input type="hidden" name="imageId" value={image.id} />
                          <button type="submit" className="btn btn--ghost btn--small">
                            Rendi principale
                          </button>
                        </Form>
                      ) : null}

                      {/*
                        Deleting asks first — and asks WITHOUT JavaScript.

                        `confirm()` would be one line and would fail open: with
                        no script the click deletes the photo and nothing is
                        asked at all. A `<details>` asks in the markup, so the
                        question survives a stockroom on one bar of signal.
                      */}
                      <Form method="post">
                        <input type="hidden" name="intent" value="delete-image" />
                        <input type="hidden" name="imageId" value={image.id} />
                        <details className="ac-confirm ac-confirm--danger">
                          <summary className="btn btn--ghost btn--small">Elimina</summary>
                          <div className="ac-confirm__panel">
                            <p className="small">
                              La foto sparisce dal sito. Se è l&apos;unica, il prodotto resta senza
                              immagine.
                            </p>
                            <button type="submit" className="btn btn--danger btn--small">
                              Sì, elimina la foto
                            </button>
                          </div>
                        </details>
                      </Form>
                    </div>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        )}

        {canWrite ? (
          <Form method="post" encType="multipart/form-data" className="stack">
            <input type="hidden" name="intent" value="upload-image" />

            <div className="field">
              <label className="field__label" htmlFor="image">
                Aggiungi una foto
              </label>
              <input
                id="image"
                name="image"
                type="file"
                className="input"
                accept={ACCEPTED_IMAGE_TYPES.join(",")}
                required
                aria-describedby="image-help"
              />
              <span className="field__hint" id="image-help">
                JPG, PNG o WebP, fino a {MAX_IMAGE_BYTES / (1024 * 1024)} MB e almeno 200 pixel per
                lato. Una foto scattata col telefono va benissimo. I file SVG non sono accettati.
              </span>
            </div>

            <div className="field">
              <label className="field__label" htmlFor="alt">
                Descrizione della foto
              </label>
              <input
                id="alt"
                name="alt"
                className="input"
                maxLength={200}
                placeholder="Cover trasparente vista di fronte"
                aria-describedby="alt-help"
              />
              <span className="field__hint" id="alt-help">
                Cosa si vede nella foto, per chi non può vederla — chi usa un lettore di schermo, e
                chiunque quando l&apos;immagine non carica. Una riga basta.
              </span>
            </div>

            <button type="submit" className="btn btn--secondary">
              Carica foto
            </button>
          </Form>
        ) : null}
      </section>

      {/* ── Compatibility ─────────────────────────────────────────────────── */}
      <section id="sez-compatibilita" className="panel stack" aria-labelledby="h-compatibilita">
        <h2 id="h-compatibilita">Compatibilità</h2>
        <p className="small muted">
          Con quali telefoni funziona. Non viene mai dedotta dalla categoria o dal nome: se non è
          scritta qui, per il sito è <strong>sconosciuta</strong>, e il cliente lo legge.
        </p>

        {compatibility.length === 0 ? (
          <div className="empty-state">
            <p>
              <strong>Nessuna compatibilità registrata</strong>
            </p>
            <p className="small muted">
              Finché non lo indicate, i clienti non possono trovare questo prodotto filtrando per il
              proprio telefono — che è il motivo principale per cui visitano un sito di accessori.
            </p>
          </div>
        ) : (
          <ul className="ac-actions">
            {compatibility.map((row) => (
              <li key={row.id} className="ac-action">
                <div className="ac-action__body">
                  <p className="ac-action__label">
                    {row.brand_name ? <span className="muted">{row.brand_name} </span> : null}
                    {row.model_name ?? row.model_id ?? "—"}{" "}
                    <span
                      className={`badge ${compatibilityTone(row.compatibility_level, row.verified === 1)}`}
                      title={
                        isCompatibilityLevel(row.compatibility_level)
                          ? COMPATIBILITY_MEANING[row.compatibility_level]
                          : undefined
                      }
                    >
                      {isCompatibilityLevel(row.compatibility_level)
                        ? COMPATIBILITY_LABELS[row.compatibility_level]
                        : row.compatibility_level}
                    </span>
                    {row.compatibility_level === "exact_fit" && row.verified === 0 ? (
                      <span className="badge badge--warning"> da verificare</span>
                    ) : null}
                  </p>
                </div>
                {canWrite ? (
                  <Form method="post">
                    <input type="hidden" name="intent" value="remove-compatibility" />
                    <input type="hidden" name="compatibilityId" value={row.id} />
                    <button type="submit" className="btn btn--ghost btn--small">
                      Rimuovi
                    </button>
                  </Form>
                ) : null}
              </li>
            ))}
          </ul>
        )}

        {canWrite ? (
          deviceModels.length === 0 ? (
            <p className="notice notice--warning small">
              Non ci sono ancora modelli di telefono in archivio. Aggiungeteli in{" "}
              <Link to="/admin/dispositivi">Dispositivi</Link>: senza quelli non si può registrare
              nessuna compatibilità.
            </p>
          ) : (
            <Form method="post" className="stack">
              <input type="hidden" name="intent" value="add-compatibility" />

              <div className="field">
                <label className="field__label" htmlFor="deviceModelId">
                  Telefono
                </label>
                <select id="deviceModelId" name="deviceModelId" className="input" required>
                  <option value="">— scegli un modello —</option>
                  {deviceModels.map((model) => (
                    <option key={model.id} value={model.id}>
                      {[model.brand_name, model.name].filter(Boolean).join(" ")}
                    </option>
                  ))}
                </select>
              </div>

              <div className="field">
                <label className="field__label" htmlFor="level">
                  Che tipo di compatibilità
                </label>
                <select id="level" name="level" className="input" defaultValue="compatible">
                  {COMPATIBILITY_LEVELS.filter((l) => l !== "unverified").map((level) => (
                    <option key={level} value={level}>
                      {COMPATIBILITY_LABELS[level]}
                    </option>
                  ))}
                </select>
                {/*
                  The meanings are listed rather than hidden behind a tooltip.
                  The difference between "esatta" and "compatibile" is the
                  difference between a sale and a return, and the person
                  choosing is doing it from memory at the counter.
                */}
                <ul className="field__hint stack">
                  {COMPATIBILITY_LEVELS.filter((l) => l !== "unverified").map((level) => (
                    <li key={level}>
                      <strong>{COMPATIBILITY_LABELS[level]}</strong> —{" "}
                      {COMPATIBILITY_MEANING[level]}
                    </li>
                  ))}
                </ul>
              </div>

              <div className="field">
                <label className="field__label" htmlFor="compat-note">
                  Nota
                </label>
                <input
                  id="compat-note"
                  name="note"
                  className="input"
                  maxLength={200}
                  placeholder="es. i tasti sono un po' rigidi"
                />
              </div>

              <button type="submit" className="btn btn--secondary">
                Aggiungi compatibilità
              </button>
            </Form>
          )
        ) : null}
      </section>

      {/* ── Duplicate ─────────────────────────────────────────────────────── */}
      {canWrite ? (
        <section className="panel stack">
          <h2>Duplica</h2>
          <p className="small muted">
            Crea una copia di questo prodotto in <strong>bozza</strong>: stesso nome con
            &laquo;(copia)&raquo;, stesse descrizioni, stesse foto, stesse compatibilità e stessi
            prezzi. Serve quando vendete lo stesso articolo in un altro colore.
          </p>
          <p className="small muted">
            <strong>Le giacenze partono da zero.</strong> La copia non è merce che avete: quanti
            pezzi ci sono davvero si dice dall&apos;inventario. I codici delle varianti finiscono
            con <code>-C</code>, così sono riconoscibili sulle scatole.
          </p>
          <Form method="post">
            <button type="submit" name="intent" value="duplicate" className="btn btn--secondary">
              Duplica prodotto
            </button>
          </Form>
        </section>
      ) : null}

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

/**
 * The per-type specification fields, one collapsible block per variant.
 *
 * A separate component because the variants table is already the densest thing
 * on the page and a second form inside each row would make it unreadable on a
 * phone. Below the table, one `<details>` per variant, each naming the variant
 * it belongs to — so a merchant with three colours is never editing the wrong
 * one because two identical forms sat next to each other.
 */
function SpecificationEditor({
  accessoryType,
  variants,
  canWrite,
}: {
  accessoryType: string | null;
  variants: readonly {
    id: string;
    sku: string;
    variant_label: string | null;
    colour: string | null;
    capacity_mah: number | null;
    length_mm: number | null;
    connector: string | null;
    pack_size: number | null;
    weight_grams: number | null;
    dimensions_mm: string | null;
  }[];
  canWrite: boolean;
}) {
  const fields = specFieldsFor(accessoryType);

  /*
   * No type, no fields, and a sentence saying what to do about it.
   *
   * The alternative — showing every field for every product — is how a
   * merchant ends up being asked for the battery capacity of a screen
   * protector and concluding the panel is broken.
   */
  if (fields.length === 0) {
    return (
      <p className="small muted">
        <strong>Specifiche tecniche.</strong> Scegliete il{" "}
        <a href="#sez-dettagli">tipo di prodotto</a> in Dettagli e salvate: qui compariranno solo i
        campi che servono davvero a questo tipo di prodotto.
      </p>
    );
  }

  return (
    <div className="stack">
      <h3>Specifiche tecniche</h3>
      <p className="small muted">
        I campi qui sotto sono quelli di <strong>{accessoryTypeLabel(accessoryType)}</strong>. Un
        altro tipo di prodotto ne chiede altri.
      </p>

      {variants.map((variant) => {
        const name = variant.variant_label ?? variant.colour ?? variant.sku;
        return (
          <details key={variant.id} className="panel" data-variant={variant.sku}>
            <summary>
              {name} <span className="small muted">({variant.sku})</span>
            </summary>
            <Form method="post" className="stack">
              <input type="hidden" name="intent" value="save-variant-specs" />
              <input type="hidden" name="variantId" value={variant.id} />

              {fields.map((field) => {
                const id = `spec-${variant.id}-${field.column}`;
                const current = variant[field.column];
                return (
                  <div className="field" key={field.column}>
                    <label className="field__label" htmlFor={id}>
                      {name} — {field.label}
                      {field.unit ? ` (${field.unit})` : ""}
                    </label>
                    <input
                      id={id}
                      name={field.column}
                      className="input"
                      /*
                       * `inputMode`, not `type="number"`. A number input on a
                       * phone hides the value when it cannot parse it, and
                       * silently drops a comma an Italian keyboard produces.
                       * The action normalises "1.000" and "1,5" itself.
                       */
                      inputMode={field.kind === "integer" ? "numeric" : "text"}
                      defaultValue={current === null ? "" : String(current)}
                      disabled={!canWrite}
                      {...(field.maxLength === undefined ? {} : { maxLength: field.maxLength })}
                      aria-describedby={field.help ? `${id}-help` : undefined}
                    />
                    {field.help ? (
                      <span className="field__hint" id={`${id}-help`}>
                        {field.help}
                      </span>
                    ) : null}
                  </div>
                );
              })}

              {canWrite ? (
                <button type="submit" className="btn btn--secondary btn--small">
                  Salva specifiche
                </button>
              ) : null}
            </Form>
          </details>
        );
      })}
    </div>
  );
}
