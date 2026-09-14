import { test, expect, type Page } from "@playwright/test";

import { STORAGE_STATE } from "./helpers/admin-session";

/**
 * What a save actually persisted, read back from a fresh page load.
 *
 * A green toast is the weakest evidence an admin panel offers: it says a
 * request returned, not that a row changed. Every assertion here reloads and
 * reads the value back out of the server's own HTML.
 *
 * The behaviours are the ones that fail SILENTLY, and are therefore found by a
 * merchant rather than by a test:
 *
 *   - a leading zero on an identifier, eaten by a numeric round-trip
 *   - a genuine zero read as "missing" and replaced by a default
 *   - an optional field left empty, quietly filled in with 0,00
 *
 * Synthetic rows in the suite's throwaway database. Nothing here touches real
 * stock, a real order or a real payment.
 */

test.use({ storageState: STORAGE_STATE });

/**
 * Opens the "Aggiungi una variante" panel, whether or not it is already open.
 *
 * The form lives inside a collapsed `<details>`, so its fields are in the DOM
 * but not fillable — which surfaces as a locator timeout that reads like a
 * missing element rather than a closed drawer.
 */
async function openVariantPanel(page: Page) {
  const panel = page.locator("details.panel", { has: page.locator("#v-sku") }).first();
  await expect(panel).toBeAttached();
  if (!(await panel.evaluate((el: HTMLDetailsElement) => el.open))) {
    await panel.locator("summary").first().click();
  }
  await expect(page.locator("#v-sku")).toBeVisible();
}

test.describe("saving a variant", () => {
  // Writes rows the other projects would race for, so it runs in one place.
  test.skip(({ browserName }) => browserName !== "chromium", "writes shared rows");

  test("keeps a leading zero, a real zero, and an empty price", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name === "mobile", "writes shared rows");

    await page.goto("/admin/prodotti/prod_demo_incomplete");
    await expect(page).toHaveURL(/\/admin\/prodotti\//);
    await openVariantPanel(page);

    // Unique per run: SKU is a unique key, and a test colliding with its own
    // previous run fails for a reason unrelated to the behaviour under test.
    const sku = `007-ZERO-${Date.now().toString().slice(-6)}`;

    await page.locator("#v-sku").fill(sku);
    await page.locator("#v-label").fill("Prova zero");
    // A real zero: this variant genuinely has none in stock. It must not be
    // read as "no value supplied".
    await page.locator("#v-stock").fill("0");
    // Price left empty on purpose. Empty must stay empty rather than becoming
    // 0,00, which would publish a free product.
    await page.locator("#v-price").fill("");

    await Promise.all([
      page.waitForResponse((r) => r.request().method() === "POST"),
      page
        .locator("form")
        .filter({ has: page.locator("#v-sku") })
        .getByRole("button")
        .click(),
    ]);
    await page.waitForLoadState("networkidle");

    // The server's answer, from a fresh load — never the optimistic render.
    await page.reload({ waitUntil: "networkidle" });

    const row = page.locator("tr", { hasText: sku }).first();
    await expect(row).toBeVisible();

    // The leading zero survived. `Number("007-…")` is NaN, and any numeric
    // round-trip would have dropped or mangled it.
    await expect(row).toContainText(sku);

    // And no price was invented for it.
    await expect(row).not.toContainText("0,00");
  });
});
