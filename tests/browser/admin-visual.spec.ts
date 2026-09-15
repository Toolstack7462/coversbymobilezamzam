import { test, expect, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { STORAGE_STATE } from "./helpers/admin-session";
import AxeBuilder from "@axe-core/playwright";

/**
 * Visual survey of the merchant control centre.
 *
 * ── WHAT THIS IS FOR ────────────────────────────────────────────────────────
 *
 * Two jobs, and the second is the one that earns its keep:
 *
 *   1. It captures every admin screen at three widths, so a refinement can be
 *      argued from before-and-after images rather than from adjectives.
 *   2. It ASSERTS the things a screenshot cannot show. A page that renders a
 *      500 still produces a perfectly good PNG, and a page whose content
 *      overflows horizontally looks fine in a full-page capture and is
 *      unusable on a phone. Both are failures here.
 *
 * It is deliberately not an "it renders" smoke test. Every screen must reach
 * 200, show exactly one `h1`, and fit its viewport horizontally — and the run
 * reports which screens fail rather than stopping at the first.
 *
 * ── WHY 390 / 768 / 1440 ────────────────────────────────────────────────────
 *
 * 390 is the phone the merchant actually holds behind the counter, 768 is the
 * tablet width where a sidebar has to decide what it is, and 1440 is the shop
 * computer. The default Playwright projects use 1280 and a Pixel 7; these are
 * the widths the design brief names, so the survey sets them explicitly rather
 * than inheriting whatever the project happens to use.
 */

const WIDTHS = [
  { name: "390", width: 390, height: 844 },
  { name: "768", width: 768, height: 1024 },
  { name: "1366", width: 1366, height: 768 },
  { name: "1440", width: 1440, height: 900 },
] as const;

/**
 * Every screen the brief requires reviewed, plus the ones a merchant reaches
 * most often. `heading` is a substring, matched case-insensitively, so a
 * wording change does not fail the survey — a MISSING heading does.
 */
const SCREENS = [
  { slug: "overview", path: "/admin", heading: /ciao|panoramica/i },
  { slug: "products", path: "/admin/prodotti", heading: /prodotti/i },
  { slug: "product-new", path: "/admin/prodotti/nuovo", heading: /prodotto/i },
  { slug: "inventory", path: "/admin/inventario", heading: /inventario/i },
  { slug: "orders", path: "/admin/ordini", heading: /ordini/i },
  /*
   * A specific order, by its seeded number.
   *
   * The detail workspace is where a merchant spends most of their time and
   * it was invisible to this survey until the fixture created orders. A
   * fixed id rather than "the first row": a survey whose target depends on
   * sort order is a survey that silently changes what it is looking at.
   */
  { slug: "order-detail", path: "/admin/ordini/ord_demo_review", heading: /DEMO-0003/ },
  { slug: "search", path: "/admin/cerca?q=cover", heading: /cerca/i },
  { slug: "payments", path: "/admin/pagamenti", heading: /pagamenti/i },
  { slug: "customers", path: "/admin/clienti", heading: /clienti/i },
  { slug: "devices", path: "/admin/dispositivi", heading: /dispositivi/i },
  { slug: "compatibility", path: "/admin/compatibilita", heading: /compatibilit/i },
  { slug: "taxonomy", path: "/admin/marchi", heading: /marchi|categorie/i },
  { slug: "content-homepage", path: "/admin/contenuti/homepage", heading: /homepage/i },
  { slug: "content-pages", path: "/admin/contenuti/pagine", heading: /pagine/i },
  { slug: "settings", path: "/admin/impostazioni", heading: /impostazioni/i },
  { slug: "staff", path: "/admin/personale", heading: /personale/i },
  { slug: "security", path: "/admin/sicurezza", heading: /sicurezza/i },
  { slug: "setup", path: "/admin/configurazione", heading: /configurazione/i },
  { slug: "system", path: "/admin/sistema", heading: /sistema/i },
] as const;

const OUT = "test-results/admin-visual";

test.use({ storageState: STORAGE_STATE });

test.beforeAll(() => {
  mkdirSync(OUT, { recursive: true });
});

/**
 * Horizontal overflow, measured rather than eyeballed.
 *
 * `scrollWidth > clientWidth` on the document is the definition of a page that
 * scrolls sideways. A few pixels are tolerated because sub-pixel layout and
 * scrollbar gutters produce a rounding difference that is not a design fault.
 *
 * An element allowed to scroll — a wide table in its own `overflow-x` box — is
 * fine and is not what this measures. The DOCUMENT scrolling sideways is what
 * makes a phone unusable.
 */
async function horizontalOverflow(page: Page): Promise<number> {
  return page.evaluate(() => {
    const el = document.documentElement;
    return el.scrollWidth - el.clientWidth;
  });
}

test.describe("branded admin workspace", () => {
  test.use({ viewport: { width: 1366, height: 768 } });

  test("finite depth stays readable, then stops for reduced motion", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => {
      if (/content security policy/i.test(message.text())) errors.push(message.text());
    });
    await page.goto("/admin", { waitUntil: "domcontentloaded" });
    await expect(page.locator(".ac__brand")).toContainText("Covers by Mobile Zam Zam");
    const scene = page.locator(".ac-brand-scene");
    await scene.evaluate((node) => {
      for (const animation of node.getAnimations({ subtree: true })) {
        animation.pause();
        animation.currentTime = 250;
      }
    });
    await expect(page.locator("h1")).toHaveCSS("opacity", "1");
    await expect(page.getByRole("link", { name: "Aggiungi prodotto", exact: true })).toBeVisible();
    const timings = await scene.locator(".ac-brand-scene__plate").evaluateAll((nodes) =>
      nodes.map((node) => {
        const style = getComputedStyle(node);
        return {
          duration: Number.parseFloat(style.animationDuration),
          count: style.animationIterationCount,
        };
      }),
    );
    expect(
      timings.every(
        (timing) => timing.duration > 0 && timing.duration <= 1.2 && timing.count === "1",
      ),
    ).toBe(true);
    await page.screenshot({ path: `${OUT}/depth-midpoint-1366.png` });
    expect((await new AxeBuilder({ page }).include(".ac").analyze()).violations).toEqual([]);
    await scene.evaluate(async (node) => {
      const animations = node.getAnimations({ subtree: true });
      animations.forEach((animation) => animation.play());
      await Promise.all(animations.map((animation) => animation.finished));
    });
    const front = scene.locator(".ac-brand-scene__plate--front");
    const settled = await front.evaluate((node) => getComputedStyle(node).transform);
    await scene.hover();
    await expect
      .poll(() => front.evaluate((node) => getComputedStyle(node).transform))
      .not.toBe(settled);
    await page.mouse.move(0, 0);
    await expect
      .poll(() => front.evaluate((node) => getComputedStyle(node).transform))
      .toBe(settled);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await expect(front).toHaveCSS("animation-name", "none");
    await expect(front).toHaveCSS("transition-property", "none");
    const reduced = await front.evaluate((node) => getComputedStyle(node).transform);
    await scene.hover();
    expect(await front.evaluate((node) => getComputedStyle(node).transform)).toBe(reduced);
    expect(errors).toEqual([]);
  });

  test("real route loading feedback keeps the current work visible", async ({ page }) => {
    await page.goto("/admin");
    const desktopNav = page.locator(".ac__nav-desktop");
    await desktopNav.getByText("Catalogo", { exact: true }).click();
    let release: (() => void) | undefined;
    await page.route("**/admin/prodotti.data*", async (route) => {
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      await route.continue();
    });
    try {
      await desktopNav.getByRole("link", { name: "Prodotti", exact: true }).click();
      await expect(page.locator(".ac__pending")).toBeVisible();
      await expect(page.locator("main")).toHaveAttribute("aria-busy", "true");
      await expect(page.locator("h1")).toContainText("Ciao");
      await expect(page.locator(".ac-headline")).toBeVisible();
    } finally {
      release?.();
    }
    await expect(page).toHaveURL(/\/admin\/prodotti$/);
    await expect(page.locator("h1")).toHaveText("Prodotti");
    await expect(page.locator(".ac__pending")).toHaveCount(0);
    await expect(page.locator("main")).toHaveAttribute("aria-busy", "false");
  });

  test("English and Italian survive navigation with the complete brand", async ({ page }) => {
    await page.goto("/admin");
    await page.getByRole("button", { name: "Lingua pannello: Italiano" }).click();
    await page.getByRole("button", { name: "English", exact: true }).click();
    await expect(page.locator("h1")).toContainText("Hello");
    await expect(page.locator(".ac__brand")).toContainText("Covers by Mobile Zam Zam");
    await page.screenshot({ path: `${OUT}/overview-en-1366.png`, fullPage: true });
    expect((await new AxeBuilder({ page }).include(".ac").analyze()).violations).toEqual([]);
    await page.reload();
    await expect(page.locator("h1")).toContainText("Hello");
    await page.getByRole("button", { name: "Admin language: English" }).click();
    await page.getByRole("button", { name: "Italiano", exact: true }).click();
    await expect(page.locator("h1")).toContainText("Ciao");
  });

  for (const width of [390, 768]) {
    test(`keyboard drawer stays usable at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 1024 });
      await page.goto("/admin");
      const drawer = page.locator(".ac__drawer");
      await drawer.locator(":scope > summary").focus();
      await page.keyboard.press("Enter");
      await expect(drawer).toHaveAttribute("open", "");
      await drawer
        .locator("summary")
        .filter({ hasText: /^Catalogo$/ })
        .focus();
      await page.keyboard.press("Enter");
      const products = drawer.getByRole("link", { name: "Prodotti", exact: true });
      await expect(products).toBeVisible();
      await products.focus();
      await expect(products).toBeFocused();
      await page.screenshot({ path: `${OUT}/drawer-${width}.png`, fullPage: true });
      expect((await new AxeBuilder({ page }).include(".ac").analyze()).violations).toEqual([]);
      await page.keyboard.press("Enter");
      await expect(page.locator("h1")).toHaveText("Prodotti");
      expect(await horizontalOverflow(page)).toBeLessThanOrEqual(2);
    });
  }
});

test.describe("admin depth without JavaScript", () => {
  test.use({ javaScriptEnabled: false, viewport: { width: 1366, height: 768 } });
  test("brand, metrics and native catalogue navigation are complete", async ({ page }) => {
    await page.goto("/admin");
    await expect(page.locator(".ac__brand")).toContainText("Covers by Mobile Zam Zam");
    await expect(page.locator(".ac-headline")).toBeVisible();
    const nav = page.locator(".ac__nav-desktop");
    await nav.getByText("Catalogo", { exact: true }).click();
    await nav.getByRole("link", { name: "Prodotti", exact: true }).click();
    await expect(page.locator("h1")).toHaveText("Prodotti");
    await expect(page.locator(".ac__pending")).toHaveCount(0);
  });
});

for (const size of WIDTHS) {
  test.describe(`admin at ${size.name}px`, () => {
    test.use({ viewport: { width: size.width, height: size.height } });

    for (const screen of SCREENS) {
      test(`${screen.slug}`, async ({ page }) => {
        const failures: string[] = [];

        const response = await page.goto(screen.path, { waitUntil: "networkidle" });
        const status = response?.status() ?? 0;
        if (status !== 200) failures.push(`HTTP ${status}`);

        // One h1 per page. Two is a page that has not decided what it is; none
        // is a page a screen reader cannot orient in.
        const headings = page.locator("h1");
        const count = await headings.count();
        if (count !== 1) failures.push(`${count} <h1> elements (expected 1)`);
        if (count > 0) {
          const text = (await headings.first().textContent()) ?? "";
          if (!screen.heading.test(text)) {
            failures.push(`h1 was ${JSON.stringify(text.trim())}, expected ${screen.heading}`);
          }
        }

        const overflow = await horizontalOverflow(page);
        if (overflow > 2) failures.push(`page scrolls ${overflow}px horizontally`);

        await page.screenshot({
          path: `${OUT}/${screen.slug}-${size.name}.png`,
          fullPage: true,
        });

        expect(failures, `${screen.path} at ${size.name}px`).toEqual([]);
      });
    }
  });
}
