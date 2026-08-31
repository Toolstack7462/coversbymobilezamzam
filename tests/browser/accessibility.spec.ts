import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

/**
 * Accessibility, measured in a real browser.
 *
 * Everything before this was reasoning about markup. axe-core actually computes
 * the accessibility tree and the rendered contrast, which is the only way to
 * catch the two failures that markup review reliably misses: a colour pair that
 * looked fine in the palette but not against the surface it landed on, and a
 * control that is keyboard-reachable in theory and invisible in practice.
 *
 * The European Accessibility Act applies to this shop, so this is a legal
 * obligation as well as a decent one.
 *
 * **axe finds a minority of WCAG issues — roughly a third by most estimates.**
 * A clean run here is a floor, not a pass. It does not replace the manual
 * keyboard and screen-reader pass in docs/launch-checklist.md, which has not
 * been done.
 */

/** Public pages. The admin needs a session, so it is covered separately. */
const PUBLIC_PAGES = [
  { path: "/", name: "homepage" },
  { path: "/shop", name: "collection" },
  { path: "/trova-dispositivo", name: "device finder" },
  { path: "/carrello", name: "cart" },
  { path: "/negozio", name: "store page" },
  { path: "/en", name: "English homepage" },
  { path: "/admin/accedi", name: "admin login" },
];

for (const page of PUBLIC_PAGES) {
  test(`${page.name} has no detectable accessibility violations`, async ({ page: browserPage }) => {
    const response = await browserPage.goto(page.path);
    expect(response?.status(), `${page.path} should render`).toBeLessThan(400);

    const results = await new AxeBuilder({ page: browserPage })
      // AA is the legal standard. AAA is not required and failing it here would
      // produce noise that trains people to ignore the report.
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      .analyze();

    // Name the rule and the element, so a failure is actionable without
    // reopening the browser.
    const summary = results.violations.map(
      (v) => `${v.id} (${v.impact}): ${v.help}\n    ${v.nodes.map((n) => n.target).join("\n    ")}`,
    );
    expect(summary, `${page.path}\n${summary.join("\n")}`).toEqual([]);
  });
}

test.describe("keyboard", () => {
  test("the first tab stop is a working skip link", async ({ page }) => {
    // Without it, a keyboard user traverses the whole header on every single
    // page before reaching the content they came for.
    await page.goto("/");
    await page.keyboard.press("Tab");

    const focused = page.locator(":focus");
    await expect(focused).toBeVisible();

    const href = await focused.getAttribute("href");
    expect(href, "the first tab stop should link into the page").toMatch(/#/);

    await page.keyboard.press("Enter");
    await expect(page.locator("#main")).toBeAttached();
  });

  test("every focusable control shows a visible focus ring", async ({ page }) => {
    await page.goto("/");

    // Walk the first stretch of the tab order and assert each stop paints
    // something. Removing focus rings for tidiness is the single most common
    // way a site becomes unusable by keyboard.
    for (let i = 0; i < 12; i += 1) {
      await page.keyboard.press("Tab");
      const visible = await page.evaluate(() => {
        const el = document.activeElement;
        if (!el || el === document.body) return true;
        const style = getComputedStyle(el);
        // Compared as a string rather than parsed: the project bans parseFloat
        // so that money can never be read as a float, and a CSS width does not
        // need a number here anyway.
        const hasOutline = style.outlineStyle !== "none" && style.outlineWidth !== "0px";
        const hasShadow = style.boxShadow !== "none";
        const hasBorderChange = style.borderStyle !== "none";
        return hasOutline || hasShadow || hasBorderChange;
      });
      expect(visible, `tab stop ${i + 1} has no visible focus indicator`).toBe(true);
    }
  });
});

test.describe("layout", () => {
  test("no page scrolls horizontally on a phone", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "mobile", "viewport-specific");

    for (const target of PUBLIC_PAGES) {
      await page.goto(target.path);
      const overflows = await page.evaluate(
        () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
      );
      expect(overflows, `${target.path} scrolls sideways`).toBe(false);
    }
  });

  test("the document declares Italian", async ({ page }) => {
    // A screen reader that reads Italian with English phonemes is unusable, and
    // this is one attribute.
    await page.goto("/");
    await expect(page.locator("html")).toHaveAttribute("lang", "it");

    await page.goto("/en");
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
  });
});
