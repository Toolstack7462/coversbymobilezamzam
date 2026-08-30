# ADR 0005 — Modular monolith with a pure domain layer

**Status:** Accepted · 2026-08-30

## Context

The system spans catalogue, compatibility, pricing, inventory, cart, orders,
payments, fulfilment, content and users. Several rules — price resolution,
availability, compatibility — must give the **same answer** in the storefront,
the admin, the API and scheduled jobs.

## Decision

A modular monolith with four layers and inward-pointing dependencies:

    routes / components  →  application  →  domain
                                ↓
                        infrastructure (implements ports)

**The domain layer imports nothing but TypeScript and Zod.** No React, no
Cloudflare bindings, no Drizzle, no route modules.

Ports for: product, inventory, order and payment repositories, media storage,
email, audit logging, clock, id generation, encryption and search.

## Alternatives considered

**Microservices.** Rejected outright. Order creation plus stock reservation is
one transaction; splitting it across services turns a database batch into a saga
with compensating actions, for a shop taking a handful of orders a day. All cost,
no benefit.

**Conventional framework layout — logic in loaders and components.** The default
React Router shape, and fastest initially. Rejected: it is precisely how the same
price rule ends up implemented twice, slightly differently, in cart and checkout.
It also makes domain rules untestable without a request.

**Full hexagonal architecture with a DI container.** Rejected as ceremony. Ports
are plain interfaces and adapters are passed explicitly; a container would add
indirection without buying testability that is already there.

## Consequences

**Good.** Domain rules unit-test in milliseconds with no bindings. One
implementation per rule, used by every caller. Infrastructure is swappable —
which is what makes ADR 0002's lock-in tolerable. Boundaries are enforceable in
review because they are directional.

**Bad.** More files and more indirection than putting a query in a loader.
Mapping between database rows and domain types is real work. New contributors
must learn where things go.

**Mitigations.** `CLAUDE.md` states the boundaries as rules with a "never/instead"
table. A read-only architecture reviewer checks for violations. The practical
test is memorable: **if a domain test needs a binding, the code is in the wrong
layer.**

## Rollback

Collapsing layers later is mechanical — inline the use cases. Recovering
boundaries after building without them is not, which is why they exist from the
start.
