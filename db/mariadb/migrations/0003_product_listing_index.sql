-- Widen the storefront listing index so the sort comes from the index.
--
-- The MariaDB half of db/migrations/0007_product_listing_index.sql. Both
-- engines get the same index because both run the same collection query; the
-- evidence below was gathered on MariaDB, which is the one that will serve it.
--
-- ── The measurement ─────────────────────────────────────────────────────────
--
-- Against the real catalogue (26 products) the optimiser chose
-- `products_status_idx (status, archived_at)`:
--
--     p / range / products_status_idx / rows=26          2.8 ms
--
-- Against a 1,066-product copy of the same catalogue built by
-- scripts/hostinger/scale-fixture.mjs, it stopped:
--
--     p / ALL / - / rows=1066 / Using where; Using filesort    9.1 ms
--
-- Nothing about the page changed — it still renders twenty-four cards. The
-- cost is the sort, and the sort is `ORDER BY p.is_featured DESC,
-- p.published_at DESC`, which is every storefront listing.
--
-- With those two columns on the tail of the index:
--
--     p / range / products_status_idx / Using where            3.4 ms
--
-- and deep pagination (OFFSET 240) 9.4 ms -> 4.1 ms.
--
-- ── What it does NOT fix ────────────────────────────────────────────────────
--
-- `?ordina=recenti` sorts by `published_at` alone and still filesorts (8.7 ms
-- at 1,066 products). A second index would fix it and is not added: it would
-- be a third write on every product change to speed up the less-used sort, and
-- there is no evidence yet that anybody suffers from it. Recorded so the next
-- person measuring finds the answer rather than the question.

DROP INDEX `products_status_idx` ON `products`;

CREATE INDEX `products_status_idx`
    ON `products` (`status`, `archived_at`, `is_featured`, `published_at`);
