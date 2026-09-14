# Admin QA — how the admin is tested

The procedure, the commands, and the honest limits of each. Findings live in
`docs/admin-audit.md`; changes in `docs/admin-fixes.md`.

---

## The layers

| Layer                 | Command                    | Answers                                                                                                                            |
| --------------------- | -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Verification baseline | `npm run verify`           | Format, lint, types, locale parity, migrations, SQL portability, unit, integration, build, bundle budgets, secret scan. 11 checks. |
| Unit                  | `npm run test:unit`        | Pure logic and source-level guards. 556 tests.                                                                                     |
| Integration           | `npm run test:integration` | Workers runtime with a real database.                                                                                              |
| Browser, default      | `npm run test:e2e`         | Chromium desktop + Pixel 7, plus the visual survey.                                                                                |
| Browser, cross-engine | `npm run test:e2e:cross`   | Firefox and WebKit, on a deliberate subset.                                                                                        |
| MariaDB               | `npm run test:e2e:mariadb` | The Hostinger database engine. Run separately.                                                                                     |

`npm run verify` does **not** cover browser tests, deployed performance, or a
tested backup restore. It says so when it finishes.

---

## How the browser suite authenticates

Through the real front door, once, in its own project.

`tests/browser/auth.setup.ts` installs the shop through the first-run form, logs
in, enrols a second factor, answers a challenge, and writes the cookies to a
file every other project loads. The TOTP secret is shown exactly once during
enrolment — correct for a real account — so it can only be captured there.

Nothing bypasses authentication, and no real credential is involved: the account
is synthetic and the database is a throwaway wiped on every run.

**A file-level `test.use({ storageState: STORAGE_STATE })` is mandatory in any
spec with signed-in tests.** Leaving it off does not announce itself — the admin
screens simply redirect to the login page, the fields the tests look for are
absent, and a guard written to skip when a field is missing reports a tidy
"skipped" instead of "this never ran". That happened once and is why the
signed-in tests now _assert_ the URL rather than guarding on a locator count.

---

## Testing the password control

`tests/unit/password-fields.test.ts` — three source-level guards:

1. No route or component contains a raw `type="password"` outside the shared
   component. This catches the real failure mode, which is copy-and-paste: a new
   admin form is written by copying a nearby one.
2. `new-password` appears only where a password is genuinely being chosen.
3. No password value is written to `localStorage` or `sessionStorage`.

`tests/browser/admin-password.spec.ts` — behaviour, in Chromium, Firefox and
WebKit, at desktop and phone widths:

- starts masked; reveals and re-masks on demand; the value survives the toggle
- the toggle does not submit the form it sits in (`type="button"`)
- **toggling produces zero network requests**
- operable by keyboard alone, with Enter and Space
- `aria-controls` names the input
- masked again after a reload
- masked again when the page is hidden, without discarding the value
- masked again after a rejected sign-in
- a step-up password can be revealed while signed in
- the stored payment identifier has **no** reveal control

Two checks live elsewhere, on purpose:

- **Each field toggles independently** is asserted in `installShop`. It needs a
  screen with two password fields at once, and the only one is first-run setup —
  which closes itself permanently once used. A test navigating there later would
  find a 404 and skip, and a skipped test in a summary reads as a verified one.
- **The payments step-up reveal** is asserted inside the workflow helper that
  satisfies that step-up, because satisfying it hides the form for ten minutes.

---

## Rules this suite runs on

**A skip is not a pass.** Guard on a precondition only when the precondition is
genuinely optional. If a test cannot run because something is broken, it must
fail. Prefer asserting the precondition.

**Write the failing test first, and watch it fail for the right reason.** The
payment-amount tests failed with `Expected "34,90", Received "3490"` before the
fix — which is the defect, stated as an assertion. A test written afterwards
proves only that the code does what it does.

**Shared rows are the main source of flakiness.** One `wrangler dev` and one
SQLite file sit behind every project, with two workers. Any test that writes a
shared fixture row must be scoped to one project:

```ts
test.skip(testInfo.project.name === "mobile", "writes shared rows");
```

This is not cosmetic. The conflict test and the product-type template test both
write the Cavo USB-C product; with the conflict test running on both projects, a
save could be refused by the very guard the other test was proving works.

**Credentials never appear in a test.** The synthetic `ADMIN` constant only. A
password typed into a test is a password in the repository, in CI output, and in
every trace the run saves.

### Known flakiness

One full desktop+mobile run produced six mobile failures in `admin.spec.ts`.
Each passed in isolation and an identical clean re-run passed everything. The
failures wandered, so they are contention rather than a defect. If a full run
fails, re-run the failing spec alone before believing it.

---

## Current state

|                           |                                  |
| ------------------------- | -------------------------------- |
| `npm run verify`          | VERIFIED, 11 checks              |
| Unit                      | 556 passed                       |
| Browser, desktop + mobile | 145 passed, 12 skipped, 0 failed |
| Firefox + WebKit          | 38 passed, 5 skipped             |

The 12 skips are the shared-row convention plus two viewport-specific tests. The
WebKit skips are its refusal to keep a `__Host-` cookie over plain `http` on
`127.0.0.1` — which is WebKit being right, and the admin is never served that
way. Each skip states its reason in the skip message.

---

## What this does not test

- **Screen readers.** Axe passes on every admin screen. That is a much weaker
  claim than "usable with a screen reader", and no screen reader was run.
- **The live deployment.** Everything above runs locally.
- **MariaDB**, in this pass. `npm run test:e2e:mariadb` and
  `npm run test:db:mariadb` exist and were not run.
- **Load and brute-force behaviour.** Deliberately not tested.
