# Source of truth

For every piece of data: which store is authoritative, what is derived, and how a
derived copy is rebuilt. Ambiguity here is how two screens end up disagreeing
about the price.

---

## The rule

**D1 is the source of truth for all business data.** Everything else is a
projection, a cache or a file, and every one of them must be rebuildable from D1
without loss.

---

## Authority table

| Data                             | Authoritative                              | Derived / copies               | Rebuild                             |
| -------------------------------- | ------------------------------------------ | ------------------------------ | ----------------------------------- |
| Products, variants, translations | D1                                         | FTS index, search results      | `npm run search:reindex`            |
| Prices                           | D1 `variant_prices`                        | Rendered price, order snapshot | Snapshot is history — never rebuilt |
| Price history                    | D1 `price_history`                         | Prior-price display            | Append-only, never recomputed       |
| Stock on hand                    | D1 `inventory_levels`                      | Availability badges            | Recomputed per request from ledger  |
| Reservations                     | D1 `stock_reservations`                    | `reserved` counter             | Reconciliation script compares them |
| Compatibility                    | D1 `product_compatibility`                 | Badges, filters                | Rendered live                       |
| Orders                           | D1 `orders` + `order_items`                | WhatsApp message, emails       | Regenerated from the order          |
| Payment status                   | **The merchant's bank / Satispay account** | D1 `order_payments`            | See below                           |
| Product media                    | R2 `MEDIA`                                 | `product_images` metadata      | Inventory script cross-checks       |
| Payment proofs                   | R2 `PRIVATE_FILES`                         | `payment_proofs` metadata      | Never public                        |
| Sessions                         | D1 (Better Auth)                           | Cookie                         | Revocable server-side               |
| Interface strings                | Repo `app/locales/`                        | —                              | Not merchant-editable by design     |
| Merchant settings                | D1 `store_settings`                        | Storefront rendering           | —                                   |

---

## Payment status is the one exception, and it matters

**The authoritative record of whether money arrived is the merchant's bank
account or merchant app. Not this database.**

D1 records what staff _observed_ there. `order_payments.status = 'verified'`
means "an authorised person looked at the real account and saw this money",
carrying who, when, how much and which reference.

Three consequences:

1. Nothing automatic may set `verified` — no screenshot, no amount match, no
   customer claim. That is invariant 6.
2. `verified` is a claim about the outside world, so it can be wrong. Reversing
   it requires a privileged correction event, and the original is never erased.
3. Reconciliation is a human process. The admin surfaces what to check; it does
   not replace checking.

---

## Search index

D1 FTS5, populated from products, variants, brands, categories, device models,
aliases and translations.

**The index is never authoritative.** A product missing from search still
exists, is still orderable by direct link, and still counts for stock.

Maintained on product create, update, publication change, compatibility change,
variant update and archive. Fully rebuildable, so an index bug is an
inconvenience rather than data loss.

---

## Inventory: on-hand vs reserved

`inventory_levels` holds the counters; `stock_movements` and
`stock_reservations` hold the events.

Counters are authoritative for _serving_ — recomputing availability from the full
ledger on every product view would not scale. The ledger is authoritative for
_explaining_, and a reconciliation script compares the two. Drift is a bug, and
the ledger wins.

---

## Order snapshots

Order items are **not** projections of products. They are the record of an
agreement and are never refreshed from live product data.

Renaming a product must not rewrite what a customer bought last month.

---

## What is deliberately not stored

| Not stored                        | Why                                                           |
| --------------------------------- | ------------------------------------------------------------- |
| Card numbers, CVV, card tokens    | No card payments in Phase 1. Nothing to store.                |
| Banking passwords, PINs, OTPs     | Never requested. A site asking for these is phishing.         |
| Full decrypted IBAN in logs       | Encrypted at rest; only a masked form is displayed.           |
| WhatsApp message content          | Click-to-Chat only. Messages are never read programmatically. |
| Analytics or behavioural profiles | No trackers in Phase 1.                                       |
| Plaintext passwords               | Better Auth hashing.                                          |
