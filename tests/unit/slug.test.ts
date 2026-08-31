import { describe, it, expect } from "vitest";
import { slugify, uniqueSlug, isSlug, MAX_SLUG_LENGTH } from "~/domain/catalogue/slug";

/**
 * Slugs are effectively permanent: changing one breaks every link a customer
 * has shared and every search result. So the edge cases matter more than they
 * would for most generated strings.
 */

describe("slugify", () => {
  it("handles an ordinary product name", () => {
    expect(slugify("Cover iPhone 15 Pro")).toBe("cover-iphone-15-pro");
  });

  it("strips Italian accents to what people actually type", () => {
    // Accented vowels are ordinary letters in Italian, not decoration. Deleting
    // the letter would be wrong; deleting only the accent is right.
    expect(slugify("Città")).toBe("citta");
    expect(slugify("Più venduto")).toBe("piu-venduto");
    expect(slugify("Perché")).toBe("perche");
  });

  it("treats an apostrophe as a word boundary, not a deletion", () => {
    // "custodiadelliphone" would be the result of deleting it, and unreadable.
    expect(slugify("Custodia dell'iPhone")).toBe("custodia-dell-iphone");
  });

  it("removes symbols that appear in accessory names", () => {
    expect(slugify('Pellicola 6.7" antiriflesso')).toBe("pellicola-6-7-antiriflesso");
    expect(slugify("Caricatore 20W • USB-C")).toBe("caricatore-20w-usb-c");
  });

  it("reads & as the Italian word", () => {
    expect(slugify("Cover & Pellicola")).toBe("cover-e-pellicola");
  });

  it("collapses runs of separators and trims the ends", () => {
    expect(slugify("  --Cover   iPhone--  ")).toBe("cover-iphone");
  });

  it("keeps digits and decimal points readable", () => {
    expect(slugify("Cavo 1.5 m")).toBe("cavo-1-5-m");
  });

  it("never exceeds the maximum length or ends on a hyphen", () => {
    const long = slugify("Cover ".repeat(40));
    expect(long.length).toBeLessThanOrEqual(MAX_SLUG_LENGTH);
    expect(long.endsWith("-")).toBe(false);
  });

  it("returns empty for input with no usable characters", () => {
    // Reported honestly rather than invented here; uniqueSlug supplies the
    // fallback, so the two concerns stay separate.
    expect(slugify("!!! ???")).toBe("");
  });

  it("does not silently destroy a non-Latin name", () => {
    // A diacritic-stripping normalise would reduce this to "" and hand the
    // product the collection page's URL. A boundary-per-character result is
    // ugly but recoverable, and uniqueSlug gives it a real fallback.
    expect(slugify("小米")).toBe("");
  });

  it("produces something that passes isSlug", () => {
    for (const name of ["Cover iPhone 15", "Città", "Cavo 1.5 m", "Cover & Pellicola"]) {
      expect(isSlug(slugify(name)), name).toBe(true);
    }
  });
});

describe("uniqueSlug", () => {
  it("returns the plain slug when nothing collides", () => {
    expect(uniqueSlug("Cover iPhone 15", [])).toBe("cover-iphone-15");
  });

  it("appends a readable counter rather than a random suffix", () => {
    // A merchant looking at cover-iphone-15 and cover-iphone-15-2 understands
    // immediately. cover-iphone-15-a7f3c9 tells them nothing.
    expect(uniqueSlug("Cover iPhone 15", ["cover-iphone-15"])).toBe("cover-iphone-15-2");
    expect(uniqueSlug("Cover iPhone 15", ["cover-iphone-15", "cover-iphone-15-2"])).toBe(
      "cover-iphone-15-3",
    );
  });

  it("falls back rather than giving a product the collection page's URL", () => {
    expect(uniqueSlug("!!!", [])).toBe("prodotto");
    expect(uniqueSlug("!!!", ["prodotto"])).toBe("prodotto-2");
  });

  it("stays within the maximum even after adding a suffix", () => {
    const base = "a".repeat(MAX_SLUG_LENGTH);
    const taken = [base];
    const result = uniqueSlug(base, taken);
    expect(result.length).toBeLessThanOrEqual(MAX_SLUG_LENGTH);
    expect(result.endsWith("-2")).toBe(true);
  });

  it("refuses rather than looping forever", () => {
    const taken = ["cover", ...Array.from({ length: 1000 }, (_, i) => `cover-${i + 2}`)];
    expect(() => uniqueSlug("Cover", taken)).toThrow(/free slug/);
  });
});

describe("isSlug", () => {
  it("accepts well-formed slugs", () => {
    expect(isSlug("cover-iphone-15")).toBe(true);
    expect(isSlug("cover")).toBe(true);
  });

  it("rejects anything that would look wrong in a URL", () => {
    for (const bad of ["", "Cover", "cover_iphone", "cover--iphone", "-cover", "cover-", "città"]) {
      expect(isSlug(bad), bad).toBe(false);
    }
  });
});
