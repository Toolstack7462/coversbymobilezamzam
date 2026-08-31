import { test, expect } from "@playwright/test";

/**
 * The no-JavaScript claim, actually tested.
 *
 * The admin shell and the data table are documented as working before any
 * script loads: the sidebar collapse is a checkbox, the mobile drawer is a
 * `<details>`, search is a GET form, sorting and pagination are links. Those
 * are claims in a comment until something proves them, and the failure mode is
 * quiet — everything works perfectly on the developer's machine, where the
 * bundle always arrives.
 *
 * The customer this matters for is not a purist. It is a shop assistant in a
 * stockroom on one bar of signal, and a customer on a train through the
 * Apennines. Both get HTML long before they get a hydrated bundle.
 *
 * These run with JavaScript disabled at the browser level, so nothing can
 * quietly rescue the page.
 */

test.use({ javaScriptEnabled: false });

test.describe("the storefront without JavaScript", () => {
  test("renders the homepage with real content, not a loading state", async ({ page }) => {
    await page.goto("/");

    // SSR means the first response carries content. If this fails, the page is
    // shipping an empty shell and filling it in from the client.
    await expect(page.locator("main")).not.toBeEmpty();
    await expect(page.locator("h1").first()).toBeVisible();
  });

  test("navigates between pages by link", async ({ page }) => {
    await page.goto("/");
    const shopLink = page.locator('a[href$="/shop"]').first();
    if ((await shopLink.count()) > 0) {
      await shopLink.click();
      await expect(page).toHaveURL(/\/shop/);
      await expect(page.locator("main")).not.toBeEmpty();
    }
  });

  test("search is a GET form, so its result is a shareable URL", async ({ page }) => {
    await page.goto("/shop");
    const form = page.locator('form[role="search"], form[method="get"]').first();
    if ((await form.count()) === 0) test.skip(true, "no search form on this page yet");

    // method="get" is what makes the result addressable. A POST search returns
    // a page nobody can bookmark, link, or reload.
    await expect(form).toHaveAttribute("method", /get/i);
  });
});

test.describe("the admin shell without JavaScript", () => {
  test("the login page renders and its form is submittable", async ({ page }) => {
    await page.goto("/admin/accedi");

    await expect(page.locator("form").first()).toBeVisible();
    await expect(page.locator('input[type="password"]')).toBeVisible();

    // A submit button, not a div with a click handler — the difference between
    // a form that works here and one that does nothing.
    const submit = page.locator('button[type="submit"], input[type="submit"]').first();
    await expect(submit).toBeVisible();
  });

  test("an unauthenticated admin page redirects rather than rendering blank", async ({ page }) => {
    // The guard must be server-side. If /admin only redirects once client code
    // runs, then with JS off it either renders the shell or hangs — and either
    // one would mean the access control is in the wrong place entirely.
    const response = await page.goto("/admin");
    expect(response?.status()).toBeLessThan(400);
    expect(page.url()).toContain("/admin/accedi");
  });
});

test.describe("progressive enhancement is a floor, not a fallback", () => {
  test("no page depends on a <noscript> apology", async ({ page }) => {
    // A <noscript> block saying "please enable JavaScript" is the admission
    // that the page does not work. Finding one means the claim above is false.
    for (const path of ["/", "/shop", "/admin/accedi"]) {
      await page.goto(path);
      const apologies = await page
        .locator("noscript")
        .filter({ hasText: /javascript/i })
        .count();
      expect(apologies, `${path} apologises for JavaScript being off`).toBe(0);
    }
  });
});
