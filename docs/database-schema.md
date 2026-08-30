# Database schema

D1 (SQLite). Drizzle definitions in `db/schema/`, forward-only SQL in
`db/migrations/`. Column-level detail is in `docs/data-dictionary.md`.

---

## Conventions

| Convention | Rule |
|---|---|
| Primary keys | Text ULID-style, generated through the `IdGenerator` port. Monotonic, so index locality is good, without exposing a count. |
| Money | `integer` minor units, always beside a `currency` column. |
| Timestamps | `integer` epoch milliseconds, UTC. |
| Booleans | `integer` 0/1 — SQLite has no boolean. |
| Soft delete | `archived_at`, null when active. |
| Foreign keys | Enforced. `ON DELETE RESTRICT` wherever history depends on the row. |
| Naming | `snake_case` tables and columns, plural table names. |
| Translations | A sibling `*_translations` table keyed by `(parent_id, locale)`. |

### Why sequential integer ids are not used

A public `/orders/1234` tells an attacker roughly how many orders exist and makes
the next one guessable. Random ids remove both, and public surfaces use an
opaque token anyway.

### Why translations are rows, not JSON columns

They can be indexed, queried, partially filled, and added without a migration.
A JSON blob cannot be joined against, and adding a language means rewriting every
row.

---

## Groups

### Authentication

Better Auth owns `user`, `session`, `account`, `verification`. **They are not
redefined here** — duplicating them means two definitions of a session drifting
apart.

Project-specific: `staff_profiles`, `roles`, `permissions`, `user_roles`,
`role_permissions`, `step_up_sessions`.

### Catalogue

`brands` · `brand_translations` · `categories` · `category_translations` ·
`products` · `product_translations` · `product_variants` ·
`variant_option_groups` · `variant_option_values` · `variant_option_assignments` ·
`product_images` · `product_category_assignments` · `product_relationships` ·
`product_specifications` · `product_safety_information`

`categories` is self-referencing with a `parent_id` and a materialised `path`, so
breadcrumbs and descendant queries do not need recursion at request time.

`product_specifications` is key/value with a typed unit rather than sixty
columns. A charger has wattage; a case does not. Sixty mostly-null columns is a
schema that documents nothing.

### Compatibility

`device_brands` · `device_brand_translations` · `device_families` ·
`device_family_translations` · `device_models` · `device_model_translations` ·
`device_aliases` · `product_compatibility` · `compatibility_verification_logs` ·
`product_families` · `product_family_members`

`product_compatibility` has a nullable `variant_id`: null means the record
applies to the whole product, set means it overrides for that variant. Unique on
`(product_id, variant_id, device_model_id)` so one pair cannot carry two
contradictory levels.

`product_families` links the same product across device sizes — the "Premium
Clear Case" for 16 Pro and 16 Pro Max are separate products, correctly, and this
is how a customer moves between them.

### Pricing

`price_lists` · `variant_prices` · `price_history` · `promotions` ·
`promotion_products` · `coupons` · `coupon_redemptions`

`price_history` is append-only in practice and is what makes the 30-day
prior-price figure evidenced rather than asserted.

### Inventory

`inventory_locations` · `inventory_levels` · `stock_movements` ·
`stock_reservations` · `stock_adjustments` · `stock_transfers` ·
`stock_transfer_items`

`inventory_levels` is unique on `(variant_id, location_id)` and carries a
`CHECK (reserved >= 0 AND reserved <= on_hand)`. The check is a backstop: the
conditional write should already make it unreachable, and if it ever fires, the
guard has a bug worth knowing about immediately.

### Cart

`carts` · `cart_items`

A cart stores variant ids, quantities and device context. **It does not store
prices.** A stored price is a price someone will eventually trust.

### Orders

`orders` · `order_items` · `order_addresses` · `order_status_history` ·
`order_notes` · `order_events`

`order_items` carries its own snapshot columns and never joins to live product
data for display (invariant 5).

`order_addresses` is a snapshot too — customers move house, and a delivered
order must still show where it went.

`order_notes` separates internal from customer-visible with a flag that is
checked in the query, not in the template.

### Payments

`payment_methods` · `order_payments` · `payment_proofs` · `payment_status_history`

`payment_methods` holds `account_identifier_encrypted` and
`account_identifier_masked` side by side, so ordinary admin screens render the
mask without ever decrypting.

`payment_proofs` stores only the private R2 key, never a URL.

### Fulfilment and returns

`shipping_methods` · `shipping_zones` · `shipping_rates` · `fulfilments` ·
`shipments` · `pickup_orders` · `fulfilment_status_history` · `return_requests` ·
`return_items` · `refunds` · `refund_items`

### Content

`pages` · `page_translations` · `navigation_menus` · `navigation_items` ·
`homepage_sections` · `homepage_section_translations` · `banners` ·
`store_settings` · `legal_documents` · `legal_document_versions`

`legal_document_versions` exists because "which terms did this customer accept?"
must be answerable months later. Terms are versioned and the accepted version is
recorded on the order.

`store_settings` is key/value with a type. Every merchant-unknown value lives
here as an empty string, and the storefront gates on emptiness (invariant 12).

### System

`audit_logs` · `idempotency_keys` · `outbox_events` · `email_logs` ·
`import_jobs` · `import_job_rows` · `export_jobs` · `feature_flags` ·
`system_settings` · `scheduled_job_runs`

`outbox_events` is why a failed email cannot roll back a valid order: the event
is committed with the order, delivery is attempted separately, and a failure is
retried rather than lost.

`scheduled_job_runs` records every cron execution with its outcome, so "did the
sweeper run?" is answerable without log archaeology.

---

## Indexes

Created for the queries that actually run, not speculatively:

- `products(status, archived_at)` — every storefront listing
- `product_variants(product_id)`, `product_variants(sku)` unique
- `product_compatibility(device_model_id, product_id)` — the device-filtered
  catalogue, the hottest path in the app
- `inventory_levels(variant_id, location_id)` unique
- `stock_reservations(status, expires_at)` — the cron sweeper
- `orders(order_number)` unique, `orders(tracking_token)` unique,
  `orders(status, created_at)`
- `order_items(order_id)`
- `order_payments(order_id)`, `order_payments(transaction_reference)` for
  duplicate detection
- `audit_logs(entity_type, entity_id, created_at)`
- `idempotency_keys(key)` unique — the constraint *is* the mechanism

Important queries are checked with `EXPLAIN QUERY PLAN` and the output recorded
in `docs/performance-budget.md`. An index nobody verified is a guess.

---

## Search

FTS5 virtual table over products, variants, brands, categories, device models,
aliases and translations, with Italian synonyms.

**Rebuildable and never authoritative** (`docs/source-of-truth.md`).

---

## Migrations

Forward-only, in git, reviewed. `db/migrations/0000_*.sql` onward. Applied with
`wrangler d1 migrations apply`. `npm run migrations:check` fails if the schema
and the migration files disagree.
