# Hostinger admin benchmark

Research for the **Merchant Control Centre** milestone. The goal is to reach
Hostinger Store Manager's _ease of use_ for a non-technical shopkeeper, without
adopting its data model, its shortcuts, or anything of its visual identity.

---

## 1. Sources inspected

Public Hostinger support documentation only, fetched 2026-08-31:

| Topic                       | URL                                                                    |
| --------------------------- | ---------------------------------------------------------------------- |
| What is Hostinger Ecommerce | `/support/hostinger-ecommerce-what-is-hostinger-ecommerce/`            |
| Adding products             | `/support/6538344-…-how-to-add-products/`                              |
| Managing orders             | `/support/6539027-…-how-to-manage-orders-in-the-online-store/`         |
| Store settings              | `/support/6538340-…-how-to-access-the-online-store-settings/`          |
| Manual/offline payments     | `/support/6538417-…-how-to-enable-manual-offline-payments/`            |
| Shipping setup              | `/support/6538842-…-how-to-set-up-shipping/`                           |
| Discount codes              | `/support/6539054-…-how-to-create-discount-codes-in-the-online-store/` |

**No Hostinger account was accessed, no authentication was attempted, and no
private interface was inspected.** Everything below comes from documentation
Hostinger publishes openly.

The settings article turned out to describe navigation rather than the settings
screen itself, so the settings-hub design here is derived from our own domain
rather than from theirs. Recorded because an absence of evidence should be
stated, not filled in from imagination.

---

## 2. Patterns observed

**Onboarding is a short, finite checklist.** Four business questions, then:
add products, set up payments, configure shipping, add business details,
publish. The merchant is never dropped into an empty dashboard with no next
step.

**Overview is metrics plus recent orders**, filtered by sales channel, with
period-over-period comparison.

**Orders use status tabs as saved views** — All, Unfulfilled, Partially
fulfilled, Fulfilled, Cancelled — rather than a filter panel the merchant has to
assemble.

**Order detail carries private merchant notes**, explicitly not visible to the
customer.

**Manual payments are two fields and a toggle**: a customer-facing method name,
free-text instructions shown at checkout and in the confirmation email, and
"enable at checkout". Orders land in _Awaiting_; a merchant changes the status
to _Paid_ by hand.

**Product creation is one long form**, not a wizard: type, basics, pricing,
inventory, options, categories. Variants are a unified "options" system, up to
50 per product.

**Discounts** carry a public code, an optional internal name, a scope (all
products or categories), optional usage cap and minimum order, a schedule, and a
status of expired / active / scheduled.

**Shipping** is zones containing flat-rate options with optional value or weight
conditions.

---

## 3. Adopted

| Pattern                                                                          | Why it earns its place here                                                                                                               |
| -------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| **Computed setup checklist**                                                     | A shopkeeper opening an empty admin needs a next action, not a blank canvas. Ours is _derived from data_, never stored booleans — see §7. |
| **Status tabs as saved views**                                                   | A merchant thinks "show me what needs paying", not "add filter → status → equals → awaiting".                                             |
| **Overview = metrics + what needs doing + recent orders**                        | The right shape for a daily open-the-laptop screen.                                                                                       |
| **Private merchant notes on orders**                                             | Genuinely needed, and we already separate internal from customer-visible notes in the schema.                                             |
| **Manual payments: method name + instructions + enable toggle**                  | Exactly the right minimum. We keep it and add the parts that protect the merchant.                                                        |
| **Discount fields** (code, internal name, scope, cap, minimum, schedule, status) | A well-shaped model; ours matches it and adds a server-side snapshot on the order.                                                        |
| **Shipping: zones → options → flat rate + conditions**                           | Simple and sufficient for one Italian shop.                                                                                               |
| **Settings consolidated into one destination**                                   | Rather than scattered across pages.                                                                                                       |
| **Empty states that teach**                                                      | Instead of an empty table.                                                                                                                |

---

## 4. Rejected

| Pattern                                                             | Why it is refused                                                                                                                                                                                                                                                                                                                                                                                       |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **"AI will generate the product details from the uploaded images"** | This is the single most dangerous idea in the source material for _this_ shop. Generated text becomes a specification, and a specification becomes a compatibility claim. A hallucinated "compatible with iPhone 16 Pro" costs a return, a refund and a review. Any AI assistance here stays a visibly-marked draft suggestion, and may never produce specifications, compatibility, or certifications. |
| **Single long product form**                                        | Our product carries variants, device compatibility with verification provenance, category-specific specifications, GPSR safety data and dual-language content. One page would be a wall. A six-step wizard with autosave is the honest shape for this data.                                                                                                                                             |
| **"Change payment status to Paid" from a dropdown**                 | This is the crux. Marking money received is a claim about the outside world, so ours requires `payment.verify`, a consumed step-up, the amount actually seen, a transaction reference or a written reason, and it writes an immutable audit row. A dropdown is not a control.                                                                                                                           |
| **Automatic 24-hour inventory reservation as hidden behaviour**     | Ours is explicit, configurable per payment method, shown to the customer as a real deadline, and released by an idempotent sweeper.                                                                                                                                                                                                                                                                     |
| **Product types we do not sell**                                    | Digital, appointments, donations, gift cards, print-on-demand. Every unused type is a field a shopkeeper has to ignore forever.                                                                                                                                                                                                                                                                         |
| **Email-marketing dashboard**                                       | No email provider is configured, and a marketing surface that cannot send is a lie.                                                                                                                                                                                                                                                                                                                     |
| **Sales-channel switcher**                                          | One channel.                                                                                                                                                                                                                                                                                                                                                                                            |
| **Sparkline charts on every metric**                                | With a handful of orders a day, a sparkline is decoration that implies a trend the data cannot support.                                                                                                                                                                                                                                                                                                 |
| **Purple**                                                          | We have our own art direction. Copying a palette is the laziest form of imitation and would make the product look like a clone of something it is not.                                                                                                                                                                                                                                                  |
| **Print-on-demand / TikTok Shop / Printful integrations**           | Out of scope, and each would be an integration card that never connects.                                                                                                                                                                                                                                                                                                                                |

---

## 5. Irrelevant to this merchant

Multi-store management, multi-currency, appointment booking, digital-file
delivery, Baltic parcel-locker carriers, review collection via automated email,
and anything assuming a fulfilment centre. This is one shop in Sulmona with a
counter and a stockroom.

---

## 6. Originality safeguards

- **No Hostinger source code, markup, CSS, images, icons, fonts or copy is
  present in this repository.** Nothing was downloaded from their product.
- Only _public support documentation_ was read, and only for interaction
  concepts — the same way one reads a book about shop layout.
- Colours, type, spacing, radii and component shapes come from the existing
  Italian Tech Atelier token set, which predates this research.
- All interface text is written in Italian for this merchant, from scratch.
- Icons are drawn inline from the project's own set.
- Navigation labels follow **our** domain (Compatibilità, Ritiri in negozio,
  Prenotazioni, Movimenti) — vocabulary Hostinger has no equivalent for, because
  it has no equivalent features.
- The wizard structure is driven by our data model, not theirs.

A reasonable observer comparing the two admins would find the concepts familiar
— checklists, tabs, tables — because those are the common vocabulary of admin
software, not Hostinger's invention. Nothing distinctive to Hostinger appears.

---

## 7. How this improves on the benchmark

These are not embellishments; each exists because a shopkeeper selling phone
accessories has a problem Hostinger's model does not address.

**Structured device compatibility.** Hostinger has no concept of it. A cover
either fits an iPhone 16 Pro or it does not, and the difference is a return.
Ours is a first-class record with a verification source, a verifier and a
timestamp, and a resolver whose invariants are unit-tested — including that
`universal` can never resolve to exact fit.

**An inventory ledger, not a counter.** Hostinger offers a "track quantity"
toggle. Ours writes a movement for every change and a reservation for every
hold, so a discrepancy is explainable months later rather than merely visible.

**Atomic reservations.** Proven by a concurrency test in which two simultaneous
orders for the last unit produce exactly one sale.

**Payment verification as a control, not a status.** Permission, step-up,
amount reconciliation, duplicate-reference flagging, immutable audit. An
uploaded proof moves an order to "there is something to look at" and no further.

**A computed setup checklist.** Hostinger's onboarding is a list of steps.
Ours is derived from the database on every load, so it cannot say "done" when
the underlying data is missing — a checkbox someone ticked is not evidence.

**Mandatory TOTP for privileged roles, RBAC, immutable audit.**

**Real physical-store pickup.** Readiness is recorded by a person who put the
item aside, never inferred from online stock.

**Price history** sufficient to evidence a 30-day prior price, because Italian
law (D.Lgs. 84/2022) requires it before a discount may be announced.

**The merchant owns all of it** — source, schema, data, deployment.

---

## 8. Screenshots and internal references

**No Hostinger screenshots were captured, stored, or committed.** The
documentation was read as text via a fetch tool; the findings in §2 are the
research artefact, in our own words. Nothing of theirs is retained in this
repository — which also means there is nothing to accidentally ship.

---

## 9. Statement

**No Hostinger asset, image, icon, font, stylesheet, markup fragment, source
file, brand element or copy text ships in this product, in this repository, or
in any build artefact.**

The research informed _what problems the interface should solve and in what
order_. Every line of the implementation is original work built on this
project's own design system and domain model.
