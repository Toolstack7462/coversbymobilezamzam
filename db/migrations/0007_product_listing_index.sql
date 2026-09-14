-- Widen the storefront listing index so the sort comes from the index.
--
-- Measured, not guessed. Against the real 26-product catalogue the optimiser
-- used `(status, archived_at)`. Against a 1,066-product copy of the same
-- catalogue (scripts/hostinger/scale-fixture.mjs) it stopped using it, scanned
-- the whole table and sorted the result: the collection query went from 2.8 ms
-- to 9.1 ms for the same twenty-four cards, and deep pages were worse.
--
-- `is_featured` and `published_at` are exactly the ORDER BY of every storefront
-- listing, so adding them to the tail of the index removes the filesort:
-- 9.1 ms -> 3.4 ms at 1,066 products, unchanged at 26.
--
-- Extended rather than joined by a second index. Two indexes sharing a leading
-- column both have to be maintained on every product write, and the wider one
-- answers both shapes.

DROP INDEX `products_status_idx`;--> statement-breakpoint
CREATE INDEX `products_status_idx` ON `products` (`status`,`archived_at`,`is_featured`,`published_at`);