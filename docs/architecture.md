# Architecture

## Shape

A **modular monolith** on Cloudflare Workers. One deployable unit, hard internal
boundaries.

Microservices would buy nothing here and cost plenty: distributed transactions
across order creation and stock reservation, several deployments to keep in step,
and an operational burden for a shop that needs none of it. The boundaries below
are enforced by dependency direction, so extraction stays possible if it is ever
warranted.

    ┌──────────────────────────────────────────────────────────┐
    │  routes/            storefront · admin · account · api   │
    │  components/        presentation only                    │
    ├──────────────────────────────────────────────────────────┤
    │  application/       use cases · ports                    │
    ├──────────────────────────────────────────────────────────┤
    │  domain/            entities · rules · pure functions    │
    ├──────────────────────────────────────────────────────────┤
    │  infrastructure/    D1 · R2 · Better Auth · email · FTS  │
    └──────────────────────────────────────────────────────────┘

Dependencies point **inward**. Infrastructure implements ports the application
declares; the domain declares nothing about the outside world.

### The domain layer imports nothing but TypeScript and Zod

No React, no Cloudflare binding, no Drizzle, no route module.

This is the rule that keeps the rest honest. Compatibility resolution, price
selection, availability, status transitions and totals are pure functions over
plain data, so they are testable in milliseconds without a database — and a
change to storage cannot silently change a business rule.

The practical test: **if a domain test needs a binding, the code is in the wrong
layer.**

### Ports

Declared in `app/application/ports/`:

`ProductRepository` · `InventoryRepository` · `OrderRepository` ·
`PaymentRepository` · `MediaStorage` · `EmailSender` · `AuditLogger` · `Clock` ·
`IdGenerator` · `Encryptor` · `SearchIndex`

`Clock` and `IdGenerator` look fussy until you try to test reservation expiry or
assert an order number. Injecting them makes time and identity deterministic.

## Runtime

| Concern | Choice |
|---|---|
| Compute | Cloudflare Workers |
| Framework | React Router v8, framework mode, SSR |
| Database | D1 (SQLite) — source of truth |
| Object storage | R2 — two buckets, see below |
| Auth | Better Auth over D1 |
| Validation | Zod at every boundary |
| Scheduled work | Cron Triggers (UTC) |

### Why SSR

Product, collection and search pages must render content in the first response —
for crawlers, and for LCP on a mid-range Android on mobile data, which is what
this audience actually browses on. A client-rendered catalogue fails both.

### Two R2 buckets, not one with a prefix

`MEDIA` is world-readable product imagery served from a public base URL.
`PRIVATE_FILES` holds payment proofs and exports.

They are separate buckets so that "public" is a property of the *bucket*, not of
a path convention someone can get wrong. A private object in a public bucket is
one bad key away from disclosure; here the private bucket has no public URL at
all, and every read goes through an authenticated, logged route.

### Why not Durable Objects

D1 supports conditional writes, and `UPDATE … WHERE reserved + ? <= on_hand`
either affects a row or does not. That is sufficient to prevent overselling, and
it is proven by a concurrency test rather than assumed.

Durable Objects would add a coordination layer, cost, and a second consistency
model. If measured concurrency ever shows D1 conditional writes are insufficient,
that is the moment to add them — with the measurement in the ADR.

## Request flows

**Storefront read.** Route loader → query use case → repository → D1 → SSR HTML.
Prices and availability come from the database on every render.

**Order creation.** One D1 batch, all-or-nothing:

1. Claim the idempotency key.
2. Re-read authoritative prices.
3. Re-read authoritative stock.
4. Validate quantities against available.
5. Insert order, order items (snapshotted), addresses.
6. Insert reservations.
7. Conditionally increment `reserved` — the guard that prevents overselling.
8. Insert order events and audit rows.

Any failed statement rolls back the batch. A partially created order that has
reserved stock is worse than no order.

**Payment verification.** Staff-only, permission-checked, step-up authenticated,
recorded in payment history, order events and the audit log.

**Reservation expiry.** Cron every five minutes: find expired unpaid
reservations, conditionally claim each one, confirm payment is not verified,
release stock, write the movement and events. Idempotent, so an overlapping run
is harmless. The claim step is what stops the sweeper and a staff verification
from both acting on the same order.

## Content strategy

| Content | Where |
|---|---|
| Interface strings | `app/locales/it.json`, `en.json` |
| Product and page content | D1, editable in admin, translatable |
| Merchant settings | `store_settings`, admin-edited |
| Legal documents | D1, versioned |

No user-visible string is hardcoded in a component.

## Testing strategy in one line each

- **Unit** (Node): domain rules, no bindings.
- **Integration** (workerd + real D1 + real migrations): repositories, batch
  rollback, conditional writes, RBAC, cron.
- **Security** (workerd): authz, IDOR, tampering, uploads, CSV, enumeration.
- **Browser** (Playwright + axe): the flows a customer actually walks.

A mocked database would happily accept the oversell this project exists to
prevent, which is why integration tests run against real D1.
