-- Catalogue search, without FTS5.
--
-- D1 used an FTS5 external-content virtual table kept in step by four
-- triggers. MariaDB has neither, and the replacement is deliberately NOT a
-- like-for-like attempt.
--
-- ── Why two indexes rather than one ─────────────────────────────────────────
--
-- InnoDB's FULLTEXT index does not index words shorter than
-- `innodb_ft_min_token_size`, which defaults to 3 and is a SERVER-WIDE setting
-- that requires a restart. On managed shared hosting we do not get to change
-- it, and a search feature whose correctness depends on a my.cnf edit we
-- cannot make is a feature that breaks on somebody else's maintenance window.
--
-- The catalogue is full of two-character tokens that customers actually type:
--
--     PD    (Power Delivery)      Qi   (wireless charging)
--     S24   (Samsung model)       25W  (charger rating)
--     USB-C (hyphen, tokenised as two words by FULLTEXT)
--
-- So search runs over two structures and unions the results:
--
--   product_search_documents  FULLTEXT, for natural-language matching over
--                             names and descriptions, with relevance scoring.
--   product_search_tokens     one row per distinct token, VARCHAR(64) and
--                             ordinarily indexed, for exact and prefix lookup
--                             of SKUs, barcodes, aliases and short technical
--                             terms — everything FULLTEXT drops on the floor.
--
-- Both are DERIVED. Neither is authoritative, both are rebuildable from the
-- catalogue at any time, and `npm run hostinger:search-rebuild` does exactly
-- that. Nothing in a backup needs to contain them.
--
-- ── Why the application maintains them, not triggers ────────────────────────
--
-- The SQLite version used triggers, on the reasoning that an index the
-- application has to remember to update goes stale. That reasoning was right
-- for SQLite and is wrong here: the token table needs the same tokenisation
-- the SEARCH BOX uses, and that lives in app/domain/search/query.ts. A trigger
-- would need its own copy of it in SQL, and two tokenisers that must agree
-- forever is a worse bet than one tokeniser called from both sides.
--
-- The staleness risk is handled instead by making the rebuild cheap, by
-- running it inside the same transaction as the catalogue write, and by the
-- scheduled consistency check in the job runner.

CREATE TABLE `product_search_documents` (
  `product_id` VARCHAR(64) NOT NULL,
  `locale` VARCHAR(10) NOT NULL,
  `name` VARCHAR(255) NOT NULL,
  `short_description` TEXT NULL,
  `brand_name` VARCHAR(255) NULL,
  `sku_text` TEXT NULL,
  -- Everything searchable, concatenated. One FULLTEXT index over one column
  -- scores better than four: with several indexed columns, MATCH must name all
  -- of them in the same order every time or the index is not used at all.
  `document` MEDIUMTEXT NOT NULL,
  `updated_at` BIGINT NOT NULL,
  PRIMARY KEY (`product_id`, `locale`),
  FULLTEXT KEY `product_search_document_ft` (`document`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- utf8mb4_unicode_ci is what folds `città` onto `citta` and `Cover` onto
-- `cover`, which is the job FTS5 did with `unicode61 remove_diacritics 2`.
-- The collation is set explicitly on the token column because uniqueness and
-- prefix matching both depend on it and inheriting it silently is how an
-- accent-sensitive index appears after a server move.
CREATE TABLE `product_search_tokens` (
  `id` VARCHAR(64) NOT NULL,
  `product_id` VARCHAR(64) NOT NULL,
  `locale` VARCHAR(10) NOT NULL,
  `token` VARCHAR(64) COLLATE utf8mb4_unicode_ci NOT NULL,
  -- What the token came from, so a SKU match can outrank a description word.
  `source` VARCHAR(16) NOT NULL,
  `weight` INT NOT NULL DEFAULT 1,
  PRIMARY KEY (`id`),
  CONSTRAINT `product_search_tokens_source` CHECK (`source` IN ('name','description','sku','barcode','brand','alias')),
  UNIQUE KEY `product_search_tokens_unique` (`product_id`, `locale`, `token`, `source`),
  -- Leading column is the token: `WHERE token LIKE 'usb%'` uses this, and a
  -- prefix search is the one query shape that cannot fall back to FULLTEXT.
  KEY `product_search_tokens_lookup` (`token`, `locale`),
  CONSTRAINT `fk_product_search_tokens_product` FOREIGN KEY (`product_id`)
    REFERENCES `products` (`id`) ON DELETE CASCADE ON UPDATE NO ACTION
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE `product_search_documents`
  ADD CONSTRAINT `fk_product_search_documents_product` FOREIGN KEY (`product_id`)
  REFERENCES `products` (`id`) ON DELETE CASCADE ON UPDATE NO ACTION;

-- `product_search_map` came across from the D1 schema, where it existed only
-- to give FTS5's integer rowid something to join back to. Nothing in the
-- MariaDB path reads it, and it is dropped rather than left as a table that
-- looks meaningful and is not. The data migration does not copy it.
DROP TABLE IF EXISTS `product_search_map`;
