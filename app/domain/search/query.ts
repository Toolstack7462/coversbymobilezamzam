/**
 * Turning what a customer typed into an FTS5 query.
 *
 * **FTS5's MATCH syntax is a query language, and the search box is not.**
 *
 * A customer types `cover iphone 15"` with a stray quote, or `cavo -usb`, or
 * `AND`, or an emoji. Passed straight to MATCH, several of those raise a SQLite
 * syntax error — so the shop's search page returns a 500 because somebody typed
 * a quotation mark. Others silently mean something the customer did not intend:
 * a leading `-` is NOT, and `AND`/`OR`/`NOT`/`NEAR` are operators, so searching
 * for the Italian word `or` (a real abbreviation for "ore") becomes a syntax
 * error rather than a search.
 *
 * So nothing typed is ever passed through. Each word is extracted, quoted, and
 * recombined. The result can only ever be a conjunction of quoted terms, which
 * has no syntax to get wrong.
 *
 * Pure, so all of that is testable without a database.
 */

/**
 * The longest query worth running.
 *
 * Not a security limit — the parameter is bound — but a relevance one: past a
 * handful of words an AND search matches nothing, and someone who pasted an
 * essay into the search box is better served by a fast empty result than by a
 * slow one.
 */
export const MAX_QUERY_LENGTH = 120;
export const MAX_TERMS = 8;

/** Shortest token worth indexing on. One letter matches most of the catalogue. */
const MIN_TERM_LENGTH = 2;

/**
 * Words that carry no meaning in a product search and only narrow it wrongly.
 *
 * Deliberately short. An aggressive stop list removes words that turn out to
 * matter — `pro` and `max` are model names here, not adjectives — so this holds
 * only the Italian articles and prepositions that genuinely never distinguish
 * one accessory from another.
 */
const STOP_WORDS = new Set([
  "il",
  "lo",
  "la",
  "i",
  "gli",
  "le",
  "un",
  "uno",
  "una",
  "di",
  "da",
  "del",
  "della",
  "dei",
  "delle",
  "dal",
  "dalla",
  "per",
  "con",
  "su",
  "in",
  "e",
  "ed",
  "o",
  "od",
  "a",
  "ad",
  "the",
  "of",
  "for",
  "with",
  "and",
]);

export interface ParsedQuery {
  /** Terms to search for, cleaned. Empty when nothing usable was typed. */
  terms: string[];
  /** The FTS5 MATCH expression, or null when there is nothing to search. */
  match: string | null;
  /** True when every word was dropped — worth telling the customer. */
  allTermsDropped: boolean;
}

/**
 * Splits input into searchable terms.
 *
 * Accents are kept here and handled by the tokenizer (`remove_diacritics 2`),
 * so `città` and `citta` match each other without this function having to know
 * about Italian orthography. What it does remove is anything FTS5 would read as
 * syntax.
 */
export function parseSearchQuery(raw: string): ParsedQuery {
  const trimmed = raw.slice(0, MAX_QUERY_LENGTH).trim();
  if (trimmed === "") return { terms: [], match: null, allTermsDropped: false };

  const words = trimmed
    .toLowerCase()
    // Split on anything that is not a letter, a digit or an internal hyphen.
    // Hyphens matter: `usb-c` and `type-c` are product names, not two words.
    .split(/[^\p{L}\p{N}-]+/u)
    .map((word) => word.replace(/^-+|-+$/g, ""))
    .filter((word) => word !== "");

  const kept = words
    .filter((word) => word.length >= MIN_TERM_LENGTH || /\p{N}/u.test(word))
    .filter((word) => !STOP_WORDS.has(word))
    .slice(0, MAX_TERMS);

  if (kept.length === 0) {
    return { terms: [], match: null, allTermsDropped: words.length > 0 };
  }

  return { terms: kept, match: buildMatch(kept), allTermsDropped: false };
}

/**
 * Builds the MATCH expression.
 *
 * Every term is double-quoted, which makes it a literal phrase and strips it of
 * any operator meaning. Internal quotes are doubled, the FTS5 escape — a term
 * cannot contain one after parsing, but the escaping stays because relying on
 * an invariant established elsewhere is how injection bugs are written.
 *
 * The last term gets a `*` so the search matches as the customer types:
 * `cove` finds `cover`. Only the last, because prefix-matching every term makes
 * `cavo usb` match products containing `cavolo` and `usbekistan`.
 */
function buildMatch(terms: string[]): string {
  return terms
    .map((term, index) => {
      const quoted = `"${term.replace(/"/g, '""')}"`;
      return index === terms.length - 1 ? `${quoted}*` : quoted;
    })
    .join(" AND ");
}

/**
 * A message for when the search found nothing, explaining WHY where possible.
 *
 * "Nessun risultato" is true and unhelpful. If the customer's words were all
 * dropped, telling them so is the difference between "the shop has nothing"
 * and "try different words".
 */
export function emptySearchReason(parsed: ParsedQuery, locale: "it" | "en"): string | null {
  if (!parsed.allTermsDropped) return null;

  return locale === "it"
    ? "La ricerca era troppo generica. Prova con il nome del prodotto o il modello del telefono."
    : "That search was too general. Try a product name or a phone model.";
}
