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

  test("an adjustment demands a reason, and the reason reaches the ledger", async ({
    page,
  }, testInfo) => {
    await page.goto("/admin/inventario");

    /*
     * Scoped to ONE disclosure, on ONE named row, chosen by PROJECT.
     *
     * Two things went wrong here in turn and both are worth keeping written
     * down, because the symptom of each was "the movement never appeared".
     *
     *   1. `.first()` and `.last()` taken across the PAGE pick controls from
     *      different rows, so the phone layout filled one product's quantity
     *      and pressed another product's save button.
     *   2. Scoping to the first row fixed that and left a worse one: the
     *      desktop and mobile projects share one server and one database, so
     *      both copies of this test adjusted the SAME row at the same moment
     *      and one of the two submissions was lost.
     *
     * A stable SKU per project fixes both. It also means the test says which
     * row it is about instead of "whichever sorts first", which is a property
     * that changes whenever the catalogue does.
     */
    const sku = testInfo.project.name === "mobile" ? "DEMO-CAB-100W-2M" : "DEMO-COV-16P-BLU";
    const row = page.locator("tr", { hasText: sku });
    const panel = row.locator("details", {
      has: page.locator("summary", { hasText: "Rettifica" }),
    });
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

    /*
     * Wait for the WRITE, not for the network to go quiet.
     *
     * `waitForLoadState("networkidle")` returns when nothing is in flight,
     * which is also true when the submission never left. Under two projects
     * sharing one server that is a real timing window, and the failure it
     * produced pointed at the movements page — a missing row — rather than at
     * the save that never happened.
     */
    await Promise.all([
      page.waitForResponse(
        (response) => response.request().method() === "POST" && response.status() < 400,
      ),
      panel.getByRole("button").click(),
    ]);
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

/**
 * Opens one variant's specification panel, whether or not it is already open.
 *
 * A `<details>` survives a React Router form submission — the DOM is patched,
 * not replaced — so a blind `summary.click()` after a save CLOSES the panel
 * that was already open, and every assertion after it fails on an element that
 * is present and hidden. Ask, then act.
 */
async function openSpecs(page: Page, sku: string) {
  const block = page.locator(`details[data-variant='${sku}']`);
  await expect(block).toBeVisible();
  if (!(await block.evaluate((el: HTMLDetailsElement) => el.open))) {
    await block.locator("summary").click();
  }
  await expect(block).toHaveAttribute("open", "");
  return block;
}

test.describe("product-type templates", () => {
  /**
   * The example the brief names: a charger's wattage must not be asked of a
   * phone case.
   *
   * Six specification columns have existed on `product_variants` since the
   * first migration and the editor surfaced none of them, so this is not a
   * test that a field moved — it is a test that the fields exist at all, and
   * that the set of them changes with the kind of product.
   *
   * ── WHY THESE READ RATHER THAN SET THE TYPE ──────────────────────────────
   *
   * The demo catalogue seeds `accessory_type`, so these open a product whose
   * type is already right and assert what it asks for. Setting it here would
   * mean saving Dettagli on a product the concurrent-edit test also saves, and
   * two tests writing one row is a conflict — which the conflict guard would
   * correctly report, and which would look like a broken feature. The
   * type-CHANGES-the-fields path is exercised further down on a product
   * nothing else touches.
   */
  /*
   * The two projects share one `wrangler dev` and one database, so the desktop
   * and mobile copies of a WRITING test run against the same rows at the same
   * moment. That is not a bug being found, it is two tests fighting, and it
   * makes the failure look like the feature.
   *
   * Reading tests stay on both viewports — layout is exactly what mobile is
   * for. The ones that save run on desktop only.
   */
  test("asks a cable for its length and connectors, never for a battery", async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name === "mobile", "writes shared rows; see the note above");
    await page.goto("/admin/cerca?q=DEMO-CAB-100W-1M");
    await page
      .getByRole("link", { name: /cavo usb-c/i })
      .first()
      .click();
    await page.waitForURL(/\/admin\/prodotti\/[^/]+$/);

    const specs = await openSpecs(page, "DEMO-CAB-100W-1M");

    await expect(specs.getByLabel(/Lunghezza/)).toBeVisible();
    await expect(specs.getByLabel(/Connettori/)).toBeVisible();
    // The point of the whole feature.
    await expect(specs.getByLabel(/Capacità/)).toHaveCount(0);

    await specs.getByLabel(/Lunghezza/).fill("1000");
    await specs.getByLabel(/Connettori/).fill("USB-C a USB-C");
    await specs.getByRole("button", { name: /salva specifiche/i }).click();
    await page.waitForLoadState("networkidle");

    // The server's answer, not the optimistic one.
    const saved = await reloadAnd(page, async () => {
      const block = await openSpecs(page, "DEMO-CAB-100W-1M");
      return {
        length: await block.getByLabel(/Lunghezza/).inputValue(),
        connector: await block.getByLabel(/Connettori/).inputValue(),
      };
    });

    expect(saved.length).toBe("1000");
    expect(saved.connector).toBe("USB-C a USB-C");
  });

  test("a phone case is never asked for a battery capacity", async ({ page }) => {
    await page.goto("/admin/cerca?q=DEMO-COV-16P-CLR");
    await page
      .getByRole("link", { name: /cover trasparente/i })
      .first()
      .click();
    await page.waitForURL(/\/admin\/prodotti\/[^/]+$/);

    const specs = await openSpecs(page, "DEMO-COV-16P-CLR");

    await expect(specs.getByLabel(/Dimensioni/)).toBeVisible();
    await expect(specs.getByLabel(/Capacità/)).toHaveCount(0);
    await expect(specs.getByLabel(/Lunghezza/)).toHaveCount(0);
  });

  test("choosing a type changes which fields are asked for", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name === "mobile", "writes shared rows; see the note above");
    /*
     * On the deliberately incomplete draft — the one product no other test in
     * this file writes to. It is seeded with NO type, so it also covers the
     * state a merchant sees before they have chosen one.
     */
    await page.goto("/admin/prodotti/prod_demo_incomplete");

    // No type: no fields, and a sentence saying what to do about it rather
    // than an empty section.
    await expect(page.getByText(/scegliete il/i)).toBeVisible();
    await expect(page.locator("details[data-variant='DEMO-SUP-MAG-01']")).toHaveCount(0);

    await page.selectOption("#accessoryType", "powerbank");
    await page.getByRole("button", { name: /salva dettagli/i }).click();
    await page.waitForLoadState("networkidle");
    await expect(page.getByText(/Salvato alle/)).toBeVisible();

    const asPowerbank = await openSpecs(page, "DEMO-SUP-MAG-01");
    await expect(asPowerbank.getByLabel(/Capacità/)).toBeVisible();

    // Change the type: the fields change with it.
    await page.selectOption("#accessoryType", "car_mount");
    await page.getByRole("button", { name: /salva dettagli/i }).click();
    await page.waitForLoadState("networkidle");

    const asMount = await openSpecs(page, "DEMO-SUP-MAG-01");
    await expect(asMount.getByLabel(/Peso/)).toBeVisible();
    await expect(asMount.getByLabel(/Capacità/)).toHaveCount(0);
  });
});

test.describe("duplicating a product", () => {
  /**
   * "The same case in a second colour" was a full re-entry of everything,
   * including the device compatibility that takes longest to type.
   *
   * The assertions below are as much about what a copy must NOT inherit as
   * about what it does: a duplicate that arrives published, or claiming stock
   * on a shelf, is worse than no duplicate button.
   */
  test("creates a draft copy with the compatibility and none of the stock", async ({
    page,
  }, testInfo) => {
    // Desktop only: two concurrent duplicates of one product would race for
    // the same `-C` suffix. That race is real and it fails safely — the batch
    // rolls back — but reproducing it here proves nothing about the feature.
    test.skip(testInfo.project.name === "mobile", "writes shared rows");
    await page.goto("/admin/cerca?q=DEMO-CHG-25W-WHT");
    await page
      .getByRole("link", { name: /caricatore/i })
      .first()
      .click();
    await page.waitForURL(/\/admin\/prodotti\/[^/]+$/);
    const original = page.url();

    /*
     * Wait for a row before counting.
     *
     * `locator.count()` does NOT auto-wait: it answers about the DOM at that
     * instant, and `waitForURL` resolves on navigation rather than on render.
     * Counting straight after it reads zero from a page that is about to have
     * two rows, and the failure then looks like missing data instead of a race.
     */
    const compatibilityRows = page.locator("#sez-compatibilita li.ac-action");
    await expect(compatibilityRows.first()).toBeVisible();
    const compatibilityBefore = await compatibilityRows.count();
    expect(compatibilityBefore).toBeGreaterThan(0);

    await page.getByRole("button", { name: /duplica prodotto/i }).click();
    await page.waitForURL(/\/admin\/prodotti\/[^/]+\?duplicato=1$/);

    // A different product, not a re-render of the same one.
    expect(page.url()).not.toBe(original);

    await expect(page.getByRole("status").first()).toContainText(/copia creata/i);
    await expect(page.locator("h1")).toContainText(/\(copia\)/i);

    // Draft. Never live.
    await expect(page.getByText(/bozza/i).first()).toBeVisible();

    // The compatibility came across — the expensive part.
    await expect(page.locator("#sez-compatibilita li.ac-action")).toHaveCount(compatibilityBefore);

    // The stock did not.
    const stockCells = page.locator("#sez-varianti td[data-label='Disponibile']");
    for (let i = 0; i < (await stockCells.count()); i += 1) {
      await expect(stockCells.nth(i)).toHaveText(/^0$/);
    }

    // And the SKU is recognisably a copy, so a person holding the box can tell.
    await expect(page.locator("#sez-varianti")).toContainText("DEMO-CHG-25W-WHT-C");

    // The original is untouched.
    await page.goto(original, { waitUntil: "networkidle" });
    await expect(page.locator("h1")).not.toContainText(/\(copia\)/i);
    await expect(page.locator("#sez-varianti")).toContainText("DEMO-CHG-25W-WHT");
  });
});
