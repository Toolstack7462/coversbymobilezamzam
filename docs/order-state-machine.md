# Order state machine

Order status answers **"where is this order in its life?"** — nothing else.
Whether money arrived is `docs/payment-state-machine.md`; whether goods moved is
`docs/fulfilment-state-machine.md`.

Keeping them separate is what lets an order be `paid` but not yet
`ready_for_pickup`, or `shipped` and then `partially_refunded`, without inventing
composite states.

---

## States

| State                             | Meaning                                                                      |
| --------------------------------- | ---------------------------------------------------------------------------- |
| `draft`                           | Being assembled. Not customer-visible. No stock held.                        |
| `awaiting_customer_contact`       | Created; customer has not yet been given instructions. **Stock reserved.**   |
| `awaiting_payment`                | Instructions delivered; waiting for the customer to pay. **Stock reserved.** |
| `payment_under_review`            | Staff are checking the real account. **Stock reserved.**                     |
| `paid`                            | Payment verified by an authorised human.                                     |
| `processing`                      | Being prepared.                                                              |
| `ready_for_pickup`                | Waiting in the shop.                                                         |
| `shipped`                         | Handed to the carrier.                                                       |
| `delivered`                       | Received.                                                                    |
| `collected`                       | Picked up in store. Terminal for pickup.                                     |
| `cancelled`                       | Ended before fulfilment. Stock released.                                     |
| `expired`                         | Reservation window elapsed unpaid. Stock released.                           |
| `return_requested`                | Customer asked to return.                                                    |
| `returned`                        | Goods back.                                                                  |
| `partially_refunded` / `refunded` | Money returned in part or full.                                              |

---

## Transitions

    draft ──────────────► awaiting_customer_contact
                                   │
                                   ▼
                          awaiting_payment ──────► expired
                            │        │
                            │        ▼
                            │  payment_under_review ──► awaiting_payment
                            │        │                   (proof rejected)
                            ▼        ▼
                              paid ─────► processing
                                            │
                              ┌─────────────┼─────────────┐
                              ▼             ▼             ▼
                      ready_for_pickup   shipped      (digital n/a)
                              │             │
                              ▼             ▼
                          collected     delivered
                                            │
                              ┌─────────────┴──────────┐
                              ▼                        ▼
                      return_requested ──► returned ──► refunded
                                                   └──► partially_refunded

`cancelled` is reachable from `awaiting_customer_contact`,
`awaiting_payment`, `payment_under_review`, `paid` and `processing`.

Anything else is rejected by `assertTransition()`.

---

## Rules

**Reserving states.** `awaiting_customer_contact`, `awaiting_payment` and
`payment_under_review` hold stock. Entering `cancelled` or `expired` from any of
them releases it, exactly once.

**`paid` requires human verification.** It is reachable from
`awaiting_customer_contact`, `awaiting_payment` or `payment_under_review` — the
confirmation page carries the payment instructions, so a customer can pay before
the shop has contacted them, and forcing an intermediate hop would make the
status lie about what happened.

Whichever state it comes from, it is reachable **only** through the verification
use case, which requires `payment.verify`, a consumed step-up, a recorded amount
and a reference (invariant 6).

**`expired` requires unverified payment.** The sweeper re-checks payment status
_after_ claiming the reservation. Without that check, a customer who pays at
minute 119 and staff who verify at minute 121 could have their stock released out
from under a verified order.

**Terminal states** are `cancelled`, `expired` and `refunded` only.

`delivered` and `collected` are **fulfilled, not terminal**. The customer has 14
days to withdraw under the Codice del Consumo, so a returns path leads out of
both — treating them as terminal would make a lawful return impossible to
record. `returned` and `partially_refunded` may still progress to `refunded`.

**Pay-at-pickup** still reserves stock and still requires a human to record both
collection and payment.

---

## Every transition writes three rows

1. `order_status_history` — from, to, actor, reason, timestamp.
2. `order_events` — the customer-facing timeline.
3. `audit_logs` — when the transition is sensitive (cancel, refund, paid).

An order whose current status cannot be explained from its own history is a bug.

---

## Order numbers

Format `ITA-YYYYMMDD-XXXXXX`, e.g. `ITA-20260830-AB12CD`.

The suffix is six characters from a Crockford-style alphabet with `I`, `L`, `O`
and `U` removed — `O`/`0` and `I`/`1` confusions are guaranteed when a number is
read aloud over the phone or written on a transfer _causale_.

The number is public and appears in the payment reference. It is **not** the
tracking token: an order number is guessable by date, so order tracking uses a
separate 32-character random token (see `docs/security-threat-model.md`).

Internal ids are never exposed publicly.

---

## Implementation

`app/domain/orders/status.ts` — the transition map and `assertTransition()`.
Pure, no I/O. `tests/unit/state-machines.test.ts` asserts every legal transition
is allowed and that the full cartesian product of illegal ones is refused.
