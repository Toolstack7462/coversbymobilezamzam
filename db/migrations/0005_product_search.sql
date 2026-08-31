-- Full-text search over the catalogue.
--
-- The storefront searched with LOWER(name) LIKE '%term%'. That works to about a
-- few hundred products and then stops: a leading-wildcard LIKE cannot use an
-- index, so every search is a full scan of every product name, and it cannot
-- rank — the tenth-best match and the best one arrive in whatever order the
-- table happens to hold them.
--
-- WHY AN EXTERNAL-CONTENT TABLE. `content=''` would make FTS5 store its own
-- copy of every product name, which then has to be kept correct forever. This
-- form stores only the index and reads the text from `products` and
-- `product_translations` when it needs it, so the row in the catalogue stays
-- the single source of truth (invariant: one fact, one place).
--
-- WHY TRIGGERS RATHER THAN APPLICATION CODE. An index the application has to
-- remember to update is an index that goes stale the first time somebody writes
-- a migration, a bulk import, or a fix in the D1 console. The triggers make
-- staleness impossible rather than unlikely.

CREATE VIRTUAL TABLE `product_search` USING fts5(
  name,
  short_description,
  sku,
  brand_name,
  content='',
  -- unicode61 folds case and, with remove_diacritics 2, folds accents too: a
  -- customer typing "citta" finds "città" without the application knowing any
  -- Italian orthography. `2` rather than `1` because 1 leaves some combining
  -- marks in place.
  tokenize="unicode61 remove_diacritics 2"
);--> statement-breakpoint

-- The rowid is the join back to the product. FTS5 tables have an implicit
-- integer rowid, and product ids are text, so the mapping is explicit.
CREATE TABLE `product_search_map` (
  `rowid` integer PRIMARY KEY AUTOINCREMENT,
  `product_id` text NOT NULL,
  FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE cascade
);--> statement-breakpoint

CREATE UNIQUE INDEX `product_search_map_product` ON `product_search_map` (`product_id`);--> statement-breakpoint

-- ── Keeping the index in step ───────────────────────────────────────────────
--
-- The searchable text lives across three tables, so every one of them needs a
-- trigger. Each rebuilds the whole row rather than patching one column: an
-- index that is right by construction beats one that is right by careful
-- bookkeeping.

CREATE TRIGGER `product_search_ai` AFTER INSERT ON `product_translations` BEGIN
  INSERT OR IGNORE INTO product_search_map (product_id) VALUES (new.product_id);

  INSERT INTO product_search (rowid, name, short_description, sku, brand_name)
  SELECT m.rowid,
         new.name,
         COALESCE(new.short_description, ''),
         COALESCE((SELECT GROUP_CONCAT(v.sku, ' ') FROM product_variants v
                    WHERE v.product_id = new.product_id), ''),
         COALESCE((SELECT b.name FROM products p
                     LEFT JOIN brands b ON b.id = p.brand_id
                    WHERE p.id = new.product_id), '')
    FROM product_search_map m
   WHERE m.product_id = new.product_id
     AND new.locale = 'it';
END;--> statement-breakpoint

CREATE TRIGGER `product_search_au` AFTER UPDATE ON `product_translations` BEGIN
  -- FTS5 external-content tables need the old row deleted explicitly; there is
  -- no update in place.
  INSERT INTO product_search (product_search, rowid, name, short_description, sku, brand_name)
  SELECT 'delete', m.rowid, old.name, COALESCE(old.short_description, ''), '', ''
    FROM product_search_map m WHERE m.product_id = old.product_id AND old.locale = 'it';

  INSERT INTO product_search (rowid, name, short_description, sku, brand_name)
  SELECT m.rowid,
         new.name,
         COALESCE(new.short_description, ''),
         COALESCE((SELECT GROUP_CONCAT(v.sku, ' ') FROM product_variants v
                    WHERE v.product_id = new.product_id), ''),
         COALESCE((SELECT b.name FROM products p
                     LEFT JOIN brands b ON b.id = p.brand_id
                    WHERE p.id = new.product_id), '')
    FROM product_search_map m
   WHERE m.product_id = new.product_id AND new.locale = 'it';
END;--> statement-breakpoint

CREATE TRIGGER `product_search_ad` AFTER DELETE ON `product_translations` BEGIN
  INSERT INTO product_search (product_search, rowid, name, short_description, sku, brand_name)
  SELECT 'delete', m.rowid, old.name, COALESCE(old.short_description, ''), '', ''
    FROM product_search_map m WHERE m.product_id = old.product_id AND old.locale = 'it';
END;--> statement-breakpoint

-- A new or renamed SKU changes what the product matches, so the variant table
-- has to rebuild the row too.
CREATE TRIGGER `product_search_variant_ai` AFTER INSERT ON `product_variants` BEGIN
  INSERT INTO product_search (product_search, rowid, name, short_description, sku, brand_name)
  SELECT 'delete', m.rowid,
         COALESCE(pt.name, ''), COALESCE(pt.short_description, ''), '', ''
    FROM product_search_map m
    LEFT JOIN product_translations pt
           ON pt.product_id = m.product_id AND pt.locale = 'it'
   WHERE m.product_id = new.product_id;

  INSERT INTO product_search (rowid, name, short_description, sku, brand_name)
  SELECT m.rowid,
         COALESCE(pt.name, ''),
         COALESCE(pt.short_description, ''),
         COALESCE((SELECT GROUP_CONCAT(v.sku, ' ') FROM product_variants v
                    WHERE v.product_id = m.product_id), ''),
         COALESCE(b.name, '')
    FROM product_search_map m
    LEFT JOIN product_translations pt
           ON pt.product_id = m.product_id AND pt.locale = 'it'
    LEFT JOIN products p ON p.id = m.product_id
    LEFT JOIN brands b ON b.id = p.brand_id
   WHERE m.product_id = new.product_id;
END;
--> statement-breakpoint

-- ── Backfill ────────────────────────────────────────────────────────────────
--
-- The triggers only fire on future writes. Without this, every product that
-- already exists is invisible to search until somebody happens to edit it —
-- which on a live shop means the catalogue silently empties the moment this
-- migration runs.

INSERT INTO product_search_map (product_id)
SELECT p.id FROM products p
 WHERE NOT EXISTS (SELECT 1 FROM product_search_map m WHERE m.product_id = p.id);--> statement-breakpoint

INSERT INTO product_search (rowid, name, short_description, sku, brand_name)
SELECT m.rowid,
       COALESCE(pt.name, ''),
       COALESCE(pt.short_description, ''),
       COALESCE((SELECT GROUP_CONCAT(v.sku, ' ') FROM product_variants v
                  WHERE v.product_id = m.product_id), ''),
       COALESCE(b.name, '')
  FROM product_search_map m
  LEFT JOIN product_translations pt ON pt.product_id = m.product_id AND pt.locale = 'it'
  LEFT JOIN products p ON p.id = m.product_id
  LEFT JOIN brands b ON b.id = p.brand_id;
