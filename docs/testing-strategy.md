# Testing strategy

Four layers, each answering a different question. What matters is not a coverage
percentage but whether the fourteen invariants are actually pinned.

**An invariant with no test is an intention.**

---

## The layers

| Layer       | Runs in                                 | Answers                                         |
| ----------- | --------------------------------------- | ----------------------------------------------- |
| Unit        | Node                                    | Do the business rules compute the right answer? |
| Integration | **workerd + real D1 + real migrations** | Does the database actually behave as assumed?   |
| Security    | workerd                                 | Can this be abused?                             |
| Browser     | Playwright + axe                        | Does a customer's actual journey work?          |

### Why integration tests run against real D1

A mocked database would happily accept the oversell this project exists to
prevent, and a hand-written `CREATE TABLE` would prove nothing about the schema
that ships. `tests/setup/apply-migrations.ts` applies the same files Wrangler
applies in production.

This has already paid for itself twice. The CHECK-constraint reservation guard
and the batch-rollback behaviour were both _verified_ rather than assumed — and
the first design (a conditional `WHERE`) turned out to be wrong in a way no unit
test could have shown.

---

## Current state — measured, not estimated

    npm run test:unit           10 files, 173 tests   PASS
    npm run test:integration     5 files,  42 tests   PASS

Unit coverage by area: money · compatibility resolution · all three status
machines · price and discount display · order numbers and tracking tokens ·
WhatsApp message composition · cart and VAT totals · availability ·
configuration gates · permissions.

Integration and security: concurrency · idempotency · reservation expiry and its
race with verification · order snapshots · price tampering · payment-method
gating · foreign-key protection of historical orders · **payment verification
authorisation, step-up enforcement and step-up consumption** · proof upload not
changing status · amount-mismatch refusal · duplicate-reference flagging ·
audit-row writing · stock consumption on payment.

**Browser tests are not yet written.** Stated plainly rather than implied.

---

## Invariant → test map

| #   | Invariant                      | Test                                        |
| --- | ------------------------------ | ------------------------------------------- |
| 1   | Money is integer minor units   | `unit/money.test.ts`                        |
| 2   | Server is the only authority   | `security/tampered-price.test.ts`           |
| 3   | Compatibility is a record      | `unit/compatibility.test.ts`                |
| 4   | Stock moves through the ledger | `integration/concurrency.test.ts`           |
| 5   | Order items are snapshots      | `integration/order-snapshot.test.ts`        |
| 6   | Only a human marks paid        | `security/payment-verification.test.ts`     |
| 7   | Separate status machines       | `unit/state-machines.test.ts`               |
| 8   | Sensitive mutations audited    | `security/payment-verification.test.ts`     |
| 9   | Forward-only migrations        | `npm run migrations:check`                  |
| 10  | UTC storage, Rome display      | `unit/order-number.test.ts` (date boundary) |
| 11  | No fabricated claims           | `unit/price-display.test.ts`                |
| 12  | Configuration gates            | `unit/config-gates.test.ts`                 |
| 13  | Archive, do not erase          | `integration/order-snapshot.test.ts`        |
| 14  | Idempotency                    | `integration/concurrency.test.ts`           |

All fourteen invariants now have at least one test that fails if they are
violated. Coverage of 8 is partial by area rather than by principle: payment
verification, price changes, inventory adjustments, product archiving and
settings changes are audited and tested; other sensitive mutations will need
their own tests as they are built.

---

## The tests that matter most

Three of them, all in the integration layer:

**Two customers, one unit.** Two `createOrder` calls in flight simultaneously
for the last item. Exactly one succeeds, `reserved` never exceeds `on_hand`, and
the loser leaves behind no order, no line items and no reservation.

**Verification versus the sweeper.** A customer pays at minute 119 and staff
verify at 121 while the sweeper runs. The outcome is consistent either way —
paid with stock held, or expired with stock returned. Never both. Two sweepers
running at the same instant release the hold exactly once.

**Snapshots under edit.** Rename the product, change the price, change the SKU,
archive it: the historical order is unchanged, and deleting the product is
refused outright by the foreign key.

---

## What tests deliberately do NOT assert

- **Browser preferences.** WebKit does not Tab to links unless full keyboard
  access is enabled. A test asserting that is testing a browser setting, not
  this site. Assert DOM focus order instead.
- **Framework behaviour.** React Router's routing is React Router's problem.
- **Exact rendered strings.** They change with copy edits and produce noise.
  Assert the contract — that a percentage does not render without a prior price
  — not the sentence.

A test suite that cries wolf gets ignored, and an ignored suite is worse than
none.

---

## Honest limits

- Automated axe checks cover roughly **a third** of WCAG. They are not a
  screen-reader test and do not replace manual keyboard testing.
- No test proves Core Web Vitals. That needs a deployed preview.
- No test proves a backup works. That needs a restore into a disposable
  database, actually performed.
- Test isolation is explicit: `@cloudflare/vitest-pool-workers` 0.22 dropped the
  `isolatedStorage` option, so `tests/fixtures/seed.ts` truncates before each
  seed.

---

## Running

    npm run test:unit
    npm run test:integration
    npm run test:security
    npm run test:e2e
    npm run verify           # everything except browser tests
