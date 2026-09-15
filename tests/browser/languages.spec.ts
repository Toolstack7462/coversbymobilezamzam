import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { STORAGE_STATE } from "./helpers/admin-session";

async function switchAdmin(page: Page, language: "English" | "Italiano") {
  await page.locator(".ac__language > summary").click();
  await page.locator(".ac__language").getByRole("button", { name: language, exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("lang", language === "English" ? "en" : "it");
  await expect(page.locator(".ac__language-label")).toHaveText(
    language === "English" ? "Language" : "Lingua",
  );
  await expect(page.locator(".ac__language-copy [lang]")).toHaveText(language);
}

test("staff sign-in language is server rendered and independent of public URLs", async ({
  browser,
  baseURL,
}) => {
  const context = await browser.newContext({ baseURL: baseURL! });
  const page = await context.newPage();
  try {
    await page.goto("/admin/accedi");
    await switchAdmin(page, "English");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Staff sign in");
    await expect(page.getByRole("button", { name: "Sign in", exact: true })).toBeVisible();
    // Use Chromium's actual navigation: its loopback Secure-cookie handling
    // differs from APIRequestContext. The production cookie must stay Secure.
    const response = await page.reload();
    const html = await response!.text();
    expect(html).toMatch(/<html[^>]*lang="en"/);
    expect(html).toContain("Staff sign in");
    await page.goto("/");
    await expect(page.locator("html")).toHaveAttribute("lang", "it");
    await page.goto("/en/");
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    await expect(page).toHaveTitle("Covers by Mobile Zam Zam | Smartphone accessories");
  } finally {
    await context.close();
  }
});

test.describe("authenticated English interface", () => {
  test.use({ storageState: STORAGE_STATE });

  test("English product creation preserves merchant text, SKU and price", async ({
    page,
  }, testInfo) => {
    await page.goto("/admin/prodotti/nuovo");
    await switchAdmin(page, "English");
    const name = `Language test — merchant text ${testInfo.project.name} ${testInfo.retry}`;
    const sku = `LANG-${testInfo.project.name}-${Date.now()}`;
    await page.locator('input[name="name"]').fill(name);
    await page.locator('input[name="sku"]').fill(sku);
    await page.locator('input[name="price"]').fill("39.90");
    await page.locator('input[name="onHand"]').fill("3");
    await page.getByRole("button", { name: "Create product", exact: true }).click();
    await expect(page).toHaveURL(/\/admin\/prodotti\/[^/?]+\?creato=1$/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(name);
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    await expect(page.getByRole("status").filter({ hasText: "Product created" })).toBeVisible();
    await page.reload();
    await expect(page.locator('input[name="name"]')).toHaveValue(name);
    await expect(page.locator('input[name="amount"]').first()).toHaveValue(/39[,.]90/);
    await expect(page.locator("main")).toContainText(sku.toUpperCase());
    await switchAdmin(page, "Italiano");
    await expect(page.locator('input[name="name"]')).toHaveValue(name);
  });

  test("keeps filters, fragments and language on SSR reloads and client navigation", async ({
    page,
  }) => {
    await page.goto("/admin/prodotti?q=cover#main");
    await switchAdmin(page, "English");
    await expect(page).toHaveURL(/\/admin\/prodotti\?q=cover#main$/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Products");
    await expect(page).toHaveTitle(/Products/);
    await page.reload();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Products");
    await page.getByRole("link", { name: "Add product", exact: true }).click();
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(/product/i);
    await expect(
      page.getByRole("textbox", { name: "Product name required", exact: true }),
    ).toBeVisible();
    await switchAdmin(page, "Italiano");
    await expect(page).toHaveURL(/\/admin\/prodotti\/nuovo$/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(/prodotto/i);
  });

  test("English screens keep working across the actual admin routes", async ({ page }) => {
    await page.goto("/admin");
    await switchAdmin(page, "English");
    for (const [route, heading] of [
      ["/admin", /Hello/],
      ["/admin/prodotti", /Products/],
      ["/admin/ordini", /Orders/],
      ["/admin/ordini/ord_demo_review", /DEMO-0003/],
      ["/admin/pagamenti", /Payment verification/],
      ["/admin/ritiri", /pickup/i],
      ["/admin/spedizioni", /Shipments/],
      ["/admin/resi", /Returns/],
      ["/admin/clienti", /Customers/],
      ["/admin/marchi", /Brands/],
      ["/admin/dispositivi", /Devices/],
      ["/admin/famiglie", /families/i],
      ["/admin/compatibilita", /Compatibility/],
      ["/admin/inventario", /Inventory/],
      ["/admin/inventario/movimenti", /Movements/i],
      ["/admin/inventario/rettifiche", /Adjustments/i],
      ["/admin/inventario/trasferimenti", /Transfers/],
      ["/admin/inventario/scorte-basse", /Low stock/],
      ["/admin/inventario/prenotazioni", /Stock reservations/],
      ["/admin/sconti", /Discount/],
      ["/admin/promozioni", /Promotions/],
      ["/admin/recensioni", /Reviews/],
      ["/admin/in-evidenza", /Featured/],
      ["/admin/contenuti/homepage", /Homepage/],
      ["/admin/contenuti/menu", /navigation/i],
      ["/admin/contenuti/pagine", /Pages/],
      ["/admin/contenuti/legale", /Legal/],
      ["/admin/contenuti/seo", /SEO/],
      ["/admin/impostazioni", /Settings/],
      ["/admin/personale", /Staff/],
      ["/admin/sicurezza", /Security/],
      ["/admin/sicurezza/sessioni", /sessions/i],
      ["/admin/importazioni", /Import/],
      ["/admin/configurazione", /Setup/i],
      ["/admin/sistema", /System/],
      ["/admin/registro", /Activity/],
    ] as const) {
      const response = await page.goto(route);
      expect(response?.status(), route).toBe(200);
      await expect(page.getByRole("heading", { level: 1 }), route).toHaveText(heading);
      await expect(page.locator("html"), route).toHaveAttribute("lang", "en");
      await expect(page.locator("head title"), route).toHaveCount(1);
      if (route === "/admin/ordini/ord_demo_review") {
        await expect(page.locator('[data-label="Articolo"]')).toHaveCount(0);
        await expect(page.locator('[data-label="Item"]').first()).toBeVisible();
      }
    }
  });

  test("language controls fit four widths and remain keyboard accessible", async ({
    page,
  }, testInfo) => {
    await page.goto("/admin");
    await switchAdmin(page, "English");
    await expect(page.locator(".ac-headline .ac-metric__note")).toHaveText(
      "Orders placed, not payments received",
    );
    await expect(page.locator(".ac-metrics .ac-metric__note")).toHaveText(
      "Confirmed by a staff member",
    );
    await expect(page.locator(".ac-headline .ac-metric__value").nth(1)).toHaveText(
      /^€[\d,]+\.\d{2}$/,
    );
    for (const width of [390, 768, 1366, 1440]) {
      await page.setViewportSize({ width, height: width === 1366 ? 768 : 900 });
      const summary = page.locator(".ac__language > summary");
      await expect(page.locator(".ac__language-label")).toBeVisible();
      await expect(page.locator(".ac__brand .brand-lockup__secondary")).toBeVisible();
      const chrome = await page
        .locator(
          ".ac__brand, .ac__language > summary, .ac__mobile-search:visible, .ac__topbar > .ac__menu:not(.ac__language) > summary",
        )
        .evaluateAll((nodes) =>
          nodes.map((node) => {
            const { left, right, top, bottom } = node.getBoundingClientRect();
            return { left, right, top, bottom };
          }),
        );
      for (let i = 0; i < chrome.length; i++) {
        for (let j = i + 1; j < chrome.length; j++) {
          const a = chrome[i]!;
          const b = chrome[j]!;
          const area =
            Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left)) *
            Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
          expect(area, `header controls overlap at ${width}px`).toBeLessThanOrEqual(1);
        }
      }
      await summary.focus();
      await page.keyboard.press("Enter");
      await expect(page.locator(".ac__language")).toHaveAttribute("open", "");
      await expect(page.locator(".ac__language button[aria-pressed=true]")).toHaveText("English");
      const box = await summary.boundingBox();
      expect(box?.width).toBeGreaterThanOrEqual(44);
      expect(box?.height).toBeGreaterThanOrEqual(44);
      const menu = await page.locator(".ac__language .ac__menu-panel").boundingBox();
      expect(menu!.x).toBeGreaterThanOrEqual(0);
      expect(menu!.x + menu!.width).toBeLessThanOrEqual(width);
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth - innerWidth),
      ).toBeLessThanOrEqual(1);
      await page.screenshot({
        path: testInfo.outputPath(`admin-language-en-${width}.png`),
        fullPage: true,
      });
      await summary.click();
    }
    const accessibility = await new AxeBuilder({ page }).include(".ac__topbar").analyze();
    expect(accessibility.violations).toEqual([]);
  });
});

test("admin language switching also works without JavaScript", async ({ browser, baseURL }) => {
  const context = await browser.newContext({
    baseURL: baseURL!,
    storageState: STORAGE_STATE,
    javaScriptEnabled: false,
  });
  const page = await context.newPage();
  try {
    await page.goto("/admin/prodotti?q=cover");
    await switchAdmin(page, "English");
    await expect(page).toHaveURL(/\/admin\/prodotti\?q=cover$/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Products");
    await switchAdmin(page, "Italiano");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Prodotti");
  } finally {
    await context.close();
  }
});

test("footer language switches retain the current page and search filters", async ({ page }) => {
  await page.goto("/shop?q=cover&pagina=1#main");
  await expect(page.locator("footer .lang-switch__label")).toHaveText("Lingua");
  await page.locator("footer").getByRole("link", { name: "English", exact: true }).click();
  await expect(page).toHaveURL(/\/en\/shop\?q=cover&pagina=1#main$/);
  await expect(page).toHaveTitle(/Search: cover/);
  await expect(page.locator("footer .lang-switch__label")).toHaveText("Language");
  await page.locator("footer").getByRole("link", { name: "Italiano", exact: true }).click();
  await expect(page).toHaveURL(/\/shop\?q=cover&pagina=1#main$/);
  await page.goto("/en/carrello");
  await expect(page).toHaveTitle(/Shopping cart/);
  const response = await page.request.get("/en/carrello");
  expect(await response.text()).toContain("Shopping cart | Covers by Mobile Zam Zam");
  await expect(page.locator("head title")).toHaveCount(1);
});
