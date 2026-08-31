ALTER TABLE `two_factor` ADD `verified` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `two_factor` ADD `failed_verification_count` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `two_factor` ADD `locked_until` integer;