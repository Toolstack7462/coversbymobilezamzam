---
name: inventory-and-reservations
description: Inventory ledger discipline and oversell prevention. Use when touching stock, reservations, order creation or the expiry sweeper.
---

# Inventory and reservations

`available = on_hand - reserved`. Only `available` is checked against a purchase.

## Never write stock directly

Every change writes a `stock_movements` row. Every hold writes a
`stock_reservations` row. Manual adjustments additionally require a reason, a
staff user, and before/after quantities. Repositories expose no bare setter.

## Oversell prevention

The **CHECK constraint** is the guard, inside a D1 batch:

    CHECK (reserved >= 0 AND reserved <= on_hand)

    UPDATE inventory_levels SET reserved = reserved + ?
     WHERE variant_id = ? AND location_id = ?

An increment that would oversell RAISES, which rolls the whole batch back.

Do NOT "improve" this into `WHERE reserved + ? <= on_hand`. Inside a batch a
conditional update matching nothing is a silent success (`changes = 0`), the
batch commits, and an order exists holding stock nobody reserved. D1 has no
interactive transactions, so there is no chance to inspect `changes` and abort.
The condition has to throw.

Read-then-write is worse again: a window where two requests both see the last
unit.

## Order creation is one batch

Claim idempotency key, re-read prices, re-read stock, validate, insert order,
insert snapshotted items, insert reservations, **conditional reserved
increment**, insert events. Any failure rolls back everything.

## The expiry sweeper

Cron, UTC, every five minutes:

1. Find expired active reservations.
2. **Conditionally claim** each one.
3. **Re-check payment is not verified** — after claiming.
4. Release stock, mark expired, update statuses, write movement and events.

Steps 2 and 3 are the whole design. Step 2 stops two overlapping runs releasing
the same reservation. Step 3 stops the sweeper releasing stock from an order that
a staff member verified moments earlier.

## Display

Exact expiry time: _Prodotti riservati fino al 30 agosto 2026, ore 18:30._
Never a ticking countdown. The deadline is information, not a pressure device.

## Reconciliation

Counters serve reads; the ledger explains them. On drift the **ledger wins**, and
the discrepancy is reported rather than silently corrected.
