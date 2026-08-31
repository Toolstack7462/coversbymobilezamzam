import { test as setup, expect } from "@playwright/test";
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import {
  installShop,
  logIn,
  passTwoFactor,
  answerChallenge,
  ADMIN,
  STORAGE_STATE,
} from "./helpers/admin-session";

/**
 * Signs in once, for the whole run.
 *
 * The admin tests originally each did their own install-and-enrol. That worked
 * until Playwright split the describe blocks across workers, at which point the
 * TOTP secret — held in module scope — vanished between them, and the second
 * worker could not get past a two-factor challenge for an account it had never
 * enrolled.
 *
 * Sharing module state across processes is not something to fight. So this
 * runs first, as its own project, and writes the authenticated cookies to a
 * file that every other project loads. It is also closer to the truth: a
 * merchant installs once and stays signed in, rather than re-enrolling before
 * every task.
 *
 * The install itself is still exercised for real — this file IS the test of
 * the first-run flow, and if any step of it breaks, nothing else runs.
 */

setup("install the shop and sign in", async ({ page }) => {
  await installShop(page);
  await logIn(page);

  // A super admin holds permissions that all require a second factor, so the
  // shell refuses everything operational until enrolment is complete.
  await passTwoFactor(page);

  // Enrolment deliberately ends the session: a factor that was just added has
  // to be proved before it protects anything. So the merchant signs in once
  // more and answers a challenge — and so does this.
  if (page.url().includes("accedi")) {
    await logIn(page);
    await answerChallenge(page);
  }

  await page.goto("/admin");
  await expect(page.locator("h1")).toContainText(/ciao|panoramica/i);

  mkdirSync(dirname(STORAGE_STATE), { recursive: true });
  await page.context().storageState({ path: STORAGE_STATE });

  // Recorded so a test that needs a fresh challenge can produce one. The secret
  // is shown exactly once during enrolment and never again, which is correct
  // for a real account and means it has to be captured here or not at all.
  const { totpSecret } = await import("./helpers/admin-session");
  if (totpSecret()) {
    writeFileSync(`${STORAGE_STATE}.totp`, totpSecret()!, "utf8");
  }

  expect(ADMIN.email).toContain("@");
});
