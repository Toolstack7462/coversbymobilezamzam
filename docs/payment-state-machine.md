# Payment state machine

Payment status answers **"has the money arrived, and how do we know?"**

The second half is the important part. Every state here is a statement about what
a human has or has not confirmed against the real bank account or merchant app.

---

## States

| State                       | Meaning                                                                     |
| --------------------------- | --------------------------------------------------------------------------- |
| `awaiting_customer_contact` | Order placed; instructions not yet delivered.                               |
| `awaiting_payment`          | Instructions delivered; nothing received.                                   |
| `proof_received`            | Customer supplied a screenshot or reference. **Proves nothing on its own.** |
| `under_verification`        | A staff member is actively checking the real account.                       |
| `verified`                  | An authorised human confirmed the money is in the account.                  |
| `partially_paid`            | Less than the total arrived.                                                |
| `overpaid`                  | More than the total arrived.                                                |
| `rejected`                  | Checked and not found, or the claim was wrong.                              |
| `expired`                   | Payment window elapsed.                                                     |
| `refunded`                  | Money returned.                                                             |
| `cancelled`                 | Payment abandoned with the order.                                           |

---

## Transitions

    awaiting_customer_contact ──► awaiting_payment ──► expired
                                        │  ▲                │
                                        │  └────────────────┘
                                        │       (reopened by staff)
                                        ▼
                                 proof_received
                                        │
                                        ▼
                                 under_verification
                                        │
                    ┌───────────┬───────┴───────┬──────────────┐
                    ▼           ▼               ▼              ▼
                verified   partially_paid   overpaid       rejected
                    │           │               │              │
                    │           └───────┬───────┘              ▼
                    │                   ▼                awaiting_payment
                    │              verified
                    ▼
                refunded

`under_verification` is an optional waypoint, not a mandatory one.

Staff may record an outcome directly from `awaiting_payment` or
`proof_received`. The actual checking happens in the bank or merchant app —
outside this system — so requiring a separate click to announce "I am now
checking" would be ceremony that staff learn to skip. The state remains useful
for signalling "someone is already looking at this" on a shared queue.

This does not weaken the rule: reaching `verified` still requires
`payment.verify`, a consumed step-up, a recorded amount and a reference.

`cancelled` is reachable from any non-terminal state.

---

## The rule that governs everything else

**`verified` is only reachable through the verification use case**, which
requires all of:

- an authenticated staff user holding `payment.verify`;
- a valid step-up authentication within the step-up window;
- an amount received;
- a transaction reference, or an explicit written reason for its absence;
- a recorded timestamp and verifying user.

No automatic path exists. Not from an uploaded proof, not from a matching amount,
not from a WhatsApp click. A screenshot is an image; it is trivially edited and
says nothing about settlement.

**`verified` does not transition back to `awaiting_payment`.** Correcting a
mistaken verification requires a privileged correction event which records the
reversal alongside the original. Silently un-verifying an order would erase the
evidence that someone got it wrong.

---

## Partial and over payment

Both are real and both are common with manual transfers — a customer rounds down,
or pays two orders in one transfer.

`partially_paid` keeps the reservation alive and surfaces the shortfall to staff
with the exact amount. `overpaid` records the excess and flags a refund decision.
Neither is resolved automatically, because the resolution is a conversation.

---

## Duplicate references

A transaction reference that already exists on another order is **flagged, not
rejected**. Duplicates are frequently legitimate — one transfer covering two
orders, or a customer reusing a reference by mistake.

Auto-rejecting would block real payments. The queue shows the collision and a
human decides.

---

## Reservation windows

Configurable per payment method. Defaults:

| Method                 | Minutes   | Reasoning                                             |
| ---------------------- | --------- | ----------------------------------------------------- |
| Satispay               | 120       | Instant; a customer who means to pay does so quickly. |
| Instant SEPA           | 120       | Arrives in seconds.                                   |
| BANCOMAT Pay           | 120       | Instant.                                              |
| Ordinary SEPA transfer | 1440      | Genuinely takes a working day.                        |
| Pay at pickup          | 1440–2880 | The customer must physically travel.                  |

Displayed as an exact local time — _"Prodotti riservati fino al 30 agosto 2026,
ore 18:30."_ — never as a ticking countdown. The deadline is real information;
a countdown is a pressure device.

---

## Every transition writes

`payment_status_history` · `order_events` · `audit_logs` (for verify, reject,
refund and correction).

---

## Implementation

`app/domain/payments/status.ts`. Tested in
`tests/unit/state-machines.test.ts` and `tests/security/payment-verification.test.ts`.
