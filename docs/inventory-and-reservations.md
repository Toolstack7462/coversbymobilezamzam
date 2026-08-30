# Inventory and reservations

One real stock of goods, sold through two channels. The hard requirement is that
the shop never sells the same unit twice.

---

## Locations

| Location | Role |
|---|---|
| Sulmona Physical Shop | The shop floor and back room |
| Online Fulfilment | Optional, only if online stock is held separately |
| Returns | Received returns pending inspection |
| Damaged / Quarantine | Not sellable |
| Incoming | Ordered from suppliers, not arrived |

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

| Field | Meaning |
|---|---|
| `on_hand` | Physically present |
| `reserved` | Committed to unpaid orders |
| `available` | `on_hand − reserved` — the only number a customer's purchase is checked against |
| `incoming` | Expected from suppliers |
| `reorder_threshold` | Low-stock alert point |
| `allow_backorder` | Whether to sell beyond available |

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

The mechanism is a **conditional write**, not a read-then-write:

    UPDATE inventory_levels
       SET reserved = reserved + :qty
     WHERE variant_id = :v
       AND location_id = :l
       AND reserved + :qty <= on_hand

If it affects zero rows, the stock is gone and the whole order batch rolls back.

Check-then-write has a window between the check and the write. Two requests can
both read `available = 1` and both proceed. Putting the check in the `WHERE`
clause makes the database arbitrate, and SQLite serialises writes, so exactly one
wins.

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
re-check *after* claiming closes the race where a customer pays at minute 119 and
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
