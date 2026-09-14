# Admin reliability and UX — results

Branch `feat/admin-ux-reliability`, from `103fd139d0ec91570b3e9ddd1c7cb968ea28918a`.

Nothing here has been merged to `main` or deployed. This workstream does not
release.

---

## 1. Ownership as actually exercised

| Area                                      | Touched               | Note                                     |
| ----------------------------------------- | --------------------- | ---------------------------------------- |
| `app/styles/app.css`                      | yes                   | one rule — the `body` background cascade |
| `app/styles/storefront.css`               | one dead line removed | see §2, no visual change                 |
| `app/styles/admin.css`, `admin-forms.css` | yes                   | admin-scoped                             |
| `app/routes/admin/**`                     | yes                   | password control, save validation        |
| `package.json` / lockfile                 | no                    | unchanged                                |
| `app/root.tsx`, `tokens.css`, locales     | no                    | unchanged                                |
| Server / deployment config                | no                    | unchanged                                |

---

## 2. Defect register

| #   | Reproduction                             | Expected                         | Actual                                                                                                   | Sev                           | Root cause                                                                                                    | Fix                                                   | Regression evidence                                                                                                                                      |
| --- | ---------------------------------------- | -------------------------------- | -------------------------------------------------------------------------------------------------------- | ----------------------------- | ------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D-1 | Load any storefront page, inspect `body` | The gradient `app.css` describes | `background-image: none` — a flat fill                                                                   | **High** (every page, silent) | A `background` shorthand six lines below `background-image` in the same rule resets every background longhand | Colour set with `background-color`, first             | Unit guard scans all stylesheets; browser test asserts a gradient paints. Re-introducing the bug makes the browser test fail with `Expected: not "none"` |
| D-2 | `.showcase__controls button`             | —                                | `flex-basis: 0` then `flex: 1`                                                                           | Info                          | `flex: 1` expands to `1 1 0%`; the longhand was dead                                                          | Dead line removed                                     | Same unit guard. **No visual change** — identical computed value                                                                                         |
| D-3 | Type a received payment as `19,90`       | Accepted                         | `NaN` → generic "Dati non validi"; field asked for **cents**, so a €10 partial payment recorded as €0.10 | **High** (money)              | Form exposed the storage format; read with `Number()`                                                         | Reads euro via `parseAmountToMinorUnits`              | Two browser tests, written first, failed with `Expected "34,90", Received "3490"`                                                                        |
| D-4 | Add a variant with quantity `12 pezzi`   | Refusal                          | Variant created silently holding no stock                                                                | Medium                        | `Number(...) \|\| 0`                                                                                          | `Number.isInteger` or a refusal                       | Unit + the guard in the action. See the limit noted below                                                                                                |
| D-5 | Reveal a password, submit, get it wrong  | Field returns masked             | Rejected password stayed legible on screen                                                               | Medium                        | React re-renders the _same_ component, so visibility survived                                                 | Re-masks on submit, via a listener on the owning form | Browser test in `admin-password.spec.ts`                                                                                                                 |
| D-6 | 12 password inputs across 9 screens      | A reveal control                 | None had one                                                                                             | Medium                        | Twelve separate copies of the control                                                                         | One shared `PasswordField`                            | Unit guard fails any raw `type="password"`; behaviour tested in three engines                                                                            |

### A limit worth stating

**D-4's guard cannot be reached through the UI.** The quantity field is
`type="number"`, so a browser will not accept `12 pezzi` at all — and an
invalid value in a number input submits as an _empty string_, which the action
treats as "not supplied" and defaults to 0. The server-side validation is
genuine and defensive (it catches a crafted POST), but it is not what protects
a merchant from a typo. Recorded rather than dressed up as a passing test.

---

## 3. Checked and found already correct

No change made. Recorded so the next audit does not re-derive it.

| Area                   | Finding                                                                                                                                                                                                  |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Leading zeros          | `sku` and `barcode` are `VARCHAR(64)`; nothing coerces them numerically anywhere in the codebase. Round-trip proved in a browser with `007-ZERO-…`                                                       |
| Zero vs missing        | A stock of `0` persists as `0`; an empty optional price stays empty rather than becoming `0,00`                                                                                                          |
| Revoked permissions    | `loadStaffActor` re-queries on **every** request with `active = 1 AND archived_at IS NULL`; permissions are re-read per request, so a revocation takes effect on the next request with no cache to flush |
| Authorisation coverage | All 36 admin actions re-check permission server-side; the five routes without a check are the pre-auth ones                                                                                              |
| Unchecked checkboxes   | All four surfaces save `false` correctly                                                                                                                                                                 |
| Reserved stock         | Read-only, and `on_hand` is refused below it with a message naming the number                                                                                                                            |
| Italian decimals       | `parseAmountToMinorUnits` handles `39,90`, `39.90`, `€ 39,90`, `1.299,00`, and refuses >2 decimals rather than guessing                                                                                  |
| Payment identifiers    | Stored encrypted, rendered masked; a browser test asserts no reveal control names that field                                                                                                             |

---

## 4. Not done in this pass

Stated plainly rather than implied by omission.

- **§4 navigation restructure and §6 CMS field mapping.** Not started. §6 is
  gated on `docs/frontend/motion-refresh/integration-request.md`, which **does
  not exist in any branch** — so there is no proposed field list to map, and
  inventing one would create exactly the duplicate settings the brief forbids.
- **§8 integration.** GPT's branch `feat/storefront-motion-refresh` **does not
  exist on the remote.** See the handoff note below.
- **Screen-reader testing.** Not performed. Axe passes; that is a weaker claim.
- **Concurrent-edit conflicts** remain implemented on the product editor only.
  Four other multi-field editors still last-write-win silently.

---

## 5. A note on the browser suite

Three full runs in this session reported "passed" while most of the suite never
executed — 29, then 43, against a true total of 216. Nothing failed; the tests
simply did not run.

The reliable mitigation is to wipe the throwaway database first:

```sh
rm -rf .wrangler/e2e && npm run test:e2e
```

and to check the per-project counts rather than the total:

```
85 [desktop]  79 [mobile]  57 [visual]  8 [storefront]  1 [setup]
```

A total on its own cannot distinguish a green run from a run that stopped
early, which is the whole hazard the Playwright config warns about twice.

---

## 6. Verification

|                      |                                                                     |
| -------------------- | ------------------------------------------------------------------- |
| `npm run verify`     | VERIFIED — 11 checks                                                |
| Browser suite        | 216 passed / 14 skipped / **0 failed**, all five projects executing |
| Storefront JS budget | 135.0 KB / 136.0 KB (99%) — unchanged by this branch                |
| Admin JS budget      | 87.6 KB / 120.0 KB (73%)                                            |
| CSS budget           | 18.1 KB / 45.0 KB (40%)                                             |

No budget raised, no gate weakened, no test skipped to pass.
