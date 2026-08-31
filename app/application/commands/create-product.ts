import { z } from "zod";
import { parseAmountToMinorUnits } from "~/domain/pricing/money";
import { uniqueSlug } from "~/domain/catalogue/slug";
import type { Clock, IdGenerator } from "~/application/ports";

/**
 * Product creation.
 *
 * Creates the smallest thing that can actually be sold: a product, its Italian
 * translation, one default variant, a price on the default list, and a stock
 * row at the default location. All in ONE D1 batch.
 *
 * Why all five together rather than a product now and the rest later:
 *
 *   - A product with no variant cannot be added to a cart, so it is not a
 *     product yet — it is a name.
 *   - A variant with no `inventory_levels` row is not merely at zero stock; it
 *     is *unknown*, and the availability logic treats those differently. A
 *     merchant who creates a product and does not immediately find the stock
 *     field has a product that can never be sold and no indication why.
 *   - A partial write would leave rows that look right individually and are
 *     wrong together, which is precisely what a batch prevents.
 *
 * Everything beyond that minimum — more variants, images, compatibility, SEO —
 * is edited afterwards. A shopkeeper interrupted by a customer halfway through
 * should have a saved draft, not a lost form.
 */

export const CreateProductInput = z.object({
  /** The Italian name. The slug is derived from it, never supplied. */
  name: z.string().trim().min(2, "Il nome è troppo corto.").max(200),

  /**
   * Free text as typed: "39,90", "€ 39,90", "39.90". Parsed to integer minor
   * units by the domain, which is the only thing that ever converts money.
   * Optional, because a product can be drafted before its price is decided —
   * the setup centre and the "Senza prezzo" view both make that visible.
   */
  price: z.string().trim().max(20).optional(),

  sku: z
    .string()
    .trim()
    .min(1, "Il codice SKU è obbligatorio.")
    .max(64)
    // Uppercased on save so `cov-15` and `COV-15` cannot both exist and be
    // read as different products in a stocktake.
    .transform((s) => s.toUpperCase()),

  brandId: z.string().trim().min(1).optional(),
  categoryId: z.string().trim().min(1).optional(),
  accessoryType: z.string().trim().max(50).optional(),

  shortDescription: z.string().trim().max(500).optional(),

  /** Units on hand right now. Not a promise about the future. */
  onHand: z.coerce.number().int().min(0).max(100_000).default(0),

  /**
   * A product is created as a DRAFT unless explicitly published. Publishing by
   * default would put an unpriced, unphotographed, uncheckable product on a
   * live shop the moment someone typed a name.
   */
  publish: z.boolean().default(false),
});

export type CreateProductInput = z.infer<typeof CreateProductInput>;

export interface CreateProductDeps {
  d1: D1Database;
  clock: Clock;
  ids: IdGenerator;
  defaultLocationId: string;
  actorId: string;
  actorLabel: string;
}

export type CreateProductResult =
  { ok: true; productId: string; slug: string } | { ok: false; error: string };

export async function createProduct(
  input: CreateProductInput,
  deps: CreateProductDeps,
): Promise<CreateProductResult> {
  const { d1, clock, ids, defaultLocationId, actorId, actorLabel } = deps;
  const now = clock.now();

  let amount: number | null = null;
  if (input.price !== undefined && input.price !== "") {
    try {
      amount = parseAmountToMinorUnits(input.price);
    } catch {
      return { ok: false, error: `Prezzo non leggibile: "${input.price}". Usa la forma 39,90.` };
    }
    if (amount < 0) return { ok: false, error: "Il prezzo non può essere negativo." };
  }

  // A duplicate SKU is a stocktake error waiting to happen: two physical piles
  // that the system believes are one. Checked before writing so the merchant
  // gets a sentence rather than a constraint violation.
  const existingSku = await d1
    .prepare(`SELECT id FROM product_variants WHERE sku = ?1 LIMIT 1`)
    .bind(input.sku)
    .first<{ id: string }>();
  if (existingSku) {
    return { ok: false, error: `Il codice SKU "${input.sku}" è già usato da un altro prodotto.` };
  }

  const priceList = await d1
    .prepare(`SELECT id FROM price_lists WHERE is_default = 1 LIMIT 1`)
    .first<{ id: string }>();
  if (!priceList) {
    return { ok: false, error: "Nessun listino prezzi predefinito configurato." };
  }

  const takenSlugs = await d1.prepare(`SELECT slug FROM products`).all<{ slug: string }>();
  const slug = uniqueSlug(
    input.name,
    takenSlugs.results.map((r) => r.slug),
  );

  const productId = ids.generate();
  const variantId = ids.generate();

  const statements: D1PreparedStatement[] = [
    d1
      .prepare(
        `INSERT INTO products
           (id, slug, status, brand_id, primary_category_id, accessory_type,
            published_at, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?8)`,
      )
      .bind(
        productId,
        slug,
        input.publish ? "active" : "draft",
        input.brandId ?? null,
        input.categoryId ?? null,
        input.accessoryType ?? null,
        input.publish ? now : null,
        now,
      ),

    d1
      .prepare(
        `INSERT INTO product_translations (id, product_id, locale, name, short_description)
         VALUES (?1, ?2, 'it', ?3, ?4)`,
      )
      .bind(ids.generate(), productId, input.name, input.shortDescription ?? null),

    d1
      .prepare(
        `INSERT INTO product_variants
           (id, product_id, sku, is_default, active, sort_order, created_at, updated_at)
         VALUES (?1, ?2, ?3, 1, 1, 0, ?4, ?4)`,
      )
      .bind(variantId, productId, input.sku, now),

    d1
      .prepare(
        `INSERT INTO inventory_levels
           (id, variant_id, location_id, on_hand, reserved, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, 0, ?5, ?5)`,
      )
      .bind(ids.generate(), variantId, defaultLocationId, input.onHand, now),
  ];

  if (amount !== null) {
    statements.push(
      d1
        .prepare(
          `INSERT INTO variant_prices
             (id, variant_id, price_list_id, amount, currency, created_at, updated_at)
           VALUES (?1, ?2, ?3, ?4, 'EUR', ?5, ?5)`,
        )
        .bind(ids.generate(), variantId, priceList.id, amount, now),

      // The first price is history too. Without an opening row the 30-day prior
      // price has no baseline, and the first discount could not be evidenced
      // (D.Lgs. 84/2022).
      d1
        .prepare(
          `INSERT INTO price_history
             (id, variant_id, price_list_id, old_amount, new_amount, currency, channel,
              effective_from, reason, changed_by, created_at)
           VALUES (?1, ?2, ?3, NULL, ?4, 'EUR', 'online', ?5, 'product created', ?6, ?5)`,
        )
        .bind(ids.generate(), variantId, priceList.id, amount, now, actorId),
    );
  }

  statements.push(
    d1
      .prepare(
        `INSERT INTO audit_logs
           (id, actor_id, actor_label, action, entity_type, entity_id, after_value, created_at)
         VALUES (?1, ?2, ?3, 'product.create', 'product', ?4, ?5, ?6)`,
      )
      .bind(
        ids.generate(),
        actorId,
        actorLabel,
        productId,
        JSON.stringify({ slug, sku: input.sku, status: input.publish ? "active" : "draft" }),
        now,
      ),
  );

  try {
    await d1.batch(statements);
  } catch (error) {
    // The slug and SKU checks above race: another save can take either between
    // the read and the write. The unique indexes are the real guarantee, and
    // this turns their violation into a sentence a merchant can act on.
    const message = error instanceof Error ? error.message : String(error);
    if (/UNIQUE/i.test(message)) {
      return {
        ok: false,
        error:
          "Un altro prodotto con lo stesso codice o indirizzo è stato creato nel frattempo. Riprova.",
      };
    }
    throw error;
  }

  return { ok: true, productId, slug };
}
