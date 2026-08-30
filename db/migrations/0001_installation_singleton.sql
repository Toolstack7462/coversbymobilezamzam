CREATE TABLE `bootstrap_attempts` (
	`id` text PRIMARY KEY NOT NULL,
	`ip_hash` text,
	`outcome` text NOT NULL,
	`attempted_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `bootstrap_attempts_recent_idx` ON `bootstrap_attempts` (`attempted_at`);--> statement-breakpoint
CREATE TABLE `installation_state` (
	`id` text PRIMARY KEY NOT NULL,
	`status` text NOT NULL,
	`claimed_at` integer NOT NULL,
	`completed_at` integer,
	`completed_by_user_id` text,
	`token_consumed_at` integer,
	CONSTRAINT "installation_state_singleton" CHECK("installation_state"."id" = 'singleton'),
	CONSTRAINT "installation_state_status" CHECK("installation_state"."status" IN ('in_progress','completed'))
);
