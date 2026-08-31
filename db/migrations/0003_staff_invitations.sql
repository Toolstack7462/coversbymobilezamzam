CREATE TABLE `staff_invitations` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`role_ids` text NOT NULL,
	`invited_by` text NOT NULL,
	`token_hash` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`expires_at` integer NOT NULL,
	`accepted_at` integer,
	`accepted_by_user_id` text,
	`revoked_at` integer,
	`revoked_by` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`invited_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `staff_invitations_token_unique` ON `staff_invitations` (`token_hash`);--> statement-breakpoint
CREATE INDEX `staff_invitations_email_idx` ON `staff_invitations` (`email`,`status`);--> statement-breakpoint
CREATE INDEX `staff_invitations_status_idx` ON `staff_invitations` (`status`,`expires_at`);--> statement-breakpoint
ALTER TABLE `staff_profiles` ADD `status` text DEFAULT 'active' NOT NULL;--> statement-breakpoint
ALTER TABLE `staff_profiles` ADD `suspended_at` integer;--> statement-breakpoint
ALTER TABLE `staff_profiles` ADD `suspended_by` text;--> statement-breakpoint
ALTER TABLE `staff_profiles` ADD `suspended_reason` text;