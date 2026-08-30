# ADR 0006 — Manual payments, no gateway in Phase 1

**Status:** Accepted · 2026-08-30

## Context

The merchant wants to start selling without a card-payment gateway: no
subscription, no per-transaction fee, no merchant onboarding, no PSD2/SCA work,
no chargeback exposure. Italian small retailers routinely take SEPA transfer,
Satispay and cash at the counter.

## Decision

No payment gateway, no payment SDK, no card form, no payment webhook. The site
creates structured orders, reserves stock, and instructs the customer to pay
externally. **Only authorised staff may mark an order paid**, after checking the
actual bank account or merchant app.

## Alternatives considered

**Stripe or PayPal now.** Best customer experience, automatic reconciliation.
Rejected for Phase 1: per-transaction cost on thin accessory margins, merchant
onboarding the shop has not done, and a large compliance surface. Explicitly out
of scope in the brief.

**"Mark as paid" when a proof screenshot is uploaded.** Tempting, and it is what
a lot of small builds do. **Rejected as unsafe.** A screenshot is an image; it is
trivially edited, and it says nothing about settlement. Automating this would
mean goods leave the shop against a forged PNG. This is invariant 6, and it is
the single most important rule in the payment subsystem.

**Amount-matching against a bank feed.** Rejected: no bank API is in scope, and
amount matching alone is unreliable — customers round, combine orders, or omit
the _causale_.

**Cash on delivery via courier.** Rejected: no courier integration in Phase 1.

## Consequences

**Good.** Zero payment cost. No card data ever touches the system, so the entire
PCI question is absent. Works today with what the merchant already has. Staff
keep human judgement over partial payments, overpayments and duplicate
references — all of which are common and none of which automate well.

**Bad.** Manual work per order. Slower confirmation. Customers may abandon at the
handoff. Stock is held for up to 24 hours on unpaid orders. Reconciliation is
somebody's job, every day.

**Mitigations.** A purpose-built verification queue with everything needed on one
screen. Configurable reservation windows per method. An idempotent expiry sweeper
that returns stock automatically. A mandatory order-number _causale_ so transfers
can be matched. Duplicate references flagged for review rather than auto-rejected.

## Rollback / forward path

Adding a gateway later is additive by design. Payment methods are rows, payment
status is its own machine, and the order lifecycle does not care who moved the
money. Stripe becomes a new `payment_methods` row plus a webhook adapter that
performs the same `verified` transition the human currently performs — with the
verification metadata recording the gateway as the actor.
