import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { STORAGE_STATE } from "./helpers/admin-session";
import { pngFixture } from "./helpers/image-fixture";
import { execFileSync } from "node:child_process";

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
      ["store", "/negozio"],
    ]) {
      const response = await page.goto(route!);
      expect(response?.status()).toBe(200);
      await expect(page.locator("h1")).toHaveCount(1);
      await expect(page).toHaveTitle(/Covers by Mobile Zam Zam/);
      await expect(page.locator("head title")).toHaveCount(1);
      await expect(page.locator('link[rel="icon"][type="image/svg+xml"]')).toHaveAttribute(
        "href",
        "/favicon.svg",
      );
      await expect(page.locator("a a, a button, button a, button button")).toHaveCount(0);
      if (name === "shop" && viewport.width >= 1366) {
        expect((await page.locator(".product-card").first().boundingBox())!.y).toBeLessThan(520);
      }
      if (name === "home") {
        await expect(page.locator(".site-footer__inner > *")).toHaveCount(4);
        await expect(page.locator(".showcase__caption")).toHaveCount(0);
        await expect(page.locator(".showcase")).not.toContainText(
          /brand illustration|illustrazione del brand/i,
        );
      }
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

test("slow navigation acknowledges the click while keeping the page usable", async ({ page }) => {
  await page.goto("/");
  let release = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(/\/shop\.data(?:\?|$)/, async (route) => {
    await held;
    await route.continue();
  });
  const click = page.locator('.showcase__copy a[href="/shop"]').click();
  try {
    await expect(page.locator(".route-pending")).toContainText("Caricamento");
    await expect(page.locator("#main")).toHaveAttribute("aria-busy", "true");
    await expect(page.locator(".showcase__copy h1")).toBeVisible();
  } finally {
    release();
    await click;
  }
  await expect(page).toHaveURL(/\/shop$/);
  await expect(page.locator(".route-pending")).toBeEmpty();
  await expect(page.locator("#main")).toHaveAttribute("aria-busy", "false");
  await expect(page.locator("head title")).toHaveCount(1);
});

// Separately requested login presentation: no authentication bypass or logic changes.
test("branded staff login fits all four widths and keeps its accessible form", async ({
  page,
}, testInfo) => {
  await page.goto("/admin/accedi");
  await expect(page.locator(".brand-lockup--login")).toHaveAttribute(
    "aria-label",
    "Covers by Mobile Zam Zam",
  );
  await expect(page).toHaveTitle("Accesso staff | Covers by Mobile Zam Zam");
  for (const viewport of widths) {
    await page.setViewportSize(viewport);
    await expect(page.locator(".ac__language-label")).toHaveText("Lingua");
    await expect(page.locator(".brand-lockup__secondary")).toBeVisible();
    const password = page.locator('input[autocomplete="current-password"]');
    await expect(password).toBeVisible();
    // A full-width rule for the submit once squeezed the sibling password
    // input to 34px on desktop. Check both reveal labels retain typing space.
    const reveal = page.locator(".ac-password__toggle");
    for (const pressed of [true, false]) {
      await reveal.click();
      await expect(reveal).toHaveAttribute("aria-pressed", String(pressed));
      expect((await password.boundingBox())?.width ?? 0).toBeGreaterThanOrEqual(160);
    }
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth - innerWidth),
    ).toBeLessThanOrEqual(1);
    await page.screenshot({
      path: testInfo.outputPath(`storefront-admin-login-${viewport.width}.png`),
      fullPage: true,
      animations: "disabled",
    });
  }
  expect((await new AxeBuilder({ page }).include(".admin-login").analyze()).violations).toEqual([]);
});

test("merchant brand updates persist across staff and public identity surfaces", async ({
  browser,
  baseURL,
  page,
}) => {
  const staff = await browser.newContext({ baseURL: baseURL!, storageState: STORAGE_STATE });
  const editor = await staff.newPage();
  const primary = editor.locator('input[name="setting:business.brand_name"]');
  const secondary = editor.locator('input[name="setting:business.brand_secondary"]');
  await editor.goto("/admin/impostazioni");
  const original = { primary: await primary.inputValue(), secondary: await secondary.inputValue() };
  const brand = "[TEST] Mobile & Accessori";
  const identity = "Store identity";
  const full = `${brand} ${identity}`;
  const save = async (name: string, line: string) => {
    await primary.fill(name);
    await secondary.fill(line);
    await editor.getByRole("button", { name: "Salva impostazioni", exact: true }).click();
    // Wait for the settings action's result, not the router's pending status.
    await expect(editor.locator('.notice[role="status"]')).toHaveText(/^Impostazioni aggiornate/);
  };
  try {
    await save(brand, identity);
    await expect(editor.locator(".ac__brand")).toHaveAttribute("aria-label", full);
    await editor.reload();
    await expect(secondary).toHaveValue(identity);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/");
    await expect(page.locator(".brand-lockup--header")).toHaveAttribute("aria-label", full);
    await expect(page.locator(".brand-lockup--footer")).toHaveAttribute("aria-label", full);
    await expect(page).toHaveTitle(`${full} | Accessori smartphone`);
    const symbol = await page.locator(".brand-lockup--header svg").innerHTML();
    expect(await page.locator(".brand-lockup--footer svg").innerHTML()).toBe(symbol);
    expect(await editor.locator(".ac__brand svg").innerHTML()).toBe(symbol);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth - innerWidth),
    ).toBeLessThanOrEqual(1);
    await page.goto("/admin/accedi");
    await expect(page.locator(".brand-lockup--login")).toHaveAttribute("aria-label", full);
    expect(await page.locator(".brand-lockup--login svg").innerHTML()).toBe(symbol);
    await expect(page).toHaveTitle(`Accesso staff | ${full}`);
    const response = await page.reload();
    expect(await response!.text()).toContain(
      `aria-label="${brand.replace("&", "&amp;")} ${identity}"`,
    );
  } finally {
    await editor.goto("/admin/impostazioni");
    await save(original.primary, original.secondary);
    await editor.reload();
    await expect(primary).toHaveValue(original.primary);
    await expect(secondary).toHaveValue(original.secondary);
    await staff.close();
  }
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
  await expect(page.locator(".variant-picker a")).toHaveCount(3);
  await page.getByRole("link", { name: "Blu", exact: true }).click();
  await expect(page.locator(".product-page__price")).toContainText("21,90");
  await expect(page.locator('#acquista button[type="submit"]')).toBeDisabled();
  await page.goBack();
  await expect(page.locator('.variant-picker a[aria-current="true"]')).toHaveText("Trasparente");
  await page.getByRole("link", { name: "Nero opaco", exact: true }).click();
  await expect(page).toHaveURL(/variante=var_demo_cover16pro_black/);
  await expect(page.locator('.variant-picker a[aria-current="true"]')).toHaveText("Nero opaco");
  await page.reload();
  await expect(page.locator('.variant-picker a[aria-current="true"]')).toHaveText("Nero opaco");
  const variant = await page.locator('#acquista input[name="variantId"]').inputValue();
  expect(variant).toBe("var_demo_cover16pro_black");
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

test("device selection, filters and browser history keep their real URL state", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.locator("#discovery-brand").selectOption({ index: 1 });
  await page.locator("#discovery-model").selectOption({ index: 1 });
  const model = await page.locator("#discovery-model").inputValue();
  await page.locator('.discovery__form button[type="submit"]').click();
  await expect(page).toHaveURL(new RegExp(`dispositivo=${model}`));
  await expect(page.locator(".collection-head__device")).toBeVisible();
  const category = page.locator('.filter-row a[href*="categoria="]').first();
  await category.click();
  await expect(page).toHaveURL(/categoria=/);
  expect(new URL(page.url()).searchParams.get("dispositivo")).toBe(model);
  await page.goBack();
  expect(new URL(page.url()).searchParams.has("categoria")).toBe(false);
  expect(new URL(page.url()).searchParams.get("dispositivo")).toBe(model);
  await page.locator('.mobile-nav a[href="/trova-dispositivo"]').click();
  await page.locator('.finder-step a[href*="marca="]').first().click();
  await expect(page.locator(".finder-step")).toHaveCount(2);
  await page.locator('.finder-step a[href*="famiglia="]').first().click();
  await expect(page.locator(".finder-step")).toHaveCount(3);
  await page.goBack();
  await expect(page.locator(".finder-step")).toHaveCount(2);
  await page.locator('.mobile-nav a[href="#q"]').click();
  await expect(page.locator("#q")).toBeFocused();
});

test("hero entrance, intermediate states and pointer depth stay usable", async ({
  page,
}, testInfo) => {
  await page.goto("/");
  const stage = page.locator(".showcase__stage");
  // Inspect the timeline at a known midpoint rather than racing a screenshot.
  await stage.evaluate((node) => {
    for (const animation of node.getAnimations({ subtree: true })) {
      animation.pause();
      animation.currentTime = 250;
    }
  });
  await expect(page.locator(".showcase__copy h1")).toHaveCSS("opacity", "1");
  await expect(page.locator('.showcase__copy a[href="/shop"]')).toBeEnabled();
  await page.screenshot({ path: testInfo.outputPath("storefront-hero-midpoint.png") });
  const violations = await new AxeBuilder({ page }).include(".showcase").analyze();
  expect(violations.violations).toEqual([]);
  await stage.evaluate(async (node) => {
    const animations = node.getAnimations({ subtree: true });
    for (const animation of animations) {
      expectDuration(animation.effect?.getTiming().duration);
      animation.play();
    }
    function expectDuration(duration: number | CSSNumericValue | string | undefined) {
      if (typeof duration === "number" && duration > 3000)
        throw new Error("Entrance exceeds 3 seconds");
    }
    await Promise.all(animations.map((animation) => animation.finished));
  });
  const bounds = await stage.boundingBox();
  expect(bounds).not.toBeNull();
  await page.mouse.move(bounds!.x + bounds!.width * 0.8, bounds!.y + bounds!.height * 0.35);
  await expect(stage).toHaveAttribute("style", /--scene-x/);
  await page.mouse.move(0, 0);
  expect(
    await stage.evaluate((node) => (node as HTMLElement).style.getPropertyValue("--scene-x")),
  ).toBe("");
  const rendering = await page.evaluate(async () => {
    const gaps: number[] = [];
    const start = performance.now();
    let previous = start;
    await new Promise<void>((resolve) => {
      function frame(now: number) {
        gaps.push(now - previous);
        previous = now;
        if (now - start < 1500) requestAnimationFrame(frame);
        else resolve();
      }
      document.querySelector<HTMLButtonElement>(".showcase__controls button:nth-child(2)")?.click();
      requestAnimationFrame(frame);
    });
    gaps.sort((a, b) => a - b);
    return {
      frames: gaps.length,
      medianFrameGap: gaps[Math.floor(gaps.length / 2)],
      p95FrameGap: gaps[Math.floor(gaps.length * 0.95)],
      over32ms: gaps.filter((gap) => gap > 32).length,
    };
  });
  console.log("STOREFRONT_RENDER " + JSON.stringify(rendering));
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.mouse.move(bounds!.x + bounds!.width * 0.8, bounds!.y + bounds!.height * 0.35);
  expect(
    await stage.evaluate((node) => (node as HTMLElement).style.getPropertyValue("--scene-x")),
  ).toBe("");
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
  test("variant links select the exact SKU without JavaScript", async ({ page }) => {
    await page.goto("/prodotti/demo-cover-trasparente-iphone-16-pro?variante=not-a-variant");
    await expect(page.locator('#acquista input[name="variantId"]')).toHaveValue(
      "var_demo_cover16pro_clear",
    );
    await page.getByRole("link", { name: "Nero opaco", exact: true }).click();
    await expect(page.locator('#acquista input[name="variantId"]')).toHaveValue(
      "var_demo_cover16pro_black",
    );
    await page.locator('#acquista button[type="submit"]').click();
    await expect(page.locator('.cart-line input[name="variantId"]').first()).toHaveValue(
      "var_demo_cover16pro_black",
    );
  });
});

test("merchant media persists into the real gallery and native thumbnail navigation", async ({
  browser,
  page,
}) => {
  const staff = await browser.newContext({ storageState: STORAGE_STATE });
  const editor = await staff.newPage();
  try {
    await editor.goto("/admin/prodotti/prod_demo_cover16pro");
    for (let index = 1; index <= 2; index += 1) {
      await editor.setInputFiles("#image", {
        name: `test-gallery-${index}.png`,
        mimeType: "image/png",
        buffer: pngFixture(400, 400, index === 1 ? [40, 80, 160] : [160, 180, 210]),
      });
      await editor.locator("#alt").fill(`[TEST] gallery view ${index}`);
      await editor.getByRole("button", { name: /carica foto/i }).click();
      await expect(editor.locator("#sez-foto li.ac-thumb")).toHaveCount(index);
    }
    await page.goto("/prodotti/demo-cover-trasparente-iphone-16-pro");
    await expect(page.locator(".gallery__slide img")).toHaveCount(2);
    await expect(page.locator(".gallery__slide img").first()).toHaveAttribute("loading", "eager");
    await expect(page.locator(".gallery__slide img").first()).toHaveAttribute(
      "alt",
      "[TEST] gallery view 1",
    );
    await expect
      .poll(() =>
        page
          .locator(".gallery__slide img")
          .first()
          .evaluate((img) => (img as HTMLImageElement).naturalWidth),
      )
      .toBe(400);
    await page.locator('.gallery__thumb[href="#vista-2"]').click();
    await expect
      .poll(() => page.locator(".gallery__stage").evaluate((node) => node.scrollLeft))
      .toBeGreaterThan(100);
    await editor
      .locator("#sez-foto li.ac-thumb input[name='alt']")
      .first()
      .fill("[TEST] updated merchant description");
    await Promise.all([
      editor.waitForResponse(
        (response) => response.request().method() === "POST" && response.status() < 400,
      ),
      editor
        .locator("#sez-foto li.ac-thumb")
        .first()
        .getByRole("button", { name: /salva descrizione/i })
        .click(),
    ]);
    await editor.waitForLoadState("networkidle");
    await editor.reload();
    await expect(editor.locator("#sez-foto li.ac-thumb input[name='alt']").first()).toHaveValue(
      "[TEST] updated merchant description",
    );
    await page.reload();
    await expect(page.locator(".gallery__slide img").first()).toHaveAttribute(
      "alt",
      "[TEST] updated merchant description",
    );
  } finally {
    await staff.close();
  }
});

test("configured pickup checkout reaches confirmation and token-protected tracking", async ({
  page,
}, testInfo) => {
  // Only the existing throwaway Playwright database. No remote DB or live payment.
  const fixture = (sql: string) =>
    execFileSync(
      process.execPath,
      [
        "node_modules/wrangler/bin/wrangler.js",
        "d1",
        "execute",
        "ita-commerce",
        "--local",
        "--persist-to",
        ".wrangler/e2e",
        "--command",
        sql,
      ],
      { timeout: 30000, stdio: "pipe" },
    );
  fixture(
    "UPDATE store_settings SET value='true' WHERE key='pickup.enabled'; UPDATE store_settings SET value='[TEST] preparation' WHERE key='pickup.preparation_time'; UPDATE payment_methods SET active=1 WHERE id='pm_pay_at_pickup';",
  );
  try {
    await page.goto("/prodotti/demo-cover-trasparente-iphone-16-pro");
    await page.locator('#acquista button[type="submit"]').click();
    await page.locator('a[href="/cassa"]').click();
    for (const viewport of widths) {
      await page.setViewportSize(viewport);
      await expect(page.locator("#firstName")).toBeVisible();
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth - innerWidth),
      ).toBeLessThanOrEqual(1);
      await page.screenshot({
        path: testInfo.outputPath(`storefront-checkout-${viewport.width}.png`),
        fullPage: true,
        animations: "disabled",
      });
    }
    await page.locator("#firstName").fill("Demo");
    await page.locator("#lastName").fill("Checkout");
    await page.locator("#email").fill("checkout@example.invalid");
    await page.locator('input[name="deliveryMethod"][value="pickup"]').check();
    await page.locator('input[name="paymentMethodId"][value="pm_pay_at_pickup"]').check();
    await page.locator('.checkout button[type="submit"]').click();
    await expect(page).toHaveURL(/\/ordine\/.+\?t=/);
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute(
      "content",
      "noindex, nofollow",
    );
    for (const viewport of widths) {
      await page.setViewportSize(viewport);
      await page.screenshot({
        path: testInfo.outputPath(`storefront-confirmation-${viewport.width}.png`),
        fullPage: true,
        animations: "disabled",
      });
    }
    const tracking = page.locator('a[href*="/traccia/"]');
    await tracking.click();
    await expect(page).toHaveURL(/\/traccia\/[a-zA-Z0-9_-]{32}$/);
    await expect(page.locator("h1")).toHaveCount(1);
    for (const viewport of widths) {
      await page.setViewportSize(viewport);
      await page.screenshot({
        path: testInfo.outputPath(`storefront-tracking-${viewport.width}.png`),
        fullPage: true,
        animations: "disabled",
      });
    }
  } finally {
    fixture(
      "UPDATE store_settings SET value='false' WHERE key='pickup.enabled'; UPDATE store_settings SET value='' WHERE key='pickup.preparation_time'; UPDATE payment_methods SET active=0 WHERE id='pm_pay_at_pickup';",
    );
  }
});
