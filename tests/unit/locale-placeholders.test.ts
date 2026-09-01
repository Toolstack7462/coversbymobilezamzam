import { describe, expect, it } from "vitest";

import it_ from "../../app/locales/it.json";
import en from "../../app/locales/en.json";

/**
 * Interpolation placeholders.
 *
 * The translator replaces `{{name}}`. A string written with single braces —
 * `{name}` — is not an error anywhere: it type-checks, it passes locale parity
 * because the key exists in both files, and it renders the literal text
 * "Compatibile con {device}" to a customer.
 *
 * That shipped to the deployed preview and was caught by looking at a
 * screenshot. This is the cheaper way to catch it.
 */

type Node = string | { [key: string]: Node };

function walk(node: Node, path: string[] = []): Array<{ key: string; value: string }> {
  if (typeof node === "string") return [{ key: path.join("."), value: node }];
  return Object.entries(node).flatMap(([k, v]) => walk(v, [...path, k]));
}

/** `{word}` that is NOT part of a `{{word}}`. */
const SINGLE_BRACE = /(?<!\{)\{(\w+)\}(?!\})/;

describe.each([
  ["it", it_ as unknown as Node],
  ["en", en as unknown as Node],
])("%s.json", (_locale, dictionary) => {
  const strings = walk(dictionary);

  it("has strings to check", () => {
    expect(strings.length).toBeGreaterThan(100);
  });

  it("uses {{double}} braces for every placeholder", () => {
    const wrong = strings
      .filter((entry) => SINGLE_BRACE.test(entry.value))
      .map((entry) => `${entry.key}: ${entry.value}`);

    expect(wrong).toEqual([]);
  });

  it("never leaves an unclosed placeholder", () => {
    // `{{name}` and `{name}}` both render as visible punctuation.
    const wrong = strings
      .filter((entry) => /\{\{\w+\}(?!\})|(?<!\{)\{\w+\}\}/.test(entry.value))
      .map((entry) => `${entry.key}: ${entry.value}`);

    expect(wrong).toEqual([]);
  });
});

describe("placeholder parity between locales", () => {
  it("both locales interpolate the same variables for the same key", () => {
    /*
     * A key whose Italian text takes {{device}} and whose English text takes
     * {{model}} silently renders the raw placeholder in one language only —
     * the kind of bug nobody sees until a customer switches language.
     */
    const names = (value: string) => [...value.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]).sort();

    const italian = new Map(walk(it_ as unknown as Node).map((e) => [e.key, e.value]));
    const english = new Map(walk(en as unknown as Node).map((e) => [e.key, e.value]));

    const mismatched: string[] = [];
    for (const [key, itValue] of italian) {
      const enValue = english.get(key);
      if (enValue === undefined) continue; // locale parity is a separate check
      const a = names(itValue);
      const b = names(enValue);
      if (a.join(",") !== b.join(",")) {
        mismatched.push(`${key}: it[${a.join(",")}] vs en[${b.join(",")}]`);
      }
    }

    expect(mismatched).toEqual([]);
  });
});

describe.each([
  ["it", it_ as unknown as Node],
  ["en", en as unknown as Node],
])("%s.json typography", (_locale, dictionary) => {
  const strings = walk(dictionary);

  it("contains no em dash or en dash", () => {
    /*
     * Every one of these is text a customer reads.
     *
     * The em dash is the single clearest signature of machine-written copy, and
     * six of them had reached the shipped storefront: the hero eyebrow, a
     * compatibility label, two footer legal separators and a payment
     * description. None was deliberate; each was reached for where a full stop
     * or a comma was the right mark.
     *
     * A hyphen in a compound word or a range is fine and is not matched here.
     */
    const offenders = strings
      .filter((entry) => entry.value.includes("—") || entry.value.includes("–"))
      .map((entry) => `${entry.key}: ${entry.value}`);

    expect(offenders).toEqual([]);
  });
});
