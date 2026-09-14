# Admin audit — September 2026

What was examined, what was found, what was fixed, and — the part that matters
most in a document like this — what was **not** verified.

Branch: `fix/admin-audit-and-refinement`, from `0e98a14` on `main`.

---

## 1. Access and baseline

|                |                                                                                                                    |
| -------------- | ------------------------------------------------------------------------------------------------------------------ |
| Environment    | Local build + the browser suite's throwaway database. Never the live shop.                                         |
| Authentication | The real login flow, against the synthetic account the suite installs (`installShop` → `logIn` → `passTwoFactor`). |
| Credentials    | None of the merchant's. No password, TOTP secret or recovery code was requested or used.                           |
| Live data      | Untouched. No stock altered, no real payment verified, no invitation sent, no password reset.                      |
| Other sites    | Untouched. Nothing on the Hostinger account outside this project was read or changed.                              |

**Pushing `main` deploys.** Confirmed by observing it fire on the previous push.
All work here is on the feature branch; nothing was pushed to `main`.

**Baseline before editing:** `npm run verify` → VERIFIED, 11 checks. Storefront
JavaScript at 132.5 KB of a 136.0 KB budget (97%), which set a hard constraint:
nothing may be added to the customer's bundle.

**Scope:** 49 route files under `app/routes/admin/`, 36 of which have an action.

---

## 2. Confirmed defects

Four, of which three are fixed. Ranked by consequence.

### A-1 · The received payment amount was asked for in cents — **P1, fixed**

|            |                                                                                                                                         |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Route      | `/admin/pagamenti`                                                                                                                      |
| Role       | `payment.verify` + step-up                                                                                                              |
| Steps      | Open the verify panel on a payment. Read the label. Change the figure.                                                                  |
| Expected   | An amount in euro, written the Italian way: `34,90`.                                                                                    |
| Actual     | Label read "Importo ricevuto (centesimi)", field was `type="number"` prefilled `3490`, and the value was read with `Number(rawAmount)`. |
| Root cause | The domain stores minor units, and the form exposed the storage format directly instead of converting at the edge.                      |

Why it mattered more than it looked: the prefill made the common path safe.
The trap sprang only when the figure had to be **changed** — which is precisely
the partial-payment case the outcome list offers. A merchant who received ten
euros types `10` and records ten **cents** against the order. Nothing downstream
catches it, because a partial payment is deliberately not compared with the
expected amount.

And `34,90` — the form the amount takes everywhere else on that same screen,
including the hint immediately beneath the field — produced `NaN`, which zod
rejected as the generic "Dati non validi."

Fixed: reads euro through `parseAmountToMinorUnits`, the same parser every other
price in the admin uses, and refuses an unreadable amount with a sentence naming
what was typed. `type="text"` with `inputMode="decimal"`, because a number input
refuses the comma outright in some browsers.

Regression test: `tests/browser/admin-workflows.spec.ts` — "asks for the amount
in euro and accepts the Italian form", and "refuses an amount it cannot read".
Both were written first and observed to fail (`Expected "34,90", Received
"3490"`).

### A-2 · A revealed password survived a rejected sign-in — **P1, fixed**

|            |                                                                                                                   |
| ---------- | ----------------------------------------------------------------------------------------------------------------- |
| Route      | `/admin/accedi` (and every other password form)                                                                   |
| Steps      | Reveal the password, submit, get it wrong.                                                                        |
| Expected   | The form comes back masked.                                                                                       |
| Actual     | The rejected password stayed legible on screen.                                                                   |
| Root cause | React Router re-renders the _same_ component on the action's error, so the component's visibility state survived. |

Introduced by the new control and caught by its own test before it shipped. The
field now re-masks on submit, via a listener on the owning form rather than a
prop each caller must remember to pass.

### A-3 · An unreadable stock figure became zero — **P2, fixed**

|            |                                                                                              |
| ---------- | -------------------------------------------------------------------------------------------- |
| Route      | `/admin/prodotti/:id`, "add variant"                                                         |
| Steps      | Type `12 pezzi`, or `1,5`, or paste a figure carrying a non-breaking space.                  |
| Expected   | Refusal, with a sentence.                                                                    |
| Actual     | `Math.max(0, Math.trunc(Number(...) \|\| 0))` → a variant created silently holding no stock. |
| Root cause | A coercion where the two inventory screens next door both validate.                          |

Fixed to match them: `Number.isInteger` or a refusal.

### A-4 · Twelve password fields, none revealable — **P2, fixed**

Covered in full in `docs/admin-fixes.md`. Twelve `type="password"` inputs across
nine screens, none with a Show/Hide control, on forms that gate payment
verification and second-factor enrolment.

---

## 3. Missing functionality

### M-1 · There is no password-reset screen

No route among the 49 lets a staff member who has forgotten their password
recover the account. The only paths in are the first-run setup token and an
invitation from another administrator.

Deliberately **not** built in this pass, because building it would be worse than
leaving it: reset requires email, and no mail provider is configured on the
deployment. Better Auth's `sendResetPassword` is registered only when
`RESEND_API_KEY` is present, so a reset screen today would either fail silently
or promise an email that never arrives — which the brief explicitly forbids.

The prerequisite is SMTP, already on the outstanding-work list.

### M-2 · Conflict protection covers one form

`loadedUpdatedAt` — the guard that refuses a save from a form rendered before
somebody else's save — exists on the product editor and **only** there.

Verified by reading, not assumed: the product editor's guard is correct,
compares as a number, and has its own browser test. The other multi-field
editors (`pages`, `homepage`, `legal-documents`, and the payment-method form in
`settings`) will last-write-win silently.

Not fixed here: it is a change to five forms and their tests, and this pass was
scoped to the password control and confirmed P0/P1 defects. The payment-method
form is the one worth doing first.

---

## 4. Checked and found correct

Recorded because "we looked and it was fine" is a result, and because the next
audit should not re-derive it. None of these produced a change.

| Area                                            | Finding                                                                                                                                                                                                                                                                                                                                                                                       |
| ----------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Authorisation on every action**               | All 36 admin actions re-check permission server-side. The five routes with no check are the pre-auth ones — login, logout, 2FA verify, setup, invitation acceptance — which is correct. Two files initially looked unguarded; both were a flaw in my heuristic, which mis-split compound conditions like `intent === "publish" \|\| intent === "reject"`. Reading them showed correct guards. |
| **Unchecked checkboxes save `false`**           | All four checkbox surfaces handle it. The settings toggles and legal-documents use a hidden field before the box; the payment-method `active` box has no `value`, so an unchecked box yields `null` and `=== "on"` is correctly `false`.                                                                                                                                                      |
| **Reserved stock is not editable**              | Shown in a `<td>`, never an input, and `on_hand` is refused below `reserved` with a message naming the number.                                                                                                                                                                                                                                                                                |
| **Money parsing**                               | `parseAmountToMinorUnits` is strict, handles `39,90`, `39.90`, `€ 39,90` and `1.299,00`, and refuses more than two decimals rather than guessing. Used by every price-writing route.                                                                                                                                                                                                          |
| **Inventory quantities**                        | Both adjustment and transfer screens validate with `Number.isInteger` and refuse with a sentence.                                                                                                                                                                                                                                                                                             |
| **Payment identifiers are not revealable**      | `settings.tsx` selects only `account_identifier_masked`, stores `account_identifier_encrypted`, and audits the masked value. The generic Show/Hide was deliberately **not** applied; a browser test asserts no reveal control names that field.                                                                                                                                               |
| **Dashboard does not call order value revenue** | Already labelled "Ordini creati, non incassati", with a comment saying that calling it _incasso_ would be a lie.                                                                                                                                                                                                                                                                              |
| **Compatibility levels**                        | `exact_fit` requires a human and a verification flag; universal is a separate record and is not inferred. Covered by existing unit tests.                                                                                                                                                                                                                                                     |
| **Double-submitting a verification**            | The payment state machine refuses the second transition (`invalid_transition`). Not silent duplication.                                                                                                                                                                                                                                                                                       |

---

## 5. Not verified

Stated plainly, because a summary that omits this is worse than no summary.

- **Screen readers.** No screen reader was run. The Caps Lock notice uses a live
  region present from first render, which is the accepted pattern; it has not
  been heard. Axe passes on every admin screen, which is a different and much
  weaker claim.
- **The live deployment.** Everything here was tested locally and against the
  browser suite's throwaway database. Nothing was deployed; `main` was not
  pushed.
- **The other 45 admin routes' save paths, individually.** The hazard classes in
  §5 of the brief were checked by reading across all of them and by targeted
  probes. Each route's every field was not exercised by hand.
- **MariaDB.** The browser suite runs against the Cloudflare/D1 configuration.
  `playwright.mariadb.config.ts` exists and was not run in this pass.
- **Firefox and WebKit for signed-in admin screens.** WebKit discards the
  `__Host-` session cookie over plain `http` on `127.0.0.1`, so its signed-in
  tests skip and say so. Firefox runs them.
- **Load or brute-force behaviour.** Deliberately not tested: the brief forbids
  it against live authentication, and it was not done locally either.

### A flaky suite, observed

One full desktop+mobile run produced six mobile failures in `admin.spec.ts`.
Each passed in isolation, and an identical clean re-run passed everything
(145 passed / 12 skipped / 0 failed). The failures wandered, so they are
contention — two Playwright workers over a single `wrangler dev` and one SQLite
file — not a defect. It is recorded here rather than left to be rediscovered.
Adding tests made it likelier; the config already warns about this shape.
