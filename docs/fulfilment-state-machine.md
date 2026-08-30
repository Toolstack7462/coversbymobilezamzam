# Fulfilment state machine

Fulfilment answers **"where are the goods?"** It is separate from payment because
the two genuinely move independently: pay-at-pickup is fulfilled before it is
paid, and a shipped order can be paid weeks earlier.

---

## States

| State                | Meaning                                   |
| -------------------- | ----------------------------------------- |
| `pending`            | Nothing prepared.                         |
| `awaiting_stock`     | Something is short; a decision is needed. |
| `picking`            | Being gathered in the shop.               |
| `packed`             | Ready to hand over or ship.               |
| `ready_for_pickup`   | Waiting in store, customer notified.      |
| `handed_to_carrier`  | Given to the courier.                     |
| `in_transit`         | With the carrier.                         |
| `delivered`          | Received by the customer.                 |
| `collected`          | Picked up in store.                       |
| `not_collected`      | Pickup window elapsed.                    |
| `cancelled`          | Fulfilment abandoned.                     |
| `returned_to_sender` | Delivery failed.                          |

---

## Two routes

**Pickup**

    pending → picking → packed → ready_for_pickup → collected
                                        └─────────► not_collected

**Shipping**

    pending → picking → packed → handed_to_carrier → in_transit → delivered
                                                          └────► returned_to_sender

`awaiting_stock` is reachable from `pending` or `picking` and returns to
`picking` once resolved. `cancelled` is reachable from any non-terminal state.

---

## Rules

**Fulfilment does not start before payment is settled** — except pay-at-pickup,
where preparation is the whole point and payment happens at the counter. This is
a configured property of the payment method, not a hardcoded branch.

**`ready_for_pickup` is a fact, not a promise.** It is set by a staff member who
has physically put the item aside. The site never infers pickup readiness from
online stock, and never displays "ready today" speculatively.

**`collected` requires staff action.** For pay-at-pickup it is recorded together
with payment receipt in one authorised step, so the two cannot drift apart.

**`not_collected` does not automatically restock.** An uncollected order needs a
human decision — contact the customer, extend, or return to shelf — and each of
those writes its own movement.

**Partial fulfilment** is supported through multiple `fulfilments` rows against
one order, each with its own state and its own line items.

---

## Shipping in Phase 1

No courier integration. `shipments` carries an optional carrier name and tracking
number, entered by staff. If a tracking number is present the customer sees it;
if not, they see the status only.

The site never invents a delivery date. Shipping copy states the dispatch policy
the merchant configured, not an arrival guarantee, because nothing here can know
when a parcel will arrive.

---

## Implementation

`app/domain/fulfilment/status.ts`. Tested in `tests/unit/state-machines.test.ts`.
