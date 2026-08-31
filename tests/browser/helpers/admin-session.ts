import type { Page } from "@playwright/test";
import { stableTotp, freshTotp } from "../../helpers/totp";

/**
 * Signs a browser into the admin, through the real first-run flow.
 *
 * Nothing here bypasses anything. The test installs the shop, logs in, and
 * enrols in two-factor exactly as a merchant does on day one — so a break
 * anywhere along that path fails a test rather than waiting to be discovered by
 * the person it happens to.
 *
 * That is the whole reason `tests/helpers/totp.ts` exists. The alternative was
 * to add a test-only escape hatch to the two-factor gate, which would mean the
 * browser tests no longer exercise the thing that actually ships.
 */

export const ADMIN = {
  email: "titolare@example.invalid",
  password: "una-password-lunga-e-non-ovvia-2026",
  name: "Titolare",
  /** Matches INITIAL_ADMIN_SETUP_TOKEN in `.dev.vars` for the test server. */
  setupToken: "test-setup-token-che-non-e-un-segreto-reale",
} as const;

/**
 * Where the signed-in cookies are written by `auth.setup.ts` and read by every
 * other project. A file rather than module state, because Playwright runs
 * projects in separate processes.
 */
export const STORAGE_STATE = "test-results/.auth/admin.json";

/**
 * The base32 secret from the enrolment page, held for the session's lifetime.
 *
 * Module scope so that the install runs once per worker even though several
 * spec files ask for a signed-in page. Installation is a one-time operation by
 * design — the second attempt returns 404 — so re-running it per test would
 * fail on everything after the first.
 */
let secret: string | null = null;
let installed = false;

/** The captured TOTP secret, if enrolment has run in this process. */
export const totpSecret = (): string | null => secret;

/** True when the shop has not been installed yet on this server. */
async function needsInstall(page: Page): Promise<boolean> {
  const response = await page.goto("/admin/installazione");
  // The route closes itself permanently once installation completes.
  return response !== null && response.status() < 400;
}

export async function installShop(page: Page): Promise<void> {
  if (installed) return;

  if (!(await needsInstall(page))) {
    installed = true;
    return;
  }

  await page.fill('input[name="email"]', ADMIN.email);
  await page.fill('input[name="password"]', ADMIN.password);

  await page.fill('input[name="confirm"]', ADMIN.password);
  await page.fill('input[name="name"]', ADMIN.name);
  await page.fill('input[name="setupToken"]', ADMIN.setupToken);

  await page.locator('form:has(input[name="setupToken"]) button[type="submit"]').first().click();
  await settle(page);

  installed = true;
}

export async function logIn(page: Page): Promise<void> {
  await page.goto("/admin/accedi");

  // Installation signs the new administrator in as part of completing, so the
  // login page redirects away when a session already exists. That is correct
  // behaviour — being asked to log in immediately after creating the account
  // would be a strange first impression — and it means this helper has to cope
  // with the form not being there.
  if ((await page.locator('input[name="email"]').count()) === 0) return;

  await page.fill('input[name="email"]', ADMIN.email);
  await page.fill('input[type="password"]', ADMIN.password);
  await page.locator('form:has(input[name="email"]) button[type="submit"]').first().click();
  await settle(page);
}

/** Ends the session, for tests that need to log in from scratch. */
export async function logOut(page: Page): Promise<void> {
  await page.goto("/admin");
  const form = page.locator('form[action="/admin/esci"]');
  if ((await form.count()) > 0) {
    await form.first().locator('button[type="submit"]').click();
    await page.waitForLoadState("networkidle");
  }
}

/**
 * Completes two-factor enrolment, or answers the challenge if already enrolled.
 *
 * The secret is shown once, on the enrolment page, and never again — which is
 * correct, and means it has to be captured the first time or the account is
 * unusable for the rest of the run.
 */
export async function passTwoFactor(page: Page): Promise<void> {
  // Already inside: nothing to do.
  if (!page.url().includes("sicurezza") && !page.url().includes("2fa")) {
    const onAdmin = await page.locator("main").count();
    if (onAdmin > 0 && page.url().includes("/admin") && !page.url().includes("accedi")) return;
  }

  if (secret === null) {
    await page.goto("/admin/sicurezza/2fa/configura");

    // Landing on the login page means the session was not established — which
    // happens when installation completed without applying its cookie to this
    // context. Logging in and retrying once is the difference between a helper
    // that works and one that fails with "the markup must have changed",
    // sending whoever reads it to inspect a page that is perfectly fine.
    if (page.url().includes("accedi")) {
      await logIn(page);
      await page.goto("/admin/sicurezza/2fa/configura");
    }

    // Step one: confirm the password, which is what releases the secret.
    //
    // The submit button is located THROUGH the form holding the password, not
    // by `button[type=submit]` alone. The admin shell puts a logout button in
    // the account menu on every page, so an unscoped selector is ambiguous and
    // Playwright refuses it — which reads as a mysterious timeout rather than
    // as "you asked for two buttons".
    const passwordForm = page.locator('form:has(input[type="password"])').first();
    if ((await passwordForm.count()) > 0) {
      await passwordForm.locator('input[type="password"]').fill(ADMIN.password);
      await passwordForm.locator('button[type="submit"]').first().click();
      await page.waitForLoadState("networkidle");
    }

    // The page prints the base32 secret for manual entry, since a QR code is
    // useless without a camera.
    const secretText = await page
      .locator("code, .totp-secret, [data-totp-secret]")
      .allTextContents();
    const candidate = secretText
      .map((t) => t.replace(/\s+/g, ""))
      .find((t) => /^[A-Z2-7]{16,}$/.test(t));

    if (!candidate) {
      // Say what was actually on the page. A helper that fails with a guess
      // about the cause costs more time than one that shows the evidence.
      const heading = (await page.locator("h1").first().textContent()) ?? "(no h1)";
      throw new Error(
        `Could not read the TOTP secret.
` +
          `  url: ${page.url()}
` +
          `  h1: ${heading.trim()}
` +
          `  <code> blocks found: ${JSON.stringify(secretText)}`,
      );
    }
    secret = candidate;
  }

  const code = await stableTotp(secret);

  // The ENROLMENT page carries a single code form, marked with `step=verify`.
  // Selected by that rather than by "the first form containing a code field",
  // so it cannot silently start matching something else.
  const codeForm = page.locator('form:has(input[name="step"][value="verify"])').first();
  if ((await codeForm.count()) === 0) return;

  await codeForm.locator('input[name="code"]').fill(code);
  await codeForm.locator('button[type="submit"]').first().click();
  await settle(page);
}

/**
 * Waits for navigation to finish, including a redirect that arrives after the
 * network has gone quiet.
 *
 * `waitForLoadState("networkidle")` is not enough here. Completing enrolment
 * REVOKES every session — correct, since a factor that was just added should
 * protect the next request rather than the one after it — and the resulting
 * bounce to the login page arrives late. Reading `page.url()` too early gave
 * the enrolment URL, so the helper concluded it was still signed in and never
 * logged back in. The symptom was a final assertion failing on "Accesso staff"
 * with nothing obviously wrong anywhere.
 */
async function settle(page: Page): Promise<void> {
  await page.waitForLoadState("networkidle");
  const before = page.url();
  // A short grace period for a redirect already in flight. Bounded, so a page
  // that simply does not redirect costs half a second rather than a timeout.
  for (let i = 0; i < 5; i += 1) {
    await page.waitForTimeout(100);
    if (page.url() !== before) {
      await page.waitForLoadState("networkidle");
      return;
    }
  }
}

/**
 * Answers a two-factor challenge, using the secret captured during enrolment.
 *
 * Enrolling ENDS the session, which is correct — the factor that was just added
 * has to be proved before it protects anything, and carrying the old session
 * across would mean the first use of the new factor is the one after the one
 * that mattered. So a second sign-in follows enrolment, and this answers the
 * challenge it raises.
 */
export async function answerChallenge(page: Page): Promise<void> {
  if (secret === null) {
    throw new Error(
      "No TOTP secret captured. Enrolment must run before a challenge can be answered.",
    );
  }

  /*
   * The challenge page offers TWO forms: one for an authenticator code, one for
   * a backup code. Both post a field called `code`, told apart only by a hidden
   * `mode`. Taking "the first form with a code field" submitted a perfectly
   * valid TOTP code as a BACKUP code, which was rejected — and the page simply
   * re-rendered, so it looked like a bad code rather than the wrong form.
   */
  const codeForm = page.locator('form:has(input[name="mode"][value="totp"])').first();
  if ((await codeForm.count()) === 0) {
    // Loudly, not silently. A helper that quietly does nothing when it cannot
    // find its form produces a failure three steps later, on an assertion that
    // has nothing to do with the cause.
    const heading = (await page.locator("h1").first().textContent()) ?? "(no h1)";
    throw new Error(`No TOTP challenge form at ${page.url()} (h1: ${heading.trim()}).`);
  }

  /*
   * Up to three attempts, each in a different thirty-second window.
   *
   * A TOTP code is single-use, and enrolment happens moments before this. Two
   * submissions inside one window send the same digits, and the second is
   * refused as a replay — which is the scheme working correctly, and which
   * looks identical to a wrong code from the outside.
   *
   * `freshTotp` avoids the obvious case; the retries cover the boundary ones,
   * where the window rolls between generating a code and submitting it.
   * Bounded at three, so a genuinely broken setup fails in about a minute
   * rather than hanging.
   */
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const form = page.locator('form:has(input[name="mode"][value="totp"])').first();
    if ((await form.count()) === 0) return;

    const code = await freshTotp(secret);
    await form.locator('input[name="code"]').fill(code);
    await form.locator('button[type="submit"]').first().click();
    await settle(page);

    if ((await page.locator('form:has(input[name="mode"][value="totp"])').count()) === 0) return;

    if (attempt < 3) {
      // Wait out this window so the next attempt is genuinely a new code.
      const secondsIntoPeriod = Math.floor(Date.now() / 1000) % 30;
      await page.waitForTimeout((30 - secondsIntoPeriod) * 1000 + 500);
    }
  }

  const alerts = await page.locator('[role="alert"], .notice--danger').allTextContents();
  throw new Error(
    `The challenge was refused three times at ${page.url()}. Page said: ${JSON.stringify(alerts)}`,
  );
}

/** Install if needed, log in, clear two-factor, and land on the dashboard. */
export async function signIn(page: Page): Promise<void> {
  await installShop(page);
  await logIn(page);

  // A privileged account is held in the security section until it has enrolled.
  // Following that redirect IS the test of the gate.
  if (page.url().includes("2fa") || page.url().includes("sicurezza")) {
    await passTwoFactor(page);
  }

  // Enrolment ends the session, so sign in again and answer the challenge the
  // newly-added factor now raises.
  if (page.url().includes("accedi")) {
    await logIn(page);
    await answerChallenge(page);
  }

  // A fresh login can also land straight on the challenge, without enrolment.
  if (page.url().includes("verifica") || (await page.locator('input[name="code"]').count()) > 0) {
    await answerChallenge(page);
  }

  await page.goto("/admin");
}
