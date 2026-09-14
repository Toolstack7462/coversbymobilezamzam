import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

/**
 * A shorthand must never follow one of its own longhands in the same rule.
 *
 * ── THE BUG THIS EXISTS FOR ─────────────────────────────────────────────────
 *
 * `app/styles/app.css` had this, inside a single `body` block:
 *
 *     background-image: linear-gradient(180deg, #fdfcf7 0%, … 46vh);
 *     background-repeat: no-repeat;
 *     …
 *     background: var(--color-background);
 *
 * The shorthand resets EVERY background longhand, so it silently deleted the
 * gradient three declarations above it. The page rendered a flat fill, and the
 * comment above the rule went on describing a light source the browser never
 * drew.
 *
 * It is the worst shape of CSS bug: both declarations are individually correct,
 * the file looks right in review, nothing warns, and the only symptom is an
 * effect that is quietly absent. The usual "fix" is another rule with a higher
 * specificity, or `!important`, which leaves the reset in place and makes the
 * next one harder to find.
 *
 * So this checks the whole class rather than the one instance, in every
 * stylesheet, for every shorthand family that can silently erase work above it.
 *
 * ── WHAT IS DELIBERATELY NOT FLAGGED ────────────────────────────────────────
 *
 * A longhand AFTER a shorthand is the correct idiom — `background: none` then
 * `background-color: red` reads as "reset, then set one part" and is exactly
 * how you are supposed to narrow a shorthand. Only shorthand-after-longhand is
 * a silent deletion.
 */

const STYLESHEETS = [
  "app/styles/app.css",
  "app/styles/admin.css",
  "app/styles/admin-forms.css",
  "app/styles/storefront.css",
  "app/styles/tokens.css",
];

/**
 * Shorthands, and the longhands each one actually resets.
 *
 * Listed explicitly rather than matched by the `family-` prefix, because the
 * prefix is wrong often enough to make the check untrustworthy:
 *
 *   - `flex` resets grow, shrink and basis — NOT `flex-direction` or
 *     `flex-wrap`, which belong to `flex-flow`. Prefix matching reported two
 *     rules that were perfectly correct.
 *   - `outline` resets colour, style and width — NOT `outline-offset`.
 *
 * A guard that cries wolf is a guard someone deletes, so it is better to check
 * fewer families precisely than many of them loosely.
 *
 * `border` is omitted deliberately: `border-radius` is not part of the
 * `border` shorthand, and the exception costs more subtlety than the check is
 * worth here.
 */
const FAMILIES: Record<string, readonly string[]> = {
  background: [
    "background-color",
    "background-image",
    "background-repeat",
    "background-attachment",
    "background-position",
    "background-size",
    "background-origin",
    "background-clip",
  ],
  font: [
    "font-style",
    "font-variant",
    "font-weight",
    "font-stretch",
    "font-size",
    "line-height",
    "font-family",
  ],
  margin: ["margin-top", "margin-right", "margin-bottom", "margin-left"],
  padding: ["padding-top", "padding-right", "padding-bottom", "padding-left"],
  transition: [
    "transition-property",
    "transition-duration",
    "transition-timing-function",
    "transition-delay",
  ],
  animation: [
    "animation-name",
    "animation-duration",
    "animation-timing-function",
    "animation-delay",
    "animation-iteration-count",
    "animation-direction",
    "animation-fill-mode",
    "animation-play-state",
  ],
  flex: ["flex-grow", "flex-shrink", "flex-basis"],
  "flex-flow": ["flex-direction", "flex-wrap"],
  "list-style": ["list-style-type", "list-style-position", "list-style-image"],
  outline: ["outline-color", "outline-style", "outline-width"],
  overflow: ["overflow-x", "overflow-y"],
};

interface Offence {
  file: string;
  family: string;
  longhand: string;
  shorthand: string;
  selector: string;
}

/** Splits a stylesheet into `{ selector, body }` blocks, comments stripped. */
function rules(source: string): Array<{ selector: string; body: string }> {
  const withoutComments = source.replace(/\/\*[\s\S]*?\*\//g, "");
  const out: Array<{ selector: string; body: string }> = [];

  // Innermost braces only: a media query's body is itself full of blocks, and
  // matching those would compare declarations that never share a rule.
  const block = /([^{}]+)\{([^{}]*)\}/g;
  let match: RegExpExecArray | null;
  while ((match = block.exec(withoutComments)) !== null) {
    out.push({ selector: (match[1] ?? "").trim(), body: match[2] ?? "" });
  }
  return out;
}

function findOffences(file: string): Offence[] {
  const offences: Offence[] = [];

  for (const { selector, body } of rules(readFileSync(file, "utf8"))) {
    const declarations = body
      .split(";")
      .map((d) => d.trim())
      .filter(Boolean)
      .map((d) => d.slice(0, d.indexOf(":")).trim().toLowerCase())
      .filter(Boolean);

    for (const [family, longhands] of Object.entries(FAMILIES)) {
      const firstLonghand = declarations.findIndex((p) => longhands.includes(p));
      if (firstLonghand === -1) continue;

      const shorthandAfter = declarations.findIndex(
        (p, index) => index > firstLonghand && p === family,
      );
      if (shorthandAfter === -1) continue;

      offences.push({
        file,
        family,
        longhand: declarations[firstLonghand] as string,
        shorthand: family,
        selector: selector.length > 60 ? `${selector.slice(0, 60)}…` : selector,
      });
    }
  }

  return offences;
}

describe("stylesheets", () => {
  it("never lets a shorthand silently reset a longhand above it", () => {
    const offences = STYLESHEETS.flatMap(findOffences);

    // Reported as readable lines: a bare array of objects in a diff is
    // unreadable at the exact moment someone needs to act on it.
    const report = offences.map(
      (o) => `${o.file}  {${o.selector}}  "${o.longhand}" is reset by a later "${o.shorthand}:"`,
    );

    expect(report).toEqual([]);
  });
});
