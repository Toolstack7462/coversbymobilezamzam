import { Form, Link, useLocation, useSearchParams } from "react-router";
import type { Route } from "./+types/product-detail";
import { cloudflareContext } from "../../../workers/app";
import { requireStaff } from "~/infrastructure/auth/session.server";
import { systemClock, cryptoIds } from "~/infrastructure/primitives";
import { money, format as formatMoney, parseAmountToMinorUnits } from "~/domain/pricing/money";
import { isCompatibilityLevel, COMPATIBILITY_LEVELS } from "~/domain/compatibility/resolve";
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

  const [variants, images, compatibility, priceHistory, brands, categories, deviceModels] =
    await Promise.all([
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
  const { env } = context.get(cloudflareContext);
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

  if (intent === "add-variant") {
    const actor = await requireStaff(request, env, "product.write");
    const sku = String(form.get("sku") ?? "")
      .trim()
      .toUpperCase();
    const label = String(form.get("variantLabel") ?? "").trim() || null;
    const colour = String(form.get("colour") ?? "").trim() || null;
    const rawPrice = String(form.get("price") ?? "").trim();
    const onHand = Math.max(0, Math.trunc(Number(form.get("onHand")) || 0));

    if (sku === "") return { error: "Il codice SKU è obbligatorio." };
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
    const statements: D1PreparedStatement[] = [
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
      httpMetadata: {
        contentType: check.facts.type,
        cacheControl: "public, max-age=31536000, immutable",
      },
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

      {/* ── Images ────────────────────────────────────────────────────────── */}
      <section className="panel stack">
        <h2>Foto</h2>
        <p className="small muted">
          La prima foto è quella che compare negli elenchi. Le dimensioni vengono lette dal file:
          servono al sito per riservare lo spazio prima che l&apos;immagine arrivi, così la pagina
          non &ldquo;salta&rdquo; mentre carica.
        </p>

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
            {images.map((image) => (
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
                  <div className="cluster">
                    {image.is_primary === 0 ? (
                      <Form method="post">
                        <input type="hidden" name="intent" value="set-primary-image" />
                        <input type="hidden" name="imageId" value={image.id} />
                        <button type="submit" className="btn btn--ghost btn--small">
                          Rendi principale
                        </button>
                      </Form>
                    ) : null}
                    <Form method="post">
                      <input type="hidden" name="intent" value="delete-image" />
                      <input type="hidden" name="imageId" value={image.id} />
                      <button type="submit" className="btn btn--ghost btn--small">
                        Elimina
                      </button>
                    </Form>
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
      <section className="panel stack">
        <h2>Compatibilità</h2>
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
