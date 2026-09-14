import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

// The existing CI browser job runs the real built application and an isolated
// [DEMO] catalogue. These are lab screenshots, never evidence of merchant stock.
const widths = [
  { width: 390, height: 844 },
  { width: 768, height: 1024 },
  { width: 1366, height: 768 },
  { width: 1440, height: 900 },
];

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
      expect(overflow, `${route} overflows at ${viewport.width}px`).toBeLessThanOrEqual(1);
      await page.screenshot({
        path: testInfo.outputPath(`storefront-${name}-${viewport.width}.png`),
        fullPage: true,
        animations: "disabled",
      });
    }
  });
}

test.describe("hero interaction evidence", () => {
  test.use({
    viewport: { width: 1366, height: 768 },
    video: { mode: "on", size: { width: 1366, height: 768 } },
  });

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
