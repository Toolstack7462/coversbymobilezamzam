# Vision and scope

## The business

A mobile-phone-accessories retailer in Sulmona (AQ), Abruzzo, selling through a
physical shop and, from this project, online. Cases, screen protectors, chargers,
cables, power banks, magnetic accessories, audio, car mounts, smartwatch and
tablet accessories.

Two things decide whether this succeeds, and neither is "having a website":

**Compatibility.** A customer must never have to guess whether a case, cable or
charger fits their exact phone. Getting this wrong produces returns, refunds and
a support burden the shop cannot absorb. It is the single hardest data problem
here, and it is why compatibility is a first-class domain concept rather than a
tag.

**Local trust.** The shop is the advantage over Amazon and AliExpress. Someone
who can collect today, or walk in if something is wrong, is buying something a
marketplace cannot sell. The shop belongs throughout the experience, not on a
contact page.

## What Phase 1 is

An operating store that takes **structured orders**, reserves stock against them,
and hands the customer to a human to complete payment.

    Catalogue → Product → Cart → Details → Delivery or pickup
      → Manual payment method → Conferma l'ordine → Stock reserved
      → Confirmation → WhatsApp → Customer pays externally
      → Staff verify against the real bank or merchant app → Fulfilment

The website never touches money. It records intent precisely, holds inventory
honestly, and gives staff the tools to verify and fulfil.

### Why no payment gateway yet

Deliberate, not a shortcut. Card acceptance in Italy means merchant onboarding,
PSD2/SCA handling, chargeback exposure, fiscal-receipt obligations and per-
transaction cost. None of that is a prerequisite for selling, and all of it is a
prerequisite for doing card payments _properly_.

Meanwhile SEPA transfer, instant transfer, Satispay and pay-at-pickup are how a
great many small Italian retailers already get paid, and they cost nothing.

The architecture assumes a gateway arrives later: payment methods are records,
payment status is its own state machine, and the order lifecycle does not care
who moved the money. Adding Stripe becomes a new adapter, not a rewrite.

## Operating goals

- No ecommerce platform subscription.
- Free-tier infrastructure where practical.
- Merchant edits products, prices, stock, compatibility and content without a
  developer.
- Online delivery and in-store pickup from one inventory truth.

## In scope

Catalogue with variants · device compatibility · device finder · search with
Italian synonyms · faceted listings · cart · guest checkout · shipping and
pickup · order state machines · manual payments · WhatsApp handoff · payment
verification queue · inventory ledger with reservations · price history ·
promotions · returns · CMS · Italian/English · SEO · legal surfaces · custom
admin with RBAC · import/export · audit log · backup/restore.

## Explicitly out of scope for Phase 1

| Not building                                | Why                                                                                                                                                                      |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Card payments, any gateway or SDK           | See above.                                                                                                                                                               |
| WhatsApp Business Platform API              | Click-to-Chat only. No programmatic reading of messages, and no claim of automatic payment confirmation.                                                                 |
| Courier integration                         | Configurable flat rates and thresholds instead.                                                                                                                          |
| Fiscal receipts / telematic corrispettivi   | A legal and accounting matter, not a web feature. The admin manages inventory and order state; it does **not** replace the fiscal POS. Flagged for the _commercialista_. |
| Analytics, marketing pixels, A/B tools      | None. Also means no consent banner is needed for tracking that does not exist.                                                                                           |
| Multi-currency, multi-country tax           | EUR and Italy. The money type carries a currency code so this is additive later.                                                                                         |
| Loyalty, subscriptions, marketplace sellers | Not the business.                                                                                                                                                        |
| Mobile app                                  | The site is responsive.                                                                                                                                                  |

## Definition of done for Phase 1

Not "it builds". The 25 launch gates in `docs/launch-checklist.md`, of which the
ones no amount of code can satisfy are:

- The merchant has supplied brand name, legal name, P.IVA, REA, WhatsApp number
  and at least one working payment method.
- An Italian lawyer has reviewed the consumer-facing legal content.
- A _commercialista_ has ruled on invoicing and fiscal obligations.
- A test restore from backup has actually been performed.

Until those hold, the status is **READY FOR MERCHANT REVIEW**, never "ready to
launch".
