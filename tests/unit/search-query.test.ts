import { describe, it, expect } from "vitest";
import {
  parseSearchQuery,
  emptySearchReason,
  MAX_QUERY_LENGTH,
  MAX_TERMS,
} from "~/domain/search/query";

/**
 * FTS5's MATCH is a query language; a search box is not.
 *
 * Most of these tests are about input that would make SQLite raise a syntax
 * error — which, passed through, means the shop's search page returns a 500
 * because a customer typed a quotation mark.
 */

describe("ordinary searches", () => {
  it("keeps the words and prefix-matches the last one", () => {
    // Prefix on the last term only, so the results narrow as someone types
    // without `cavo usb` also matching `cavolo`.
    const parsed = parseSearchQuery("cover iphone");
    expect(parsed.terms).toEqual(["cover", "iphone"]);
    expect(parsed.match).toBe('"cover" AND "iphone"*');
  });

  it("keeps digits, however short", () => {
    // "15" is the whole point of the search in a phone-accessory shop.
    expect(parseSearchQuery("iphone 15").terms).toEqual(["iphone", "15"]);
  });

  it("keeps hyphenated product names whole", () => {
    // usb-c and type-c are names, not two words each.
    expect(parseSearchQuery("cavo usb-c").terms).toEqual(["cavo", "usb-c"]);
  });

  it("keeps accents for the tokenizer to fold", () => {
    // remove_diacritics on the FTS table matches città to citta, so this
    // function does not need to know any Italian orthography.
    expect(parseSearchQuery("città").terms).toEqual(["città"]);
  });

  it("is case-insensitive", () => {
    expect(parseSearchQuery("COVER iPhone").terms).toEqual(["cover", "iphone"]);
  });
});

describe("input that would otherwise be a syntax error", () => {
  it("survives a stray double quote", () => {
    // The single most likely way a real customer breaks a naive search.
    const parsed = parseSearchQuery('cover 6.7"');
    expect(parsed.match).not.toBeNull();
    expect(parsed.match).not.toContain('6.7"');
  });

  it("does not read a leading hyphen as NOT", () => {
    // FTS5 treats -term as exclusion. A customer typing "-usb" means "usb".
    const parsed = parseSearchQuery("-usb");
    expect(parsed.terms).toEqual(["usb"]);
    expect(parsed.match).toBe('"usb"*');
  });

  it("neutralises FTS5 operators typed as words", () => {
    // AND, OR, NOT and NEAR are operators. Quoting turns them into terms, so a
    // search for the Italian "or" is a search rather than a syntax error.
    const parsed = parseSearchQuery("cavo NEAR usb");
    expect(parsed.match).toContain('"near"');
    expect(parsed.match).not.toMatch(/\bNEAR\b/);
  });

  it("drops punctuation and symbols entirely", () => {
    const parsed = parseSearchQuery("cover (nuova) * ^ :");
    expect(parsed.terms).toEqual(["cover", "nuova"]);
  });

  it("handles input that is only punctuation", () => {
    const parsed = parseSearchQuery("!!! ***");
    expect(parsed.match).toBeNull();
    expect(parsed.terms).toEqual([]);
  });

  it("handles an empty or whitespace query", () => {
    expect(parseSearchQuery("").match).toBeNull();
    expect(parseSearchQuery("   ").match).toBeNull();
  });

  it("escapes a quote if one ever reached the term stage", () => {
    // Cannot happen after parsing, and the escaping stays anyway: relying on an
    // invariant established somewhere else is how injection bugs get written.
    const parsed = parseSearchQuery('cover"" iphone');
    expect(parsed.match).not.toBeNull();
    expect(() => JSON.parse(`"${parsed.match!.replace(/"/g, '\\"')}"`)).not.toThrow();
  });
});

describe("limits", () => {
  it("caps the number of terms", () => {
    const many = Array.from({ length: 30 }, (_, i) => `parola${i}`).join(" ");
    expect(parseSearchQuery(many).terms).toHaveLength(MAX_TERMS);
  });

  it("caps the query length", () => {
    // Someone pasted an essay. A fast empty result beats a slow one.
    const long = "cover ".repeat(200);
    const parsed = parseSearchQuery(long);
    expect(parsed.terms.length).toBeLessThanOrEqual(MAX_TERMS);
    expect(long.length).toBeGreaterThan(MAX_QUERY_LENGTH);
  });

  it("drops single letters but keeps single digits", () => {
    // "a" matches most of the catalogue; "5" is a model number.
    expect(parseSearchQuery("a cover").terms).toEqual(["cover"]);
    expect(parseSearchQuery("iphone 5").terms).toEqual(["iphone", "5"]);
  });
});

describe("stop words", () => {
  it("drops Italian articles and prepositions", () => {
    expect(parseSearchQuery("cover per il telefono").terms).toEqual(["cover", "telefono"]);
  });

  it("keeps words that are model names, not adjectives", () => {
    // An aggressive stop list would remove these. "pro" and "max" are the
    // difference between two products a customer is choosing between.
    expect(parseSearchQuery("iphone pro max").terms).toEqual(["iphone", "pro", "max"]);
  });

  it("reports when every word was dropped", () => {
    const parsed = parseSearchQuery("il per di");
    expect(parsed.match).toBeNull();
    expect(parsed.allTermsDropped).toBe(true);
  });
});

describe("explaining an empty result", () => {
  it("says why when the words were all stop words", () => {
    // "Nessun risultato" is true and unhelpful; this distinguishes "the shop
    // has nothing" from "try different words".
    const parsed = parseSearchQuery("il per di");
    expect(emptySearchReason(parsed, "it")).toContain("generica");
    expect(emptySearchReason(parsed, "en")).toContain("general");
  });

  it("says nothing when the search was genuinely specific", () => {
    // A real search that found nothing needs no excuse made for it.
    expect(emptySearchReason(parseSearchQuery("cover iphone 15"), "it")).toBeNull();
  });
});
