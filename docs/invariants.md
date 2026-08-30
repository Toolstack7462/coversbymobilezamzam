# Invariants

Rules that must hold for the system to be correct. Each states what breaks if it
is violated, and where it is enforced.

An invariant with no test is an intention. Every one below names its test.

---

## 1 — Money is integer minor units

€39,90 is `3990`. Every monetary value carries a currency code (`EUR` in Phase 1).

Floating point cannot represent 0,10 exactly. Accumulate a few line items,
apply a percentage discount, and the total drifts by a cent — which is the
difference between a bank transfer reconciling and a customer being told their
payment was short.

**Enforced:** `app/domain/pricing/money.ts` is the only money constructor. ESLint
bans `parseFloat`. Schema columns are `integer`.
**Tested:** `tests/unit/money.test.ts`.

---

## 2 — The server is the only authority

Price, discount, VAT, shipping, total, stock, payment status, role, permission,
compatibility and inventory location are **recomputed server-side at order
creation** from the database. Client-submitted values are ignored, not validated
and trusted.

A cart is a list of variant ids and quantities. It is not a price list.

**Enforced:** order creation reads prices and stock inside the same transaction
that writes the order.
**Tested:** `tests/security/tampered-price.test.ts` submits a manipulated price
and asserts the stored order total matches the database.

---

## 3 — Compatibility is a record, never an inference

Compatibility exists only as a row in `product_compatibility`. It is never
derived from a product title, tag, category, URL, brand, search result or
collection membership.

Resolution rules:

1. A variant-level record overrides a product-level record.
2. An explicit `incompatible` record overrides any broader compatibility.
3. `universal` **never** resolves to exact fit.
4. `unverified` must be surfaced as unverified.
5. **No record means unknown, not compatible.**

"Case for iPhone 16 Pro" in a title is a marketing string. Treating it as data
means a customer with a 16 Pro Max is told a case fits when it does not, and the
shop pays for the return.

**Enforced:** `app/domain/compatibility/resolve.ts`, a pure function.
**Tested:** `tests/unit/compatibility.test.ts`, including universal-never-exact.

---

## 4 — Stock moves only through the ledger

Every change to on-hand quantity writes a `stock_movements` row. Every hold
writes a `stock_reservations` row. Manual adjustments additionally require a
reason, a staff user, and the before/after quantities.

`available = on_hand − reserved`.

Without a ledger, a discrepancy is unexplainable: you know the count is wrong and
you cannot find out when or why.

**Enforced:** repositories expose no bare stock setter, and
`CHECK (reserved >= 0 AND reserved <= on_hand)` aborts any batch that would
oversell.
**Tested:** `tests/integration/inventory-ledger.test.ts`.

---

## 5 — Order items are snapshots

At creation an order item copies product name, SKU, variant description, unit
price, quantity, discount, tax, compatibility state, image reference and the
customer's selected device.

An order is a record of an agreement at a moment. If renaming a product or fixing
a price rewrote past orders, the shop could not answer "what did I actually sell
them?" — and neither could an auditor.

**Enforced:** `order_items` carries its own columns; nothing joins to live
product data to render a historical order.
**Tested:** `tests/integration/order-snapshot.test.ts` mutates the product after
ordering and asserts the order is unchanged.

---

## 6 — Only a human marks an order paid

A WhatsApp click, an uploaded screenshot, a matching amount, or a customer saying
so — none of these may transition payment to `verified`.

A screenshot is trivially forged and proves nothing about settlement. Staff must
see the money in the actual bank account or merchant app.

**Enforced:** the verify transition requires an authenticated user with
`payment.verify`, step-up auth, an amount received and a reference or a stated
reason.
**Tested:** `tests/security/payment-verification.test.ts` asserts proof upload
leaves status unchanged, and that a user without the permission is refused.

---

## 7 — Four separate status machines

Order, payment, reservation and fulfilment statuses are distinct, typed, and
validated on transition. No arbitrary strings.

They genuinely diverge: an order can be `paid` but not yet `ready_for_pickup`;
`awaiting_payment` while partially refunded. Collapsing them into one field
forces invented composite states and loses information.

**Enforced:** transition maps in `app/domain/orders/`, `payments/`,
`inventory/`, `fulfilment/`.
**Tested:** `tests/unit/state-machines.test.ts` asserts every invalid transition
is rejected.

---

## 8 — Sensitive mutations are audited

Price change · stock adjustment · payment verification · payment-method change ·
IBAN change · order cancellation · refund · role change · compatibility
verification · product archive.

Each records actor, action, entity, before, after, timestamp and request id.

Money and stock attract mistakes and disputes. Without an audit trail the answer
to "who changed this price?" is a shrug.

**Enforced:** writes go through an audited use case, not a bare repository call.
**Tested:** `tests/integration/audit-log.test.ts`.

---

## 9 — Migrations are forward-only files

Schema changes ship as versioned SQL in `db/migrations`, committed and reviewed.
`drizzle-kit push` is never run against a deployed database.

`push` diffs live schema and applies what it infers — which can mean dropping a
column holding real orders, with no review step.

**Enforced:** no `push` script exists in `package.json`.
**Tested:** `npm run migrations:check` fails if the schema and migrations diverge.

---

## 10 — UTC in storage, Europe/Rome in display

Timestamps stored UTC. Customer-facing times rendered `Europe/Rome`. Cron
expressions are UTC and documented as such.

Italy observes DST. A reservation expiring "at 18:30" must mean the same instant
regardless of when it was created, and the sweeper must not shift by an hour
twice a year.

**Enforced:** the Clock port; ESLint bans bare `new Date()` outside
infrastructure.
**Tested:** `tests/unit/time.test.ts` covers a DST boundary.

---

## 11 — No fabricated commerce claims

Never generate reviews, ratings, sales counts, bestseller status, discounts,
prior prices, scarcity, countdowns, delivery promises, pickup readiness,
certifications, compatibility or warranties.

Beyond being dishonest, several are unlawful under the Unfair Commercial
Practices Directive as amended by (EU) 2019/2161, and prior-price claims are
governed in Italy by D.Lgs. 84/2022.

**Enforced structurally:** a percentage saving renders only from a recorded prior
price; rating markup renders only from real review rows; low stock requires real
tracked inventory.
**Tested:** `tests/unit/price-display.test.ts`.

---

## 12 — Configuration gates

A feature whose merchant data is missing is **disabled and renders nothing** —
never a placeholder, never a guess.

`[PHONE]` on a live storefront is worse than no phone number. An invented opening
time sends someone to a closed door.

**Enforced:** `app/domain/content/gates.ts` computes availability from settings;
components render `null`.
**Tested:** `tests/unit/config-gates.test.ts`.

---

## 13 — Archive, do not erase

Products, variants, users, payment methods and device records referenced by
historical transactions are archived, not deleted.

Deleting a product referenced by an order either breaks the order or silently
loses what was sold.

**Enforced:** `archived_at` columns; foreign keys `ON DELETE RESTRICT`.
**Tested:** `tests/integration/archive.test.ts`.

---

## 14 — Retryable mutations are idempotent

Order creation, reservation, reservation release, payment verification, email
generation and import confirmation accept an idempotency key. A repeat returns
the original result and does not act twice.

Customers double-click. Networks retry. Cron overlaps. Without idempotency a
double-submitted checkout reserves the last unit twice and creates two orders.

**Enforced:** `idempotency_keys` with a unique constraint; the key is claimed in
the same transaction as the effect.
**Tested:** `tests/integration/idempotency.test.ts`, and a concurrency test where
two simultaneous requests for the final unit produce exactly one success.
