import { test, expect } from "@playwright/test";

import { ADMIN, STORAGE_STATE } from "./helpers/admin-session";

/**
 * The Show/Hide password control, in a real browser.
 *
 * `tests/unit/password-fields.test.ts` proves every admin password input IS the
 * shared component. This proves the component behaves — and behaviour is the
 * half that cannot be asserted from source, because it depends on how an engine
 * treats an input whose `type` changes underneath it.
 *
 * Running in all three engines is not box-ticking here. Switching between
 * `password` and `text` is exactly where they disagree: WebKit sends the caret
 * to the end, Chromium drops the selection, and a "reveal" that loses the
 * merchant's place in a long generated password is a reveal that made things
 * worse.
 *
 * ── THE CREDENTIALS ─────────────────────────────────────────────────────────
 *
 * `ADMIN` is the synthetic account this suite installs into a throwaway
 * database. No real merchant credential appears here, and none may: a password
 * typed into a test is a password in the repository, in CI output and in any
 * trace the run saves.
 */

/**
 * The signed-in session, from the setup project.
 *
 * At file level, and overridden per-describe where a test needs to be signed
 * out. Leaving it off entirely is a mistake that does not announce itself: the
 * admin screens simply redirect to the login page, the fields the tests look
 * for are absent, and a guard written to skip when a field is missing reports
 * a tidy "skipped" instead of "this never ran". That happened here once.
 */
test.use({ storageState: STORAGE_STATE });

/** Signed out: the login form only exists for someone who has no session. */
test.describe("signed out", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("starts masked and reveals only when asked", async ({ page }) => {
    await page.goto("/admin/accedi");

    const password = page.locator("#password");
    const toggle = page.getByRole("button", { name: "Mostra password" });

    // Masked before anything happens. The default is the safe one.
    await expect(password).toHaveAttribute("type", "password");
    await expect(toggle).toBeVisible();

    await password.fill("una-password-che-nessuno-deve-leggere");
    await toggle.click();

    await expect(password).toHaveAttribute("type", "text");
    // The value survives the toggle. A control that clears the field on reveal
    // is worse than no control at all.
    await expect(password).toHaveValue("una-password-che-nessuno-deve-leggere");

    // The label says what the NEXT press does, and the pressed state says what
    // the current one is.
    const hide = page.getByRole("button", { name: "Nascondi password" });
    await expect(hide).toHaveAttribute("aria-pressed", "true");
    await hide.click();
    await expect(password).toHaveAttribute("type", "password");
  });

  /**
   * The toggle is `type="button"`.
   *
   * A bare `<button>` inside a form defaults to `type="submit"`. Get this wrong
   * and pressing "Mostra password" posts the login form — with a half-typed
   * password, producing a failed sign-in and, on a form that counts them, a
   * step towards a lockout.
   */
  test("does not submit the form it sits in", async ({ page }) => {
    await page.goto("/admin/accedi");
    const url = page.url();

    await page.locator("#password").fill("mezza-password");
    await page.getByRole("button", { name: "Mostra password" }).click();

    await page.waitForTimeout(250);
    expect(page.url()).toBe(url);
    // Still on the form, still holding what was typed.
    await expect(page.locator("#password")).toHaveValue("mezza-password");
  });

  /**
   * Revealing sends NOTHING to the server.
   *
   * This is the test that matters most in the file. "Show password" is exactly
   * the feature somebody eventually implements by asking the server for the
   * stored value, and the only stored value a server could return is a hash —
   * so the version that "works" is the one that kept the plaintext. Asserting
   * zero requests means that implementation can never land quietly.
   */
  test("makes no network request when toggled", async ({ page }) => {
    await page.goto("/admin/accedi");
    await page.locator("#password").fill("segreto");

    const requests: string[] = [];
    page.on("request", (request) => requests.push(`${request.method()} ${request.url()}`));

    await page.getByRole("button", { name: "Mostra password" }).click();
    await page.getByRole("button", { name: "Nascondi password" }).click();
    await page.waitForTimeout(500);

    expect(requests).toEqual([]);
  });

  test("is operable from the keyboard alone", async ({ page }) => {
    await page.goto("/admin/accedi");

    await page.locator("#password").fill("tastiera");
    await page.keyboard.press("Tab"); // password → toggle

    const toggle = page.getByRole("button", { name: "Mostra password" });
    await expect(toggle).toBeFocused();

    await page.keyboard.press("Enter");
    await expect(page.locator("#password")).toHaveAttribute("type", "text");

    await page.keyboard.press("Space");
    await expect(page.locator("#password")).toHaveAttribute("type", "password");
  });

  /** `aria-controls` has to name the input, or the relationship is decorative. */
  test("announces which field it controls", async ({ page }) => {
    await page.goto("/admin/accedi");
    await expect(page.getByRole("button", { name: "Mostra password" })).toHaveAttribute(
      "aria-controls",
      "password",
    );
  });

  /**
   * Visibility does not survive a reload.
   *
   * If it did, it would have to be stored somewhere — and the somewhere would
   * be `localStorage`, one short step from storing the value beside it.
   */
  test("comes back masked after a reload", async ({ page }) => {
    await page.goto("/admin/accedi");
    await page.locator("#password").fill("temporanea");
    await page.getByRole("button", { name: "Mostra password" }).click();
    await expect(page.locator("#password")).toHaveAttribute("type", "text");

    await page.reload();
    await expect(page.locator("#password")).toHaveAttribute("type", "password");
    await expect(page.getByRole("button", { name: "Mostra password" })).toBeVisible();
  });

  /**
   * A revealed password re-masks when the tab goes away.
   *
   * The scenario is ordinary: reveal the password, switch to the email tab to
   * copy something, come back. In between, the plaintext is on screen for a
   * screen-share, a shoulder, or anything capturing the window.
   */
  test("re-masks when the page is hidden", async ({ page }) => {
    await page.goto("/admin/accedi");
    await page.locator("#password").fill("visibile-per-ora");
    await page.getByRole("button", { name: "Mostra password" }).click();
    await expect(page.locator("#password")).toHaveAttribute("type", "text");

    // Driving the event directly: a headless browser has no other tab to switch
    // to, and this is the event a real switch fires.
    await page.evaluate(() => {
      Object.defineProperty(document, "visibilityState", {
        value: "hidden",
        configurable: true,
      });
      document.dispatchEvent(new Event("visibilitychange"));
    });

    await expect(page.locator("#password")).toHaveAttribute("type", "password");
    // And the value is still there — re-masking hides it, it does not discard it.
    await expect(page.locator("#password")).toHaveValue("visibile-per-ora");
  });

  /**
   * A rejected sign-in re-renders the form. It must come back masked.
   *
   * The failure path is the one where a reveal is most tempting to leave on —
   * and the one where the person is most likely to walk away from the screen.
   */
  test("does not reveal by default after a failed sign-in", async ({ page }) => {
    await page.goto("/admin/accedi");

    await page.fill('input[name="email"]', "nessuno@example.invalid");
    await page.locator("#password").fill("password-sbagliata-ma-lunga");
    await page.getByRole("button", { name: "Mostra password" }).click();
    await expect(page.locator("#password")).toHaveAttribute("type", "text");

    await page.getByRole("button", { name: "Accedi" }).click();
    await expect(page.getByRole("alert")).toBeVisible();

    await expect(page.locator("#password")).toHaveAttribute("type", "password");
  });

  /*
   * ── WHERE THE "EACH FIELD TOGGLES INDEPENDENTLY" CHECK LIVES ──────────────
   *
   * Not here: in `installShop`, in helpers/admin-session.ts.
   *
   * It needs a screen with two password fields on it at once, and the only one
   * in the application is first-run setup — which closes itself permanently as
   * soon as it is used. A test here would find a 404 on every run after the
   * first and skip, and a skipped test in a summary reads as a verified one.
   * So the assertion sits in the flow that genuinely has the form open.
   */
});

/**
 * Signed in: the step-up confirmations.
 *
 * These are the fields the brief cares most about, because they gate money and
 * second factors. They are the signed-in user confirming their OWN password —
 * never a stored value being displayed.
 */
test.describe("signed in", () => {
  /*
   * WebKit does not treat `http://127.0.0.1` as a trustworthy origin, so it
   * discards the `__Host-ita` session cookie the setup project received and no
   * session reaches these screens. Skipping with the reason stated, rather than
   * letting the redirect to the login page look like a pass. The explanation in
   * full is in playwright.config.ts.
   */
  test.skip(
    ({ browserName }) => browserName === "webkit",
    "WebKit drops the __Host- cookie over plain http; the admin is never served that way",
  );

  test("the payment step-up password can be revealed", async ({ page }) => {
    await page.goto("/admin/pagamenti");

    // The precondition is ASSERTED, not guarded. A redirect to the login page
    // means the session never loaded, and that is a broken test rather than an
    // absent feature.
    await expect(page).toHaveURL(/\/admin\/pagamenti/);

    const password = page.locator("#stepup-password");
    await expect(password).toBeVisible();
    await expect(password).toHaveAttribute("type", "password");
    await expect(password).toHaveAttribute("autocomplete", "current-password");

    await password.fill(ADMIN.password);
    await page.getByRole("button", { name: "Mostra password" }).first().click();
    await expect(password).toHaveAttribute("type", "text");
    await expect(password).toHaveValue(ADMIN.password);
  });

  /**
   * The bank details are NOT password fields and must not gain a reveal.
   *
   * The settings screen stores an encrypted account identifier and renders only
   * a masked form of it. The risk the brief names is precise: a generic
   * Show/Hide gets applied to "anything that looks secret", and a saved IBAN
   * becomes readable by any staff member who can open the page. This asserts
   * that did not happen.
   */
  test("does not offer to reveal the stored payment identifier", async ({ page }) => {
    await page.goto("/admin/impostazioni");
    await expect(page).toHaveURL(/\/admin\/impostazioni/);

    // Whatever this field is, it is not wired to a reveal control.
    const controls = await page
      .getByRole("button", { name: /Mostra password/ })
      .evaluateAll((buttons) => buttons.map((b) => b.getAttribute("aria-controls")));

    expect(controls).not.toContain("accountIdentifier");
  });
});
