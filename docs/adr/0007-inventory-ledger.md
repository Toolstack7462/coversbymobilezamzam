# ADR 0007 — Inventory as a ledger with explicit reservations

**Status:** Accepted · 2026-08-30

## Context

One physical stock is sold through two channels. Orders are created before
payment arrives, so goods must be held for hours or a day without being paid for.
The shop must never sell the same unit twice, and must be able to explain any
discrepancy.

## Decision

`inventory_levels` holds counters (`on_hand`, `reserved`, `incoming`).
`stock_movements` and `stock_reservations` hold the events.
`available = on_hand − reserved`.

Every change writes an event. Reservations are made by **conditional write**:

    UPDATE inventory_levels
       SET reserved = reserved + :qty
     WHERE variant_id = :v AND location_id = :l
       AND reserved + :qty <= on_hand

Zero rows affected means the stock is gone and the order batch rolls back.

## Alternatives considered

**A single `quantity` column, decremented on order.** Simplest. Rejected on both
counts that matter: an unpaid order that expires must return stock, and with one
counter there is no way to distinguish "sold" from "held". A discrepancy also
becomes unexplainable — you know the number is wrong and cannot find out when it
changed.

**Read available, then write.** Rejected: there is a window between the read and
the write. Two requests both read `available = 1` and both proceed. This is the
classic oversell, and it appears exactly when it hurts — the last unit of a
popular item.

**Optimistic locking with a version column.** Workable, but it needs retry logic
in the caller and it fails on contention rather than resolving it. The
conditional write puts the decision in the database and needs no retry.

**Durable Object per variant.** Strong serialisation. Rejected for now — see ADR 0003. The condition for revisiting is measured contention, not anticipated scale.

**Reserve only after payment.** Rejected: with manual payment that is up to 24
hours later. The customer would be told at verification time that the item they
"bought" is gone.

## Consequences

**Good.** Overselling is structurally prevented and proven by a concurrency test.
Every quantity is explainable from its history. Expiry returns stock
automatically. Shop and online cannot double-count the same shelf.

**Bad.** `stock_movements` grows without bound. Two things to keep in step,
so drift is possible. Every stock path is more code than `SET quantity = ?`.
Held stock is unavailable to walk-in customers while an order sits unpaid.

**Mitigations.** `CHECK (reserved >= 0 AND reserved <= on_hand)` as a loud
backstop. `reconcile-inventory.mjs` replays the ledger and reports drift rather
than silently correcting it. Reservation windows are short for instant payment
methods, so the shop floor is not starved. Movement archival is documented for
when the table gets large.

## Rollback

None sensible. Removing the ledger would remove the guarantee this design exists
to provide.
