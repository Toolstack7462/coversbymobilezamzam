# Inventory and reservations

One real stock of goods, sold through two channels. The hard requirement is that
the shop never sells the same unit twice.

---

## Locations

| Location              | Role                                              |
| --------------------- | ------------------------------------------------- |
| Sulmona Physical Shop | The shop floor and back room                      |
| Online Fulfilment     | Optional, only if online stock is held separately |
| Returns               | Received returns pending inspection               |
| Damaged / Quarantine  | Not sellable                                      |
| Incoming              | Ordered from suppliers, not arrived               |

### One stock or two — the merchant's choice

Either a single shared location for shop and online, or separate physical and
online locations.

**The same physical unit is never counted in two locations.** That is the failure
mode this design exists to prevent: two independent counters over one shelf means
selling the same case twice and telling one customer it is not available after
they have paid.

Most small shops should use one shared location. The admin says so.

---

## Levels

| Field               | Meaning                                                                         |
| ------------------- | ------------------------------------------------------------------------------- |
| `on_hand`           | Physically present                                                              |
| `reserved`          | Committed to unpaid orders                                                      |
| `available`         | `on_hand − reserved` — the only number a customer's purchase is checked against |
| `incoming`          | Expected from suppliers                                                         |
| `reorder_threshold` | Low-stock alert point                                                           |
| `allow_backorder`   | Whether to sell beyond available                                                |

---

## Movement types

`supplier_receipt` · `online_sale` · `counter_sale` · `pickup_reservation` ·
`pickup_collection` · `customer_return` · `transfer_out` · `transfer_in` ·
`manual_adjustment` · `damaged` · `lost` · `reservation_release` ·
`cancellation` · `correction`

Every manual adjustment requires a reason, a staff user, a timestamp, and the
before and after quantities. "The count was wrong" is not a reason; "counted 3,
system said 5, two missing after stocktake" is.

---

## Preventing oversell

The guard is the **CHECK constraint**, enforced inside a D1 batch:

    -- schema
    CHECK (reserved >= 0 AND reserved <= on_hand)

    -- inside the order batch
    UPDATE inventory_levels
       SET reserved = reserved + :qty
     WHERE variant_id = :v AND location_id = :l

If the increment would oversell, the constraint **raises an error**, the
statement fails, and D1 rolls back the entire batch. No order, no reservation,
nothing partial.

### Why not `WHERE reserved + :qty <= on_hand`

That was the original design, and it is wrong _inside a batch_. A conditional
UPDATE that matches nothing is not an error: it succeeds with `changes = 0`. The
batch would commit happily, leaving an order that holds stock nobody reserved —
silently, with no failure anywhere to notice.

Because D1 has no interactive transactions, there is no opportunity to inspect
`changes` and abort mid-batch. The condition therefore has to be expressed as
something that _throws_, and a CHECK constraint is exactly that.

Check-then-write in application code is worse again: there is a window between
the read and the write in which another request can take the last unit.

This is verified, not assumed. `tests/integration/concurrency.test.ts` fires two
simultaneous orders for the final unit and asserts exactly one succeeds, that
`reserved` never exceeds `on_hand`, and that the loser leaves behind no order,
no line items and no reservation.

The pre-check in the order use case still exists, but only to produce a useful
message and to catch a missing inventory row. It does not prevent the race.

`tests/integration/concurrency.test.ts` fires two simultaneous attempts at the
final unit and asserts exactly one succeeds and `reserved` never exceeds
`on_hand`.

---

## Order creation is one batch

    1  Claim idempotency key
    2  Re-read authoritative prices
    3  Re-read authoritative stock
    4  Validate requested quantities
    5  Insert order
    6  Insert order items (snapshotted)
    7  Insert reservations
    8  Conditional reserved increment  ← the guard
    9  Insert order events and audit rows

All in a D1 batch. Any failure rolls back everything. A partially created order
holding stock is worse than no order — it is invisible to staff and invisible to
the customer, and it silently removes a unit from sale.

---

## Reservation expiry

A Cron Trigger runs every five minutes, in UTC.

    1  Find reservations past expires_at, status active
    2  Conditionally claim each one   (UPDATE ... WHERE status='active')
    3  Re-check that payment is NOT verified
    4  Release stock: reserved = reserved - qty
    5  Mark reservation expired
    6  Update order and payment status
    7  Write stock movement, order event, audit row

**Steps 2 and 3 are the whole design.** The conditional claim means two
overlapping cron runs cannot both release the same reservation. The payment
re-check _after_ claiming closes the race where a customer pays at minute 119 and
staff verify at minute 121 — without it, the sweeper would release stock from
under an order that is now paid.

`tests/integration/expiry-race.test.ts` interleaves verification and expiry and
asserts the outcome is consistent either way: either the order is paid and stock
stays reserved, or it expired and stock was released. Never both.

---

## No fake countdowns

The customer sees an exact time:

> Prodotti riservati fino al 30 agosto 2026, ore 18:30.

Real, checkable, and honest. A ticking timer manufactures pressure, and under the
Unfair Commercial Practices Directive a fabricated deadline is a prohibited
practice. This one is genuine — but it is still shown as information, not as a
device.

---

## Reconciliation

`inventory_levels` counters serve reads; `stock_movements` explains them.
`scripts/verify/reconcile-inventory.mjs` replays the ledger and compares.

Any drift is a bug. The ledger wins, and the discrepancy is reported rather than
silently corrected — silently fixing a symptom hides its cause.
