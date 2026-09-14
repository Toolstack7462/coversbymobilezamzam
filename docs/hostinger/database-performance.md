# Database performance

Measured against MariaDB 10.11.19 with the real migrated catalogue (26
products, 38 variants, 1,792 rows).

**A 26-product catalogue does not exercise an index.** Every plan below is
correct in shape, and none of it proves behaviour at 500 products. Where that
matters it is said so, and the synthetic-fixture work that would settle it is
listed in §6.

---

## 1. The pool

One pool per process, bounded, closed on shutdown.

|                      |                         | Why                                                                                                                                                                                                                                                                                 |
| -------------------- | ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `connectionLimit`    | **8**                   | The binding constraint on shared hosting is the per-user connection cap (50 on Web Premium), not CPU. Budgeted in [process-and-resource-budget.md](process-and-resource-budget.md).                                                                                                 |
| Better Auth pool     | **2**                   | Separate, because Drizzle's mysql2 driver needs the driver's own pool object and the `SqlDatabase` port deliberately does not expose one — leaking it would let any caller bypass the statement translator.                                                                         |
| `waitForConnections` | true                    | Queue rather than throw.                                                                                                                                                                                                                                                            |
| `queueLimit`         | 0 (unbounded)           | **A gap.** See §6.                                                                                                                                                                                                                                                                  |
| `connectTimeout`     | 10 s                    |                                                                                                                                                                                                                                                                                     |
| `enableKeepAlive`    | true, 10 s              | Shared hosting closes idle connections; a keepalive makes that the pool's problem rather than the next request's.                                                                                                                                                                   |
| `supportBigNumbers`  | **false**, deliberately | Timestamps are epoch millis in BIGINT (~1.8e12, far inside `Number.MAX_SAFE_INTEGER`). Returning strings would break every comparison in the application — and break them _silently_, because `"1789…" > 1789…` is false, so a session would simply never expire. Pinned by a test. |
| `dateStrings`        | true                    | The schema stores no DATETIME. If one is ever added, this stops it becoming a `Date` in the server's local timezone — the classic way a UTC-only system acquires a hidden Europe/Rome offset.                                                                                       |
| `multipleStatements` | **false**               | A bind value that somehow reached a statement unescaped cannot append a second one.                                                                                                                                                                                                 |

Measured during the load run: **8 connections held, `Max_used_connections` 10.**
Exactly the budget.

**Connections are released on both paths.** `batch()` and `transaction()` both
release in `finally`; a connection whose rollback fails is `destroy()`ed rather
than returned, because handing the next request a connection with an open
transaction is worse than losing one from the pool.

---

## 2. Queries per route

From `app/infrastructure/db/query-metrics.ts`, which records every statement
per request and groups them by shape with literals stripped.

| Route                | Queries | p50   |
| -------------------- | ------- | ----- |
| `/` homepage         | 12      | 86 ms |
| `/shop` collection   | 10      | 93 ms |
| `/shop?q=…` search   | 10      | 65 ms |
| `/trova-dispositivo` | 7       | 47 ms |
| `/negozio`           | 6       | 47 ms |
| `/carrello`          | 5       | 54 ms |
| `/api/health`        | 1       | 6 ms  |

### No N+1

The instrumentation flags any statement shape run five or more times in one
request. **No route triggered it.** The product grid does not query per card:
price, primary image and stock come from correlated subqueries inside the one
collection statement.

This is a baseline, not a claim of optimality. Twelve queries for a homepage is
a number to improve against, and improving it before it was measured would have
been guessing.

---

## 3. Plans

`EXPLAIN` for the collection query, which is the most expensive read on the
storefront:

| table                           | type   | key                            | rows | Extra                                        |
| ------------------------------- | ------ | ------------------------------ | ---- | -------------------------------------------- |
| `products p`                    | range  | `products_status_idx`          | 26   | Using index condition; Using filesort        |
| `product_translations pt`       | eq_ref | `product_translations_unique`  | 1    | Using where                                  |
| `brands b`                      | eq_ref | PRIMARY                        | 1    | Using where                                  |
| `product_images pi` (subquery)  | ref    | `product_images_product_idx`   | 1    | Using where; Using filesort                  |
| `product_variants v` (subquery) | ref    | `product_variants_product_idx` | 1    | Using index; Using temporary; Using filesort |

**No `ALL`.** Every access is an index range, an index ref, or a primary-key
lookup. The joins are `eq_ref`, which is the best available.

The two `filesort`s are real and both are ordering, not scanning:

- the outer one sorts 26 rows by `is_featured DESC, published_at DESC`. At 26
  rows this is free. At 5,000 it is not, and the fix is a composite index on
  `(status, is_featured, published_at)` — **not added**, because adding an
  index against a 26-row table is guessing at a plan the optimiser has not yet
  had to make. It is recorded here so the next person does not have to
  rediscover it.
- the subquery ones sort one row each.

### No index was added

Deliberately. An index costs write time on every insert and update, and the
catalogue is written to by imports. Adding indexes speculatively against a
26-row table would be trading a measured write cost for an imagined read
benefit.

---

## 4. Search

FTS5 is gone; the replacement is a materialised document table with FULLTEXT
plus a token table for exact and prefix lookup. Why both, and why the token
table is not redundancy, is in
[the predicate's own header](../../app/infrastructure/search/predicate.ts) —
briefly: InnoDB will not index words shorter than three characters and
`innodb_ft_min_token_size` is a server-wide setting managed hosting does not
grant.

Measured against the real catalogue (`tests/mariadb/search.test.ts`, 19 cases):

| Query             | Found               | Via                                                                |
| ----------------- | ------------------- | ------------------------------------------------------------------ |
| `PD`              | ✓                   | token table (2 chars — invisible to FULLTEXT)                      |
| `Qi`              | ✓                   | token table                                                        |
| `25W`             | ✓                   | both                                                               |
| `S24`             | ✓                   | both                                                               |
| `USB-C`           | ✓                   | token table + quoted phrase (a bare hyphen is NOT in boolean mode) |
| `iPhone 16`       | ✓                   | FULLTEXT, both terms required                                      |
| `CAV-USBC-1M`     | ✓ exact, one result | token table                                                        |
| `citta` / `città` | ✓ both              | collation folds the accent                                         |
| `caric`           | ✓                   | prefix on the last term                                            |

Index size for 26 products: 26 documents, **481 tokens**. Rebuild: **210 ms**.

Both tables are derived and rebuildable (`npm run hostinger:search-rebuild`),
which is why neither is in the backup.

---

## 5. Reserved words

`key` is reserved in MariaDB and not in SQLite. `SELECT key, value FROM
store_settings` is on the storefront layout's critical path, so **every route
returned 500** until the translator quoted it.

The list is **probed from the server**, not taken from documentation:
`npm run hostinger:reserved-words` attempts `SELECT <identifier> FROM DUAL` for
every column and table name and distinguishes a parse error (reserved) from an
unknown-column error (not). Two of 524 identifiers on 10.11.19: `key` and
`row_number`.

Re-run it against the merchant's server once C-2 says which version that is.

---

## 6. Known gaps

Listed rather than left implied.

| Gap                              | Consequence                                                                                | Status                                                                                                                             |
| -------------------------------- | ------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------- |
| `queueLimit: 0`                  | Under sustained overload, requests queue in memory without bound instead of shedding.      | **Not fixed.** Needs a measured overload first, so the limit is a number rather than a guess.                                      |
| No statement timeout             | A pathological query can hold a connection for `max_execution_time` (60 s on Web Premium). | Not set.                                                                                                                           |
| No synthetic scale fixture       | Every plan above is against 26 products.                                                   | The fixture, and re-running EXPLAIN at 500 products and 5,000 orders, is the next database task.                                   |
| Large-offset pagination          | `LIMIT n OFFSET m` is used throughout. Fine at 26 products, quadratic at scale.            | Keyset pagination for `audit_logs` and `scheduled_job_runs` — 1,221 rows already — is worth doing before the order history exists. |
| `SELECT o.*` in the order detail | Reads every column including snapshots.                                                    | One route, one row. Recorded, not fixed.                                                                                           |
| Count queries                    | The collection runs a second `COUNT(*)` for pagination.                                    | Measured as part of the 10; not separately profiled.                                                                               |
| No `EXPLAIN` in CI               | A plan regression would not be caught.                                                     | Not built.                                                                                                                         |

---

## The listing index, measured at scale (added 2026-09-14)

Every figure in the sections above was taken against 26 products, and a query
plan chosen over 26 rows is not the plan the optimiser will choose later — a
full scan of 26 rows really is faster than an index lookup, so the small
catalogue hides the question rather than answering it.

`npm run scale:fixture -- --copies 40` builds `zamzam_scale`: the real
catalogue multiplied to **1,066 products / 30,996 catalogue rows / 4.8 MB**. It
refuses any target database whose name does not contain "scale", because it
drops the target first.

### What changed at size

The collection query — the one behind `/shop` and every category page:

| Catalogue | Plan                                                   | p50    |
| --------- | ------------------------------------------------------ | ------ |
| 26        | `range` on `products_status_idx (status, archived_at)` | 2.8 ms |
| 1,066     | `ALL`, `Using where; Using filesort`                   | 9.1 ms |

The optimiser abandoned the index and scanned the table, then sorted the
result. Nothing about the page changed: it still renders twenty-four cards. The
cost is the sort, and the sort is `ORDER BY p.is_featured DESC,
p.published_at DESC` — every storefront listing.

### The change

`products_status_idx` extended from `(status, archived_at)` to
`(status, archived_at, is_featured, published_at)`.

| Query                            | Before | After      |
| -------------------------------- | ------ | ---------- |
| Collection, first page           | 9.1 ms | **3.4 ms** |
| Collection, page 11 (OFFSET 240) | 9.4 ms | **4.1 ms** |
| At 26 products                   | 2.8 ms | 2.8 ms     |

`Using filesort` is gone from the plan. Extended rather than joined by a second
index: two indexes sharing a leading column are two writes on every product
change, and the wider one answers both shapes.

Shipped as `0007_product_listing_index` (D1) and
`0003_product_listing_index` (MariaDB).

### What was measured and deliberately NOT fixed

**`?ordina=recenti` still filesorts** — 8.7 ms at 1,066 products. It sorts by
`published_at` alone, which the extended index cannot serve because
`is_featured` sits between the equality columns and it. A third index would fix
it, at the cost of another write on every product change, to speed up the
less-used sort. There is no evidence yet that anybody suffers from it.

**Search is the slow route at scale** — 55.8 ms for `/shop?q=cover` at 1,066
products, against 11.2 ms at 26. Measured piece by piece:

| Piece                                       | 26 products | 1,066 products                 |
| ------------------------------------------- | ----------- | ------------------------------ |
| The search predicate alone (UNION subquery) | —           | 6 ms, both halves index-served |
| Listing query WITH the predicate            | 2.3 ms      | 16.9 ms                        |
| `COUNT(*)` with the same predicate          | 1.3 ms      | 15.0 ms                        |

The predicate itself is fine: `EXPLAIN` shows `fulltext` on
`product_search_document_ft` and a `range` on `product_search_tokens_lookup`.
The cost is that the listing and its count each evaluate that UNION
independently, so a search pays for it twice. Deriving the count from the same
subquery — or dropping the exact count in favour of "more than N" — is the
obvious next step, and it is a behaviour change rather than an index, so it is
recorded here rather than done quietly.

### The caveat on all of it

The fixture multiplies 26 real products, so every copy shares a brand, a
category and a compatibility set. **Index selectivity is worse here than in a
genuine catalogue of the same size**, and repeated search tokens make full-text
queries match proportionally more rows. Both errors are in the pessimistic
direction, which is the right way round.
