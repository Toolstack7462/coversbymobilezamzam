import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * Every password input in the admin is the shared `PasswordField`.
 *
 * This test exists because the admin had twelve `type="password"` inputs across
 * nine screens and not one of them could be revealed. Each was written
 * separately, so each could get its `autocomplete` wrong on its own, and the
 * merchant confirming a payment or enrolling a second factor had to type a
 * generated password blind and guess, on failure, whether they had mistyped it
 * or forgotten it.
 *
 * The point of the guard is the NEXT screen. A new admin form with a password
 * on it is written by copying a nearby one, and a raw `<input type="password">`
 * copied from anywhere would silently reintroduce a field with no reveal
 * control and possibly the wrong autocomplete. This fails that copy.
 *
 * ── WHAT THIS DELIBERATELY DOES NOT CHECK ───────────────────────────────────
 *
 * Behaviour. Whether the toggle flips the type, keeps the caret, re-masks when
 * the tab is hidden or fires no network request is a question about a live DOM,
 * and it is answered in `tests/browser/admin-password.spec.ts` against real
 * browsers. This is a static guard over the source: cheap, runs on every commit
 * and catches the one mistake that is made by copy-and-paste.
 */

const SOURCE_DIRS = ["app/routes", "app/components"];

/**
 * The component's own file, which necessarily contains the raw input.
 *
 * One exemption, by exact path. A pattern would let a new file opt itself out.
 */
const COMPONENT = join("app", "components", "admin", "password-field.tsx");

function sourceFiles(): string[] {
  const walk = (dir: string): string[] =>
    readdirSync(dir).flatMap((entry) => {
      const full = join(dir, entry);
      return statSync(full).isDirectory() ? walk(full) : /\.tsx$/.test(full) ? [full] : [];
    });
  return SOURCE_DIRS.flatMap(walk);
}

describe("admin password inputs", () => {
  it("uses the shared component, never a raw password input", () => {
    const offenders = sourceFiles()
      .filter((file) => file !== COMPONENT)
      .filter((file) => /type="password"/.test(readFileSync(file, "utf8")));

    expect(offenders).toEqual([]);
  });

  /**
   * A password the person already has is `current-password`; one they are
   * choosing is `new-password`.
   *
   * Not pedantry. Get it backwards and a password manager offers to fill the
   * existing password into the "new password" box — which either sets the
   * password to itself or, on a form that rejects reuse, produces an error the
   * merchant cannot explain. The prop is typed to this union, so the only way
   * to be wrong is to pass the wrong member of it; this catches that.
   */
  it("asks for a new password only where one is being chosen", () => {
    /** Files where a password is CHOSEN rather than confirmed. */
    const CHOOSING = new Set([
      join("app", "routes", "admin", "setup.tsx"),
      join("app", "routes", "admin", "staff-accept.tsx"),
    ]);

    for (const file of sourceFiles()) {
      if (file === COMPONENT) continue;
      const source = readFileSync(file, "utf8");
      if (!source.includes("<PasswordField")) continue;

      const autocompletes = [...source.matchAll(/autoComplete="(current|new)-password"/g)].map(
        (match) => match[1],
      );
      expect(autocompletes.length).toBeGreaterThan(0);

      if (CHOOSING.has(file)) {
        expect(autocompletes).toContain("new");
      } else {
        // Every other password in the admin is a step-up confirmation of the
        // signed-in user's OWN existing password. None of them chooses one.
        expect(autocompletes).not.toContain("new");
      }
    }
  });

  /**
   * Nothing persists a password, anywhere, by any route.
   *
   * `localStorage`, a query string and an analytics call are three different
   * ways of writing a plaintext credential somewhere it outlives the form.
   * This looks for them in the same files as the password fields themselves,
   * where such a line would most plausibly be added "to help the user".
   */
  it("never persists a password value", () => {
    const forbidden = [/localStorage[^\n]*password/i, /sessionStorage[^\n]*password/i];

    for (const file of sourceFiles()) {
      const source = readFileSync(file, "utf8");
      if (!/password/i.test(source)) continue;
      for (const pattern of forbidden) {
        expect(pattern.test(source), `${file} appears to store a password`).toBe(false);
      }
    }
  });
});
