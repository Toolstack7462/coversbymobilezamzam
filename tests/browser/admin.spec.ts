import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { ADMIN, STORAGE_STATE } from "./helpers/admin-session";

/**
 * The admin, signed in, in a real browser.
 *
 * Until now the browser tests stopped at the login page, so every admin screen
 * was proven by integration tests and by reading. That left a real gap: nothing
 * checked that the pages actually render, that the two-factor gate lets a
 * properly enrolled account through, or that the tables collapse into cards on
 * a phone.
 *
 * These run serially and share one worker. Installation is a one-time operation
 * by design — the route closes itself afterwards — so parallel workers would
 * race to install and all but one would fail.
 */

// Every test here starts already signed in, from the cookies `auth.setup.ts`
// saved. Installation and two-factor enrolment ARE tested — that setup project
// is the test, and nothing below runs if it fails.
test.use({ storageState: STORAGE_STATE });

test.describe("first run", () => {
  // A logged-out browser, so the login form is actually reachable.
  test.use({ storageState: { cookies: [], origins: [] } });

  test("refuses the wrong password", async ({ page }) => {
    await page.goto("/admin/accedi");
    await page.fill('input[name="email"]', ADMIN.email);
    await page.fill('input[type="password"]', "non-e-la-password");
    await page.locator('form:has(input[name="email"]) button[type="submit"]').first().click();
    await page.waitForLoadState("networkidle");

    expect(page.url()).toContain("accedi");
    // The message must not say whether the email exists: that turns a login
    // form into an account-enumeration oracle.
    const body = (await page.locator("body").textContent()) ?? "";
    expect(body.toLowerCase()).not.toMatch(/utente non trovato|email non registrata/);
  });

  test("closes the installation route once used", async ({ page }) => {
    // Checked WITHOUT a session: the route must be shut to the whole internet,
    // not merely to people who happen to be signed in.
    const response = await page.goto("/admin/installazione");
    expect(response?.status()).toBe(404);
  });

  test("sends an unauthenticated visitor to the login page", async ({ page }) => {
    await page.goto("/admin/pagamenti");
    expect(page.url()).toContain("accedi");
  });
});

test.describe("the signed-in admin", () => {
  const SCREENS = [
    { path: "/admin", heading: /ciao|panoramica/i, name: "overview" },
    { path: "/admin/configurazione", heading: /configurazione/i, name: "setup centre" },
    { path: "/admin/prodotti", heading: /prodotti/i, name: "products" },
    { path: "/admin/prodotti/nuovo", heading: /aggiungi prodotto/i, name: "new product" },
    { path: "/admin/ordini", heading: /ordini/i, name: "orders" },
    { path: "/admin/pagamenti", heading: /verifica pagamenti/i, name: "payments" },
    { path: "/admin/inventario", heading: /inventario/i, name: "inventory" },
    { path: "/admin/dispositivi", heading: /dispositivi/i, name: "devices" },
    { path: "/admin/marchi", heading: /marchi e categorie/i, name: "taxonomy" },
    { path: "/admin/compatibilita", heading: /compatibilit/i, name: "compatibility" },
    { path: "/admin/contenuti/legale", heading: /documenti legali/i, name: "legal" },
    { path: "/admin/impostazioni", heading: /impostazioni/i, name: "settings" },
    { path: "/admin/personale", heading: /personale/i, name: "staff" },
    { path: "/admin/sistema", heading: /stato del sistema/i, name: "system health" },
    { path: "/admin/registro", heading: /attivit|registro/i, name: "audit log" },
    { path: "/admin/importazioni", heading: /importa ed esporta/i, name: "import/export" },
  ];

  for (const screen of SCREENS) {
    test(`${screen.name} renders`, async ({ page }) => {
      const response = await page.goto(screen.path);
      // A 500 from a mistyped column name is the failure this catches — raw SQL
      // is invisible to TypeScript, so only actually loading the page proves it.
      expect(response?.status(), `${screen.path} returned ${response?.status()}`).toBeLessThan(400);
      await expect(page.locator("h1")).toContainText(screen.heading);
    });
  }

  test("every screen is free of detectable accessibility violations", async ({ page }) => {
    // Public pages are covered in accessibility.spec.ts; these need a session,
    // and staff use them for hours a day.
    for (const screen of SCREENS) {
      await page.goto(screen.path);
      const results = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
        .analyze();

      const summary = results.violations.map(
        (v) => `${v.id} (${v.impact}): ${v.help} — ${v.nodes.map((n) => n.target).join(" ")}`,
      );
      expect(summary, `${screen.path}\n${summary.join("\n")}`).toEqual([]);
    }
  });

  test("the sidebar links to screens that exist", async ({ page }) => {
    await page.goto("/admin");

    const hrefs = await page
      .locator("nav a[href^='/admin']")
      .evaluateAll((links) => links.map((a) => (a as HTMLAnchorElement).getAttribute("href")!));
    expect(hrefs.length).toBeGreaterThan(5);

    // The unit test checks these against the route table. This checks the
    // server actually answers, which is the part a route table cannot promise.
    for (const href of [...new Set(hrefs)]) {
      const response = await page.goto(href);
      expect(response?.status(), `${href} returned ${response?.status()}`).toBeLessThan(400);
    }
  });
});

test.describe("adding a product end to end", () => {
  test("creates a product and lands on its editor", async ({ page }) => {
    await page.goto("/admin/prodotti/nuovo");

    const sku = `E2E-${Date.now()}`;
    await page.fill('input[name="name"]', "Cover trasparente da test");
    await page.fill('input[name="sku"]', sku);
    await page.fill('input[name="price"]', "19,90");
    await page.fill('input[name="onHand"]', "5");
    // Scoped to the product form: the admin shell puts a logout submit button
    // on every page, so an unscoped selector matches two and Playwright
    // refuses — which reads as a timeout rather than as an ambiguous locator.
    await page.locator('form:has(input[name="sku"]) button[type="submit"]').first().click();
    await page.waitForLoadState("networkidle");

    // Straight to the editor, not back to the list: the merchant came to add a
    // product and the next thing they want is the product.
    expect(page.url()).toMatch(/\/admin\/prodotti\/[^/]+/);
    await expect(page.locator("body")).toContainText("Cover trasparente da test");

    // Created as a draft, and the page says so rather than leaving the merchant
    // to wonder why it is not on the site.
    await expect(page.locator("body")).toContainText(/bozza/i);
  });

  test("refuses a duplicate SKU with a sentence", async ({ page }) => {
    const sku = `DUP-${Date.now()}`;

    for (const attempt of [1, 2]) {
      await page.goto("/admin/prodotti/nuovo");
      await page.fill('input[name="name"]', `Prodotto ${attempt}`);
      await page.fill('input[name="sku"]', sku);
      await page.locator('form:has(input[name="sku"]) button[type="submit"]').first().click();
      await page.waitForLoadState("networkidle");
    }

    // Not a constraint violation leaking through as a 500.
    await expect(page.locator('[role="alert"]')).toContainText(sku);
  });

  test("will not publish a product with no price", async ({ page }) => {
    await page.goto("/admin/prodotti/nuovo");
    await page.fill('input[name="name"]', "Senza prezzo da test");
    await page.fill('input[name="sku"]', `NOPRICE-${Date.now()}`);
    await page.locator('form:has(input[name="sku"]) button[type="submit"]').first().click();
    await page.waitForLoadState("networkidle");

    const publish = page.locator('button[value="set-status"]');
    if ((await publish.count()) > 0) {
      await publish.first().click();
      await page.waitForLoadState("networkidle");
      // Publishing would produce a live page nobody can buy from.
      await expect(page.locator('[role="alert"]')).toContainText(/prezzo/i);
    }
  });
});

test.describe("tables on a phone", () => {
  test("collapse into cards rather than scrolling sideways", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "mobile", "viewport-specific");

    await page.goto("/admin/prodotti");

    // The same markup becomes cards through CSS alone. If the header row is
    // still laid out as a table, the breakpoint did not apply.
    const headerVisible = await page.locator(".ac-table thead").isVisible();
    expect(headerVisible).toBe(false);

    const overflows = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
    );
    expect(overflows).toBe(false);
  });
});
