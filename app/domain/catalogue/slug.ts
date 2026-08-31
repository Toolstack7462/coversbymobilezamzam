/**
 * URL slugs.
 *
 * A slug is part of the interface: it appears in the address bar, in links a
 * customer sends to a friend, and in search results. It is also **permanent in
 * practice** — changing one breaks every link anyone has ever shared and every
 * result Google has indexed — so getting it right the first time matters more
 * than it does for most generated strings.
 *
 * Italian makes this less trivial than the usual lowercase-and-hyphenate:
 *
 *   - Accented vowels are ordinary letters here, not decoration. `perché`,
 *     `città`, `più`. Dropping the accent is right (`perche`, `citta`) because
 *     that is what people type; dropping the whole letter is not.
 *   - An apostrophe is a word boundary, not a character to delete.
 *     `custodia dell'iPhone` must not become `custodiadelliphone`.
 *   - Degree signs, quotes and the `°` in `6.7°` appear in accessory names and
 *     must not survive into a URL.
 */

/**
 * Characters that carry meaning in Italian product names, mapped to what
 * someone would type on a keyboard without them.
 *
 * Written out rather than done with `normalize("NFD")` plus a diacritic strip,
 * because that approach silently mangles anything outside Latin — a Chinese
 * brand name would reduce to nothing at all, and an empty slug is worse than an
 * imperfect one. Everything not listed here is handled explicitly below.
 */
const TRANSLITERATIONS: Record<string, string> = {
  à: "a",
  á: "a",
  â: "a",
  ä: "a",
  ã: "a",
  å: "a",
  è: "e",
  é: "e",
  ê: "e",
  ë: "e",
  ì: "i",
  í: "i",
  î: "i",
  ï: "i",
  ò: "o",
  ó: "o",
  ô: "o",
  ö: "o",
  õ: "o",
  ù: "u",
  ú: "u",
  û: "u",
  ü: "u",
  ç: "c",
  ñ: "n",
  ß: "ss",
  æ: "ae",
  œ: "oe",
  ø: "o",
  "&": "e",
};

/** The longest a slug may be. Long enough for a real product name, short
 *  enough to stay readable in a link and to fit an index. */
export const MAX_SLUG_LENGTH = 80;

export function slugify(input: string): string {
  const lowered = input.toLowerCase();

  let out = "";
  for (const char of lowered) {
    const mapped = TRANSLITERATIONS[char];
    if (mapped !== undefined) {
      out += mapped;
    } else if (/[a-z0-9]/.test(char)) {
      out += char;
    } else {
      // Everything else — spaces, punctuation, apostrophes, symbols, and any
      // script this function does not know — becomes a boundary rather than
      // being deleted. That keeps words apart instead of running them together.
      out += "-";
    }
  }

  return (
    out
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, MAX_SLUG_LENGTH)
      // Slicing can leave a trailing hyphen when the cut lands on a boundary.
      .replace(/-+$/, "")
  );
}

/**
 * A slug that does not collide with `taken`.
 *
 * Appends `-2`, `-3`, and so on. Not a random suffix and not a timestamp: two
 * products called "Cover iPhone 15" should read as `cover-iphone-15` and
 * `cover-iphone-15-2`, which a merchant can look at and understand.
 *
 * This is a convenience, NOT the uniqueness guarantee. Two people saving at
 * once would both be handed the same free slug. The unique index on
 * `products.slug` is what actually prevents the duplicate; this only avoids
 * showing an error for the common single-user case.
 */
export function uniqueSlug(base: string, taken: Iterable<string>): string {
  const slug = slugify(base);
  // An input of only punctuation slugifies to "": fall back rather than
  // producing a product whose URL is the collection page.
  const root = slug === "" ? "prodotto" : slug;

  const used = new Set(taken);
  if (!used.has(root)) return root;

  for (let n = 2; n < 1000; n += 1) {
    // Reserve room for the suffix so the result never exceeds the maximum.
    const suffix = `-${n}`;
    const trimmed = root.slice(0, MAX_SLUG_LENGTH - suffix.length).replace(/-+$/, "");
    const candidate = `${trimmed}${suffix}`;
    if (!used.has(candidate)) return candidate;
  }

  // A thousand products with one name is not a real case; refusing is better
  // than looping forever or inventing something unreadable.
  throw new Error(`Could not find a free slug for "${base}".`);
}

/** True when a string is already a well-formed slug. */
export function isSlug(value: string): boolean {
  return (
    value.length > 0 && value.length <= MAX_SLUG_LENGTH && /^[a-z0-9]+(-[a-z0-9]+)*$/.test(value)
  );
}
