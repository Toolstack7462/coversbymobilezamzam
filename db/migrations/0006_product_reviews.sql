-- Product reviews.
--
-- The table's shape and the reasoning behind every constraint are documented in
-- db/schema/reviews.ts. The short version: a fake review is an unfair
-- commercial practice (D.Lgs. 26/2023), so provenance is a column rather than a
-- convention, and "verified purchase" is unstatable without a link to a real
-- order line — enforced here by CHECK rather than by a screen, because a screen
-- is not what an import or a console session goes through.
--
-- NOTE ON NUMBERING. This is 0006 rather than the 0004 drizzle-kit produced.
-- Migrations 0004_account_issuer and 0005_product_search were hand-written and
-- never got drizzle snapshots, so drizzle's counter is two behind the files.
-- Wrangler applies migrations by FILENAME, so taking 0004 a second time would
-- put two different migrations under one number.

CREATE TABLE `product_reviews` (
	`id` text PRIMARY KEY NOT NULL,
	`product_id` text NOT NULL,
	`order_item_id` text,
	`provenance` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`author_name` text NOT NULL,
	`rating` integer NOT NULL,
	`title` text,
	`body` text NOT NULL,
	`locale` text NOT NULL,
	`moderated_by` text,
	`moderated_at` integer,
	`moderation_note` text,
	`published_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`order_item_id`) REFERENCES `order_items`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "product_reviews_rating_range" CHECK("product_reviews"."rating" BETWEEN 1 AND 5),
	CONSTRAINT "product_reviews_provenance" CHECK("product_reviews"."provenance" IN ('verified_purchase', 'in_store')),
	CONSTRAINT "product_reviews_verified_needs_order" CHECK("product_reviews"."provenance" <> 'verified_purchase' OR "product_reviews"."order_item_id" IS NOT NULL),
	CONSTRAINT "product_reviews_status" CHECK("product_reviews"."status" IN ('pending', 'published', 'rejected'))
);
--> statement-breakpoint
CREATE INDEX `product_reviews_product_idx` ON `product_reviews` (`product_id`,`status`);--> statement-breakpoint
CREATE INDEX `product_reviews_status_idx` ON `product_reviews` (`status`,`created_at`);--> statement-breakpoint