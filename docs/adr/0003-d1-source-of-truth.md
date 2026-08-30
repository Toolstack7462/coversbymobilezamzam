# ADR 0003 — D1 is the single source of truth

**Status:** Accepted · 2026-08-30

## Context

Catalogue, compatibility, prices, inventory, orders, payments and content all
need somewhere authoritative to live. Inventory in particular must not oversell,
which means real transactional guarantees rather than eventual consistency.

## Decision

D1 is authoritative for all business data. Everything else — the FTS index,
rendered pages, cached fragments — is a rebuildable projection.

Concurrency is handled with **conditional writes** and D1 **batches**, not with a
separate coordination layer.

## Alternatives considered

**KV for hot reads.** Rejected as authoritative: KV is eventually consistent, so
two shoppers can both be told the last unit is available. Acceptable later as a
cache in front of D1, never as the truth.

**Durable Objects per variant for stock.** Strong serialisation, purpose-built
for exactly this. Rejected **for now**, deliberately: `UPDATE … WHERE reserved +
:qty <= on_hand` already makes overselling impossible, SQLite serialises writes,
and the concurrency test proves it. Durable Objects would add a second
consistency model, extra cost and more moving parts to solve a problem that is
already solved.

The condition for revisiting is explicit: **measured** write contention on
`inventory_levels` that D1 cannot absorb. Not a guess about scale.

**External Postgres via Hyperdrive.** More capable SQL. Rejected: a paid database
plus a paid connection layer, contradicting the cost constraint.

## Consequences

**Good.** One store, real transactions, all-or-nothing order creation. Free tier.
Backups are a single export. Integration tests run against real D1 with the real
migrations.

**Bad.** SQLite limits apply: constrained write concurrency, database size caps,
and no Postgres niceties (partial indexes with complex predicates, rich types,
`LISTEN/NOTIFY`). Long-running analytical queries do not belong here.

**Mitigations.** Indexes verified with `EXPLAIN QUERY PLAN`. Bulk imports
chunked. Reporting kept to aggregates over indexed columns. The `CHECK
(reserved <= on_hand)` constraint acts as a backstop that fails loudly if the
conditional write is ever bypassed.

## Rollback

Schema is standard SQL with Drizzle definitions. Moving to Postgres means a
dialect change in `drizzle.config.ts`, a migration translation, and a data
export/import — the repository interfaces above it do not change.
