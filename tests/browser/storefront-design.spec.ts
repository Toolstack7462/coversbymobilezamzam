import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

// The existing CI browser job runs the real built application and an isolated
// [DEMO] catalogue. These are lab screenshots, never evidence of merchant stock.
test.use({
  viewport: { width: 1366, height: 768 },
  video: { mode: "on", size: { width: 1366, height: 768 } },
});

const widths = [
  { width: 390, height: 844 },
  { width: 768, height: 1024 },
  { width: 1366, height: 768 },
  { width: 1440, height: 900 },
];

// Same browser, production build, fixture and measurement window before/after.
// These are repeatable lab samples, not field Core Web Vitals or a budget waiver.
test("representative storefront browser measurements", async ({ page }) => {
  await page.addInitScript(() => {
    const metrics = { lcp: 0, cls: 0, longTasks: 0 };
    Object.assign(window, { storefrontMetrics: metrics });
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) metrics.lcp = entry.startTime;
    }).observe({ type: "largest-contentful-paint", buffered: true });
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        const shift = entry as PerformanceEntry & { value: number; hadRecentInput: boolean };
        if (!shift.hadRecentInput) metrics.cls += shift.value;
      }
    }).observe({ type: "layout-shift", buffered: true });
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) metrics.longTasks += entry.duration;
    }).observe({ type: "longtask", buffered: true });
  });
  for (const [width, route] of [
    [1366, "/"],
    [390, "/"],
    [1366, "/shop"],
    [1366, "/prodotti/demo-cover-trasparente-iphone-16-pro"],
  ] as const) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 768 });
    for (let sample = 1; sample <= 3; sample += 1) {
      await page.goto(route);
      await page.evaluate(() => document.fonts.ready);
      // Fixed 1.8s window includes entrance, hydration and settled first view.
      await page.waitForTimeout(1800);
      const metrics = await page.evaluate(() => {
        const custom = (
          window as Window & {
            storefrontMetrics?: { lcp: number; cls: number; longTasks: number };
          }
        ).storefrontMetrics;
        const nav = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming;
        const resources = performance.getEntriesByType("resource") as PerformanceResourceTiming[];
        const bytes = (pattern: RegExp) =>
          resources
            .filter((entry) => pattern.test(entry.name))
            .reduce((sum, entry) => sum + entry.encodedBodySize, 0);
        return {
          ...custom,
          fcp: performance.getEntriesByName("first-contentful-paint")[0]?.startTime,
          ttfb: nav.responseStart - nav.requestStart,
          jsBytes: bytes(/\.js(?:\?|$)/),
          cssBytes: bytes(/\.css(?:\?|$)/),
          imageBytes: bytes(/\.(?:png|jpe?g|webp|avif|svg)(?:\?|$)/),
          loadedImages: document.querySelectorAll("img").length,
          pendingImages: [...document.images].filter((img) => !img.complete).length,
        };
      });
      console.log("STOREFRONT_LAB " + JSON.stringify({ width, route, sample, ...metrics }));
    }
  }
});

for (const viewport of widths) {
  test(`storefront fits ${viewport.width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize(viewport);
    for (const [name, route] of [
      ["home", "/"],
      ["shop", "/shop"],
      ["finder", "/trova-dispositivo"],
      ["cart", "/carrello"],
      ["product", "/prodotti/demo-cover-trasparente-iphone-16-pro"],
    ]) {
      const response = await page.goto(route!);
      expect(response?.status()).toBe(200);
      await expect(page.locator("h1")).toHaveCount(1);
      await expect(page).toHaveTitle(/Covers by Mobile Zam Zam/);
      await expect(page.locator("head title")).toHaveCount(1);
      await expect(page.locator("a a, a button, button a, button button")).toHaveCount(0);
      await page.evaluate(() => document.fonts.ready);
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      if (overflow > 1) {
        const offenders = await page.locator("body *").evaluateAll((nodes) =>
          nodes
            .filter((node) => node.getBoundingClientRect().right > innerWidth + 1)
            .map((node) => ({
              tag: node.tagName,
              className: node.className,
              width: node.getBoundingClientRect().width,
              right: node.getBoundingClientRect().right,
            })),
        );
        console.log("OVERFLOW", route, viewport.width, JSON.stringify(offenders));
      }
      await page.screenshot({
        path: testInfo.outputPath(`storefront-${name}-${viewport.width}.png`),
        fullPage: true,
        animations: "disabled",
      });
      expect.soft(overflow, `${route} overflows at ${viewport.width}px`).toBeLessThanOrEqual(1);
    }
  });
}

test.describe("hero interaction evidence", () => {
  test("modes work by keyboard and retain readable content", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => {
      if (/content security policy/i.test(message.text())) errors.push(message.text());
    });
    await page.goto("/");
    const buttons = page.locator(".showcase__controls button");
    const advice = page.locator(".showcase__advice p");
    await expect(buttons).toHaveCount(3);
    for (let index = 0; index < 3; index += 1) {
      await buttons.nth(index).focus();
      await page.keyboard.press("Space");
      await expect(buttons.nth(index)).toHaveAttribute("aria-pressed", "true");
      await expect(page.locator('.showcase__controls [aria-pressed="true"]')).toHaveCount(1);
      await expect(advice).not.toBeEmpty();
      await expect(page.locator(".showcase__copy h1")).toBeVisible();
      // Let the user-triggered transition finish before recording the next mode.
      await page.locator(".showcase__controls").evaluate(async (node) => {
        await Promise.all(
          node.getAnimations({ subtree: true }).map((animation) => animation.finished),
        );
      });
      const result = await new AxeBuilder({ page }).include(".showcase").analyze();
      expect(result.violations).toEqual([]);
    }
    expect(errors).toEqual([]);
    await page.locator('.showcase__copy a[href="/shop"]').click();
    await expect(page).toHaveURL(/\/shop$/);
    await expect(page).toHaveTitle(/Covers by Mobile Zam Zam/);
  });
});

test("reduced motion keeps the illustration stationary", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  const objects = page.locator(".showcase__case, .showcase__disc, .showcase__cable");
  const before = await objects.evaluateAll((nodes) =>
    nodes.map((node) => getComputedStyle(node).transform),
  );
  await page.locator(".showcase__controls button").nth(2).click();
  const after = await objects.evaluateAll((nodes) =>
    nodes.map((node) => getComputedStyle(node).transform),
  );
  expect(after).toEqual(before);
  const animated = await page
    .locator(".showcase")
    .evaluate((node) => node.getAnimations({ subtree: true }).length);
  expect(animated).toBe(0);
});

test("the selected variant survives adding, updating and removing a cart line", async ({
  page,
}) => {
  await page.goto("/prodotti/demo-cover-trasparente-iphone-16-pro");
  const variant = await page.locator('#acquista input[name="variantId"]').inputValue();
  expect(variant).not.toBe("");
  await page.locator("#quantity").fill("2");
  await page.locator('#acquista button[type="submit"]').click();
  await expect(page).toHaveURL(/\/carrello$/);
  const line = page
    .locator(".cart-line")
    .filter({ has: page.locator(`input[value="${variant}"]`) });
  await expect(line).toHaveCount(1);
  await expect(line.locator('input[name="quantity"]')).toHaveValue("2");
  await line.locator('input[name="quantity"]').fill("1");
  await line.getByRole("button", { name: "Salva", exact: true }).click();
  await expect(line.locator('input[name="quantity"]')).toHaveValue("1");
  await line.getByRole("button", { name: "Rimuovi", exact: true }).click();
  await expect(page.locator(".cart-line")).toHaveCount(0);
  await expect(page.locator(".empty-state")).toBeVisible();
});

test.describe("static first render", () => {
  test.use({ javaScriptEnabled: false });
  test("hero and shopping links work without hydration", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator(".showcase__copy h1")).toBeVisible();
    await expect(page.locator(".showcase__stage")).toBeVisible();
    await page.locator('.showcase__copy a[href="/shop"]').click();
    await expect(page).toHaveURL(/\/shop$/);
    await expect(page.locator(".product-card").first()).toBeVisible();
  });
});
