import { test, expect, type Page } from "@playwright/test";
import { STORAGE_STATE } from "./helpers/admin-session";

/**
 * The tasks a merchant actually performs, end to end, through the real UI.
 *
 * ── WHAT MAKES THESE DIFFERENT FROM THE VISUAL SURVEY ───────────────────────
 *
 * The survey proves a screen renders. These prove a screen WORKS: every one
 * ends by reloading the page and reading the value back, because the only
 * evidence that a save happened is the server serving it again. A success
 * banner is a claim; the row after a reload is the fact.
 *
 * ── WHAT THEY DO NOT DO ─────────────────────────────────────────────────────
 *
 * They never bypass authentication or grant themselves a permission. The
 * session comes from the real install-and-sign-in flow in auth.setup.ts, and
 * the forbidden-action test relies on the SERVER refusing, not on a hidden
 * button.
 *
 * They run against the throwaway browser database seeded with the `[DEMO]`
 * catalogue and four unpaid orders. Nothing here touches real inventory.
 */

test.use({ storageState: STORAGE_STATE });

/** Reload and re-read: the server's answer, not the optimistic one. */
async function reloadAnd<T>(page: Page, read: () => Promise<T>): Promise<T> {
  await page.reload({ waitUntil: "networkidle" });
  return read();
}

test.describe("global search", () => {
  test("finds an order by its number from anywhere in the admin", async ({ page }) => {
    // Starting somewhere unrelated is the point: the merchant does not have to
    // know which screen owns the thing they are looking for.
    await page.goto("/admin/impostazioni");

    const box = page.locator("#ac-topbar-q");
    if (await box.isVisible()) {
      await box.fill("DEMO-0003");
      await box.press("Enter");
    } else {
      // Narrow viewport: the top-bar box is hidden, so go by URL as the
      // merchant would from the menu.
      await page.goto("/admin/cerca?q=DEMO-0003");
    }

    await expect(page.locator("h1")).toContainText(/cerca/i);
    await expect(page.getByRole("link", { name: /DEMO-0003/ })).toBeVisible();
  });

  test("finds a product by SKU", async ({ page }) => {
    await page.goto("/admin/cerca?q=DEMO-PWR-5000-BLK");
    await expect(page.getByText(/Power bank/i).first()).toBeVisible();
  });

  test("says so plainly when there is nothing", async ({ page }) => {
    await page.goto("/admin/cerca?q=zzzznessuncorrispondenza");
    await expect(page.getByText(/Nessun risultato/i)).toBeVisible();
  });

  test("does not fall over on a hostile query", async ({ page }) => {
    // A quotation mark, a percent sign and an underscore are all SQL LIKE or
    // FTS syntax somewhere in this system. None of them may reach a query.
    const response = await page.goto(`/admin/cerca?q=${encodeURIComponent("100%_'\" OR 1=1")}`);
    expect(response?.status()).toBe(200);
    await expect(page.locator("h1")).toContainText(/cerca/i);
  });
});

test.describe("the order workspace", () => {
  test("shows the order, its items and its money", async ({ page }) => {
    await page.goto("/admin/ordini");
    await page.getByRole("link", { name: "DEMO-0002" }).click();

    await expect(page.locator("h1")).toContainText("DEMO-0002");
    // Two lines: 2 × 12,90 plus 1 × 15,90 = 41,70.
    await expect(page.getByText("41,70 €").first()).toBeVisible();
    await expect(page.getByText(/Cavo USB-C/).first()).toBeVisible();
  });

  test("puts the customer beside the order, not below the history", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name === "mobile", "one column on a phone, by design");

    await page.goto("/admin/ordini");
    await page.getByRole("link", { name: "DEMO-0002" }).click();

    /*
     * The measurable version of "the phone number is not below the fold".
     *
     * On a wide screen the customer panel must sit to the RIGHT of the items
     * panel, not beneath it. Comparing the boxes is what makes that a fact
     * rather than an impression.
     */
    const items = page.locator(".ac-workspace__main").first();
    const customer = page.locator(".ac-workspace__side").nth(1);

    const itemsBox = await items.boundingBox();
    const customerBox = await customer.boundingBox();

    expect(itemsBox).not.toBeNull();
    expect(customerBox).not.toBeNull();
    expect(customerBox!.x).toBeGreaterThan(itemsBox!.x);
  });

  test("offers only legal next states, and never `paid`", async ({ page }) => {
    await page.goto("/admin/ordini");

    const select = page.locator("select[name='status']").first();
    if ((await select.count()) === 0) test.skip(true, "no writable order in this view");

    const options = await select.locator("option").allTextContents();
    expect(options.length).toBeGreaterThan(0);

    /*
     * `paid` is set by payment verification alone (invariant 6). A status
     * dropdown that offers it is a way to mark money received without anyone
     * checking a bank account.
     */
    expect(options.join("|").toLowerCase()).not.toContain("pagato");
  });

  test("a status change survives a reload", async ({ page }) => {
    await page.goto("/admin/ordini?vista=da-contattare");

    const row = page.getByRole("link", { name: "DEMO-0001" });
    if ((await row.count()) === 0) test.skip(true, "order already moved on by another run");

    const select = page.locator("select[name='status']").first();
    await select.selectOption({ index: 0 });
    const chosen = await select.inputValue();
    await page.getByRole("button", { name: "Applica" }).first().click();
    await page.waitForLoadState("networkidle");

    // The order left the "to contact" view because its status actually changed.
    const stillThere = await reloadAnd(page, async () =>
      page.getByRole("link", { name: "DEMO-0001" }).count(),
    );
    expect(chosen).not.toBe("");
    expect(stillThere).toBe(0);
  });
});

test.describe("inventory", () => {
  test("shows stock in Italian, never a raw database value", async ({ page }) => {
    await page.goto("/admin/inventario");

    // The defect this replaced: `out_of_stock` printed to an Italian merchant.
    const body = (await page.locator("main").textContent()) ?? "";
    expect(body).not.toMatch(/\b(in_stock|low_stock|out_of_stock|not_tracked|backorder)\b/);
    await expect(page.getByText(/Esaurito|In esaurimento|Disponibile/).first()).toBeVisible();
  });

  test("reserved stock is shown and is not editable", async ({ page }) => {
    await page.goto("/admin/inventario");

    await expect(page.getByRole("columnheader", { name: /prenotato/i })).toBeVisible();

    /*
     * Reserved is derived from live orders. An editable field here would let a
     * merchant "correct" a figure that the reservation ledger owns, and the two
     * would then disagree with no way to tell which was right.
     */
    const reservedInputs = page.locator("td input[name*='reserved' i]");
    expect(await reservedInputs.count()).toBe(0);
  });

  test("an adjustment demands a reason, and the reason reaches the ledger", async ({ page }) => {
    await page.goto("/admin/inventario");

    /*
     * Scoped to ONE disclosure, not to the page.
     *
     * Every row has its own adjustment form, so `.first()` and `.last()` across
     * the page pick controls from different rows — which on the phone layout
     * meant filling one product's quantity and pressing another product's save
     * button, and the movement then never appeared under the note this test was
     * looking for.
     */
    const panel = page
      .locator("details", { has: page.locator("summary", { hasText: "Rettifica" }) })
      .first();
    if ((await panel.count()) === 0) test.skip(true, "this actor cannot adjust stock");

    await panel.locator("summary").click();

    const onHand = panel.locator("[name='onHand']");
    const note = panel.locator("[name='reasonNote']");
    await expect(onHand).toBeVisible();

    /*
     * The note is `required`, so the browser refuses an empty submission before
     * anything reaches the server. That is the point of the field: a stock
     * figure that changed for no recorded reason is one nobody can reconcile
     * against a shelf later.
     */
    await expect(note).toHaveAttribute("required", "");

    const current = Number(await onHand.inputValue());
    const marker = `Test automatico ${Date.now()}`;
    await onHand.fill(String(current + 2));
    await note.fill(marker);
    await panel.getByRole("button").click();
    await page.waitForLoadState("networkidle");

    // The movement is recorded, which is what makes an adjustment auditable.
    await page.goto("/admin/inventario/movimenti");
    await expect(page.getByText(marker).first()).toBeVisible();
  });
});

test.describe("the product list can be scanned", () => {
  test("shows SKU and stock without opening a row", async ({ page }, testInfo) => {
    await page.goto("/admin/prodotti");

    /*
     * The DATA, not the chrome.
     *
     * On a phone the table becomes cards and the header row is visually hidden
     * — deliberately, because it stays in the accessibility tree and is what
     * makes each cell mean something. Asserting the header is VISIBLE therefore
     * failed at mobile width while the screen was working correctly.
     *
     * What the merchant needs is the SKU and the stock figure on the row. That
     * is true at every width, so it is what this checks.
     */
    await expect(page.getByText("DEMO-PWR-5000-BLK").first()).toBeVisible();

    /*
     * The stock column shows AVAILABLE, not on-hand.
     *
     * The fixture puts 7 power banks in the shop and one demo order reserves
     * one of them, so the correct figure here is 6. Asserting 7 was asserting
     * the number before anybody ordered anything — and the fact that this test
     * caught the difference is the column doing its job: a merchant looking at
     * "7" would promise a customer a unit that is already spoken for.
     */
    const stockCell = page
      .locator("tr", { hasText: "Power bank" })
      .first()
      .locator("td[data-label='Scorte']");
    await expect(stockCell).toContainText("6");

    /*
     * The column headers exist as headers only where the layout is a table.
     *
     * Below 48rem the cards apply `display: block` to the table elements, which
     * removes the table's implicit ARIA roles entirely — so `columnheader` does
     * not resolve, and that is the CSS working as designed rather than a
     * missing header. Each cell carries its label through `data-label` instead.
     */
    if (testInfo.project.name !== "mobile") {
      await expect(page.getByRole("columnheader", { name: "SKU" })).toBeVisible();
      await expect(page.getByRole("columnheader", { name: /scorte/i })).toBeVisible();
    }
  });

  test("a search keeps its state in the URL, so the result is shareable", async ({ page }) => {
    await page.goto("/admin/prodotti");
    await page.getByPlaceholder(/cerca per nome/i).fill("power bank");
    await page.getByRole("button", { name: "Cerca" }).click();
    await page.waitForLoadState("networkidle");

    expect(page.url()).toContain("q=");

    // And the back button returns to the unfiltered list rather than to a
    // page that no longer exists.
    await page.goBack();
    await page.waitForLoadState("networkidle");
    await expect(page.getByText(/Caricatore|Cavo|Cover/).first()).toBeVisible();
  });
});

test.describe("the product editor", () => {
  test("jumps straight to a section without scrolling past the rest", async ({ page }) => {
    await page.goto("/admin/prodotti");
    await page.getByRole("link", { name: /Power bank/ }).click();

    const nav = page.getByRole("navigation", { name: /sezioni del prodotto/i });
    await expect(nav).toBeVisible();

    await nav.getByRole("link", { name: /compatibilit/i }).click();
    await expect(page).toHaveURL(/#sez-compatibilita$/);
    await expect(page.locator("#sez-compatibilita")).toBeVisible();
  });

  test("refuses to publish a product with no price, and says why", async ({ page }) => {
    // A product with no price renders a live page nobody can buy from.
    await page.goto("/admin/prodotti?vista=senza-prezzo");

    const first = page.locator("tbody tr a").first();
    await expect(first).toBeVisible();

    await first.click();
    await page.waitForURL(/\/admin\/prodotti\/[^/]+$/);

    const publish = page.getByRole("button", { name: /pubblica sul sito/i });
    await expect(publish).toBeVisible();

    await publish.click();
    await page.waitForLoadState("networkidle");
    await expect(page.getByRole("alert")).toContainText(/senza prezzo/i);

    // And it is still a draft: the refusal refused.
    await page.reload({ waitUntil: "networkidle" });
    await expect(page.getByRole("button", { name: /pubblica sul sito/i })).toBeVisible();
  });

  test("a saved detail survives a reload", async ({ page }) => {
    await page.goto("/admin/prodotti");
    await page.getByRole("link", { name: /Caricatore/ }).click();
    // Same race the conflict test hit: without this the assertions below run
    // against the LIST, and the guard skips a test that should have run.
    await page.waitForURL(/\/admin\/prodotti\/[^/]+$/);

    const field = page.locator("#shortDescription");
    await expect(field).toBeVisible();

    const value = `Descrizione di prova ${Date.now()}`;
    await field.fill(value);
    await page.getByRole("button", { name: /salva dettagli/i }).click();
    await page.waitForLoadState("networkidle");

    // The server said so, and the server says so again after a reload.
    await expect(page.getByText(/Salvato alle/)).toBeVisible();
    await page.reload({ waitUntil: "networkidle" });
    await expect(page.locator("#shortDescription")).toHaveValue(value);
  });

  /*
   * Two sessions, one product. The second save must be REFUSED, not merged and
   * not silently applied over the first.
   *
   * Simulated by editing the same form in two browser contexts, which is what
   * two people at two counters actually are.
   */
  test("refuses a save from a form that was open while somebody else saved", async ({
    browser,
  }) => {
    /*
     * Longer than the default.
     *
     * Two browser contexts, four navigations and two round-trips through a
     * single-worker `wrangler dev`. It timed out at thirty seconds and the
     * timeout surfaced as "locator.fill: Test ended", which reads like a
     * missing element rather than a slow one.
     */
    test.setTimeout(120_000);

    const first = await browser.newContext({ storageState: STORAGE_STATE });
    const second = await browser.newContext({ storageState: STORAGE_STATE });

    try {
      const a = await first.newPage();
      const b = await second.newPage();

      await a.goto("/admin/prodotti");
      await a.getByRole("link", { name: /Cavo USB-C/ }).click();

      /*
       * Wait for the navigation before reading the URL.
       *
       * Without this, `a.url()` was still the list page, `b` opened the list,
       * and the failure surfaced as "locator.fill: Test ended" waiting for a
       * field that only exists on the editor — which reads like a slow page
       * rather than the wrong one.
       */
      await a.waitForURL(/\/admin\/prodotti\/[^/]+$/);
      await expect(a.locator("#shortDescription")).toBeVisible();
      const url = a.url();

      // Both have the product open, loaded from the same version.
      await b.goto(url, { waitUntil: "networkidle" });
      await expect(b.locator("#shortDescription")).toBeVisible();

      // A saves first, and wins.
      await a.locator("#shortDescription").fill("Modifica della prima sessione");
      await a.getByRole("button", { name: /salva dettagli/i }).click();
      await a.waitForLoadState("networkidle");
      await expect(a.getByText(/Salvato alle/)).toBeVisible();

      // B now saves a form that was rendered from the older version.
      await b.locator("#shortDescription").fill("Modifica della seconda sessione");
      await b.getByRole("button", { name: /salva dettagli/i }).click();
      await b.waitForLoadState("networkidle");

      await expect(b.getByRole("alert")).toContainText(/qualcun altro ha salvato/i);

      /*
       * And — the part that matters — A's work is still there.
       *
       * A conflict message that appeared while the write went through anyway
       * would be worse than no message at all.
       */
      await a.reload({ waitUntil: "networkidle" });
      await expect(a.locator("#shortDescription")).toHaveValue("Modifica della prima sessione");
    } finally {
      // Tolerant cleanup. A context that has already gone throws here, and that
      // exception then MASKS whichever assertion actually failed — which is how
      // a real failure reads as "browser has been closed" and tells you nothing.
      await first.close().catch(() => {});
      await second.close().catch(() => {});
    }
  });
});
