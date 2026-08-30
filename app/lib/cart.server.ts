import { createCookie } from "react-router";

/**
 * Cart identity.
 *
 * The cookie holds ONLY an opaque signed token. Contents live in D1, keyed by
 * that token, so a customer cannot edit their own cart by editing a cookie —
 * and cannot put a price in one (invariant 2).
 */

const THIRTY_DAYS = 60 * 60 * 24 * 30;

export function cartCookie(secret: string) {
  return createCookie("__Host-cart", {
    path: "/",
    httpOnly: true,
    // Lax rather than Strict: a cart must survive arriving from a search
    // result or a shared link, which Strict would break for no security gain
    // here — the cookie authorises nothing but a cart.
    sameSite: "lax",
    secure: true,
    maxAge: THIRTY_DAYS,
    secrets: [secret],
  });
}

export interface CartLine {
  variantId: string;
  quantity: number;
  sku: string;
  productName: string;
  variantLabel: string | null;
  slug: string;
  /** Authoritative, re-read on every render. Never stored in the cookie. */
  unitPrice: number;
  imageKey: string | null;
  available: number;
  allowBackorder: boolean;
}

export async function readCartToken(request: Request, secret: string): Promise<string | null> {
  const cookie = cartCookie(secret);
  const value = (await cookie.parse(request.headers.get("Cookie"))) as string | null;
  return typeof value === "string" && value.length > 0 ? value : null;
}

export async function serialiseCartToken(token: string, secret: string): Promise<string> {
  return cartCookie(secret).serialize(token);
}

/** Creates the cart row if this token has none yet. */
export async function ensureCart(
  db: D1Database,
  token: string,
  now: number,
  newId: string,
): Promise<string> {
  const existing = await db
    .prepare(`SELECT id FROM carts WHERE token = ?1 AND expires_at > ?2`)
    .bind(token, now)
    .first<{ id: string }>();
  if (existing) return existing.id;

  await db
    .prepare(
      `INSERT INTO carts (id, token, currency, expires_at, created_at, updated_at)
       VALUES (?1, ?2, 'EUR', ?3, ?4, ?4)
       ON CONFLICT(token) DO UPDATE SET expires_at = ?3, updated_at = ?4`,
    )
    .bind(newId, token, now + THIRTY_DAYS * 1000, now)
    .run();

  return newId;
}

/**
 * Reads the cart with LIVE prices and availability.
 *
 * Every render re-reads, so a price or stock change is visible to the customer
 * before checkout rather than being sprung on them at the end.
 */
export async function readCartLines(db: D1Database, cartId: string): Promise<CartLine[]> {
  const { results } = await db
    .prepare(
      `SELECT ci.variant_id, ci.quantity, v.sku, v.variant_label, p.slug,
              pt.name AS product_name, vp.amount AS unit_price,
              il.on_hand, il.reserved, v.allow_backorder,
              (SELECT object_key FROM product_images pi
                WHERE pi.product_id = p.id
                ORDER BY pi.is_primary DESC, pi.sort_order ASC LIMIT 1) AS image_key
         FROM cart_items ci
         JOIN product_variants v ON v.id = ci.variant_id
         JOIN products p ON p.id = v.product_id
         LEFT JOIN product_translations pt ON pt.product_id = p.id AND pt.locale = 'it'
         JOIN variant_prices vp ON vp.variant_id = v.id
         JOIN price_lists pl ON pl.id = vp.price_list_id AND pl.is_default = 1
         LEFT JOIN inventory_levels il ON il.variant_id = v.id
        WHERE ci.cart_id = ?1
          AND v.archived_at IS NULL AND p.archived_at IS NULL AND p.status = 'active'
        ORDER BY ci.created_at ASC`,
    )
    .bind(cartId)
    .all<{
      variant_id: string;
      quantity: number;
      sku: string;
      variant_label: string | null;
      slug: string;
      product_name: string | null;
      unit_price: number;
      on_hand: number | null;
      reserved: number | null;
      allow_backorder: number;
      image_key: string | null;
    }>();

  return results.map((row) => ({
    variantId: row.variant_id,
    quantity: row.quantity,
    sku: row.sku,
    productName: row.product_name ?? row.sku,
    variantLabel: row.variant_label,
    slug: row.slug,
    unitPrice: row.unit_price,
    imageKey: row.image_key,
    available: Math.max(0, (row.on_hand ?? 0) - (row.reserved ?? 0)),
    allowBackorder: row.allow_backorder === 1,
  }));
}

export async function addToCart(
  db: D1Database,
  cartId: string,
  variantId: string,
  quantity: number,
  now: number,
  newId: string,
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO cart_items (id, cart_id, variant_id, quantity, created_at, updated_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?5)
       ON CONFLICT(cart_id, variant_id)
       DO UPDATE SET quantity = MIN(99, cart_items.quantity + ?4), updated_at = ?5`,
    )
    .bind(newId, cartId, variantId, quantity, now)
    .run();
}

export async function setQuantity(
  db: D1Database,
  cartId: string,
  variantId: string,
  quantity: number,
  now: number,
): Promise<void> {
  if (quantity <= 0) {
    await db
      .prepare(`DELETE FROM cart_items WHERE cart_id = ?1 AND variant_id = ?2`)
      .bind(cartId, variantId)
      .run();
    return;
  }
  await db
    .prepare(
      `UPDATE cart_items SET quantity = ?1, updated_at = ?2
        WHERE cart_id = ?3 AND variant_id = ?4`,
    )
    .bind(Math.min(99, quantity), now, cartId, variantId)
    .run();
}
