# Data migration and reconciliation

How the catalogue moved from D1 to MariaDB, and how "did it all arrive?" is
answered with evidence rather than an absence of errors.

Run on 2026-09-13 against the live Cloudflare preview.

---

## 1. The result

|                           |                                                             |
| ------------------------- | ----------------------------------------------------------- |
| Source                    | Cloudflare D1, `preview`, schema `0006_product_reviews.sql` |
| Snapshot                  | 2026-09-13T16:24Z → 16:34Z                                  |
| Tables exported           | **100**                                                     |
| Rows exported             | **1,792** (497,148 bytes)                                   |
| Rows imported             | **1,792**                                                   |
| Rows rejected             | **0**                                                       |
| Tables with a difference  | **0**                                                       |
| Tables only on the target | **0**                                                       |

`IMPORT RECONCILED — every table matches the manifest.`

**Zero unexplained differences is the acceptance criterion**, and it was met.
Not "close enough", and no row was excluded because it looked like demo data.

---

## 2. What the source actually contained

The single most important finding of the whole migration, because it changes
what the cutover _is_.

| Table                                                              | Rows          |
| ------------------------------------------------------------------ | ------------- |
| `orders`                                                           | **0**         |
| `order_items`, `order_payments`, `order_addresses`, `order_events` | **0**         |
| `stock_reservations`                                               | **0**         |
| `payment_proofs`, `payment_proof_access_logs`                      | **0**         |
| `fulfilments`, `shipments`, `returns`, `refunds`                   | **0**         |
| `products` / `product_variants` / `product_images`                 | 26 / 38 / 26  |
| `device_models` / `families` / `brands`                            | 36 / 22 / 15  |
| `product_compatibility`                                            | 57            |
| `store_settings`                                                   | 32            |
| `user` / `staff_profiles` / `two_factor` / `session`               | 1 / 1 / 1 / 2 |
| `scheduled_job_runs`                                               | 1,221         |
| `audit_logs`                                                       | 9             |
| `carts` / `cart_items`                                             | 3 / 3         |

**The source has never taken an order.** There is no payment history, no
customer PII beyond one staff account, and no private proof.

That makes this a **pre-transactional** migration: a catalogue-and-content move,
not a live-commerce one. The riskiest part of the brief — transferring
transactional data consistently while orders are being placed — does not apply
_yet_, and this migration should complete **before** the shop starts taking
orders rather than after.

### Rows classified

| Class       | Tables                                                                   | Migrated                          |
| ----------- | ------------------------------------------------------------------------ | --------------------------------- |
| Merchant    | catalogue, devices, compatibility, pricing, inventory, pages, settings   | yes                               |
| Customer    | none exist                                                               | —                                 |
| Operational | `scheduled_job_runs` (1,221), `audit_logs` (9), `bootstrap_attempts` (1) | yes                               |
| Ephemeral   | `carts` (3), `cart_items` (3), `session` (2), `verification` (2)         | yes — see §5                      |
| Derived     | `product_search*` (FTS5 shadow tables)                                   | **no** — rebuilt                  |
| Bookkeeping | `d1_migrations`                                                          | **no** — recorded in the manifest |

Nothing was excluded on a judgement about its value. The two exclusions are
structural: FTS5's shadow tables have no MariaDB equivalent and are rebuilt from
the catalogue, and `d1_migrations` belongs to a database that will not exist
after cutover.

`scheduled_job_runs` at 1,221 rows is the one place a retention window is worth
agreeing with the merchant. It is migrated in full rather than trimmed, because
trimming history is the merchant's decision and not a migration tool's.

---

## 3. The export

`npm run hostinger:export -- --env preview`

Writes to `~/hostinger-migration-work/export-<timestamp>/`, **outside the
repository**, mode 0600. It contains every record the shop holds; it is not a
build artefact and it does not belong in Git.

Per table: one NDJSON file, one row per line, in primary-key order.

The manifest records source environment, repository commit, schema version,
snapshot start and finish, and per table: row count, byte count, column list,
sort key and a **canonical SHA-256**.

Canonical means keys sorted before serialisation. D1 returns columns in whatever
order the SELECT produced them, so without that the same data exported twice
hashes differently and the reconciliation reports a difference that does not
exist.

---

## 4. The import

`npm run hostinger:import -- --from <dir>` — **dry run by default.**

Nothing is written without `--apply`. Every row is read, converted and validated
and the report says what _would_ happen. A migration tool whose default is to
write is a tool somebody runs against the wrong database once.

### What it refuses to do

**No `INSERT IGNORE`.** A silently skipped row is the exact failure this
exercise exists to prevent: the import "succeeds", the counts are short, nobody
reads the counts. A duplicate key is an error and the report names the row.

**No `FOREIGN_KEY_CHECKS = 0`.** Tables are imported in dependency order derived
from the generated schema by a topological sort (`lib/table-order.mjs`), which
also detects cycles and refuses rather than guessing. Turning the checks off
would turn a migration that failed loudly into one that succeeded and left
orphans — and the point of moving to an engine that enforces references is that
it enforces them.

**No truncation.** The target runs `STRICT_TRANS_TABLES`, so an over-long value
is an error. The importer checks lengths _before_ writing, so a rejection names
the table, the row id and the column — with 200 rows batched into one INSERT,
"data too long for column 'name'" identifies nothing.

### What it checks per row

| Check                                             | On failure                                             |
| ------------------------------------------------- | ------------------------------------------------------ |
| Column exists in the target                       | reject, naming the column                              |
| NOT NULL columns are not null                     | reject                                                 |
| String fits the column, **counted in characters** | reject, and say to widen the type map — never truncate |
| Integers are safe integers                        | reject                                                 |
| TINYINT holds 0 or 1                              | reject                                                 |

Generated columns (`variant_scope`) are skipped: they are computed by the target
and exist only there, being the replacement for a SQLite partial index.

### Resumability

Progress is written after each table commits, keyed by the export's checksum. A
rerun skips completed tables **and verifies their row count** rather than
trusting the file. Interrupting is safe; running twice is safe.

Streamed line by line, 200 rows per batch. The catalogue is small today and an
order history will not be; a tool that needs the whole table in memory stops
working exactly when it matters.

---

## 5. What changes at the real cutover

This run migrated a preview. A production cutover differs in three ways:

1. **Sessions and carts are deliberately invalidated**, not migrated. The two
   sessions and three carts here came across because this is a rehearsal; at
   cutover the brief requires a fresh sign-in, and carrying a cart across a
   hostname change is a different decision that needs the merchant's answer.
2. **A write freeze.** With zero orders there is nothing to race. Once orders
   exist, the source's scheduler must be paused and writes frozen before the
   final export, or the export is not a consistent snapshot.
3. **Media.** Not yet migrated — see
   [media-persistence.md](media-persistence.md). 70 objects, 5.87 MB, of which
   26 are referenced by `product_images` and 44 are not yet classified.

---

## 6. Reproducing it

```sh
# 1. Schema, through the ledger. Dry run first.
npm run hostinger:migrate                 # what would be applied
npm run hostinger:migrate -- --apply

# 2. Export. Writes outside the repository.
npm run hostinger:export -- --env preview

# 3. Import. Dry run, read the report, then apply.
npm run hostinger:import -- --from <dir>
npm run hostinger:import -- --from <dir> --apply

# 4. Rebuild what is derived.
npm run hostinger:search-rebuild
```

The migration ledger earned itself on the first run: it **refused** to apply the
baseline over a schema that had been applied by hand, which is precisely the
out-of-band change it exists to surface.
