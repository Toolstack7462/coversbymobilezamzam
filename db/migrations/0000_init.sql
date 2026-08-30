CREATE TABLE `account` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`account_id` text NOT NULL,
	`provider_id` text NOT NULL,
	`access_token` text,
	`refresh_token` text,
	`access_token_expires_at` integer,
	`refresh_token_expires_at` integer,
	`scope` text,
	`id_token` text,
	`password` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `account_user_idx` ON `account` (`user_id`);--> statement-breakpoint
CREATE TABLE `permissions` (
	`id` text PRIMARY KEY NOT NULL,
	`code` text NOT NULL,
	`description` text NOT NULL,
	`category` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `permissions_code_unique` ON `permissions` (`code`);--> statement-breakpoint
CREATE TABLE `role_permissions` (
	`id` text PRIMARY KEY NOT NULL,
	`role_id` text NOT NULL,
	`permission_id` text NOT NULL,
	FOREIGN KEY (`role_id`) REFERENCES `roles`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`permission_id`) REFERENCES `permissions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `role_permissions_unique` ON `role_permissions` (`role_id`,`permission_id`);--> statement-breakpoint
CREATE TABLE `roles` (
	`id` text PRIMARY KEY NOT NULL,
	`code` text NOT NULL,
	`name_it` text NOT NULL,
	`name_en` text NOT NULL,
	`description` text,
	`is_system` integer DEFAULT false NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `roles_code_unique` ON `roles` (`code`);--> statement-breakpoint
CREATE TABLE `session` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`token` text NOT NULL,
	`expires_at` integer NOT NULL,
	`ip_address` text,
	`user_agent` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `session_token_unique` ON `session` (`token`);--> statement-breakpoint
CREATE INDEX `session_user_idx` ON `session` (`user_id`);--> statement-breakpoint
CREATE TABLE `staff_profiles` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`display_name` text NOT NULL,
	`job_title` text,
	`active` integer DEFAULT true NOT NULL,
	`last_login_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`archived_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `staff_profiles_user_unique` ON `staff_profiles` (`user_id`);--> statement-breakpoint
CREATE TABLE `step_up_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`session_id` text NOT NULL,
	`purpose` text NOT NULL,
	`expires_at` integer NOT NULL,
	`consumed_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `step_up_user_purpose_idx` ON `step_up_sessions` (`user_id`,`purpose`,`expires_at`);--> statement-breakpoint
CREATE TABLE `two_factor` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`secret` text NOT NULL,
	`backup_codes` text,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `two_factor_user_idx` ON `two_factor` (`user_id`);--> statement-breakpoint
CREATE TABLE `user` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`email` text NOT NULL,
	`email_verified` integer DEFAULT false NOT NULL,
	`image` text,
	`two_factor_enabled` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `user_email_unique` ON `user` (`email`);--> statement-breakpoint
CREATE TABLE `user_roles` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`role_id` text NOT NULL,
	`granted_by` text,
	`granted_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`role_id`) REFERENCES `roles`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`granted_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `user_roles_unique` ON `user_roles` (`user_id`,`role_id`);--> statement-breakpoint
CREATE INDEX `user_roles_user_idx` ON `user_roles` (`user_id`);--> statement-breakpoint
CREATE TABLE `verification` (
	`id` text PRIMARY KEY NOT NULL,
	`identifier` text NOT NULL,
	`value` text NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `verification_identifier_idx` ON `verification` (`identifier`);--> statement-breakpoint
CREATE TABLE `brand_translations` (
	`id` text PRIMARY KEY NOT NULL,
	`brand_id` text NOT NULL,
	`locale` text NOT NULL,
	`description` text,
	FOREIGN KEY (`brand_id`) REFERENCES `brands`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `brand_translations_unique` ON `brand_translations` (`brand_id`,`locale`);--> statement-breakpoint
CREATE TABLE `brands` (
	`id` text PRIMARY KEY NOT NULL,
	`slug` text NOT NULL,
	`name` text NOT NULL,
	`logo_key` text,
	`website_url` text,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`archived_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `brands_slug_unique` ON `brands` (`slug`);--> statement-breakpoint
CREATE TABLE `categories` (
	`id` text PRIMARY KEY NOT NULL,
	`slug` text NOT NULL,
	`parent_id` text,
	`path` text NOT NULL,
	`depth` integer DEFAULT 0 NOT NULL,
	`accessory_type` text,
	`image_key` text,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`visible` integer DEFAULT true NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`archived_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `categories_slug_unique` ON `categories` (`slug`);--> statement-breakpoint
CREATE INDEX `categories_parent_idx` ON `categories` (`parent_id`);--> statement-breakpoint
CREATE INDEX `categories_path_idx` ON `categories` (`path`);--> statement-breakpoint
CREATE TABLE `category_translations` (
	`id` text PRIMARY KEY NOT NULL,
	`category_id` text NOT NULL,
	`locale` text NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`seo_title` text,
	`seo_description` text,
	FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `category_translations_unique` ON `category_translations` (`category_id`,`locale`);--> statement-breakpoint
CREATE TABLE `product_category_assignments` (
	`id` text PRIMARY KEY NOT NULL,
	`product_id` text NOT NULL,
	`category_id` text NOT NULL,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `product_category_assignments_unique` ON `product_category_assignments` (`product_id`,`category_id`);--> statement-breakpoint
CREATE INDEX `product_category_category_idx` ON `product_category_assignments` (`category_id`);--> statement-breakpoint
CREATE TABLE `product_images` (
	`id` text PRIMARY KEY NOT NULL,
	`product_id` text NOT NULL,
	`variant_id` text,
	`object_key` text NOT NULL,
	`alt_it` text,
	`alt_en` text,
	`width` integer NOT NULL,
	`height` integer NOT NULL,
	`mime_type` text NOT NULL,
	`file_size` integer NOT NULL,
	`file_hash` text NOT NULL,
	`is_primary` integer DEFAULT false NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`variant_id`) REFERENCES `product_variants`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `product_images_product_idx` ON `product_images` (`product_id`,`sort_order`);--> statement-breakpoint
CREATE INDEX `product_images_variant_idx` ON `product_images` (`variant_id`);--> statement-breakpoint
CREATE TABLE `product_relationships` (
	`id` text PRIMARY KEY NOT NULL,
	`product_id` text NOT NULL,
	`related_product_id` text NOT NULL,
	`relationship_type` text NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`related_product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `product_relationships_unique` ON `product_relationships` (`product_id`,`related_product_id`,`relationship_type`);--> statement-breakpoint
CREATE TABLE `product_safety_information` (
	`id` text PRIMARY KEY NOT NULL,
	`product_id` text NOT NULL,
	`manufacturer_name` text,
	`manufacturer_address` text,
	`manufacturer_contact` text,
	`product_identifier` text,
	`responsible_person_name` text,
	`responsible_person_address` text,
	`responsible_person_contact` text,
	`warnings_it` text,
	`warnings_en` text,
	`manual_url` text,
	`recall_notice` text,
	`disposal_info_it` text,
	`disposal_info_en` text,
	`certification` text,
	`battery_notes` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `product_safety_product_unique` ON `product_safety_information` (`product_id`);--> statement-breakpoint
CREATE TABLE `product_specifications` (
	`id` text PRIMARY KEY NOT NULL,
	`product_id` text NOT NULL,
	`variant_id` text,
	`spec_key` text NOT NULL,
	`value_text` text,
	`value_number` integer,
	`value_bool` integer,
	`unit` text,
	`sort_order` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`variant_id`) REFERENCES `product_variants`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `product_specifications_product_idx` ON `product_specifications` (`product_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `product_specifications_variant_unique` ON `product_specifications` (`product_id`,`variant_id`,`spec_key`) WHERE variant_id IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `product_specifications_product_unique` ON `product_specifications` (`product_id`,`spec_key`) WHERE variant_id IS NULL;--> statement-breakpoint
CREATE TABLE `product_translations` (
	`id` text PRIMARY KEY NOT NULL,
	`product_id` text NOT NULL,
	`locale` text NOT NULL,
	`name` text NOT NULL,
	`short_description` text,
	`full_description` text,
	`seo_title` text,
	`seo_description` text,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `product_translations_unique` ON `product_translations` (`product_id`,`locale`);--> statement-breakpoint
CREATE TABLE `product_variants` (
	`id` text PRIMARY KEY NOT NULL,
	`product_id` text NOT NULL,
	`sku` text NOT NULL,
	`barcode` text,
	`variant_label` text,
	`colour` text,
	`length_mm` integer,
	`capacity_mah` integer,
	`connector` text,
	`pack_size` integer DEFAULT 1 NOT NULL,
	`weight_grams` integer,
	`dimensions_mm` text,
	`active` integer DEFAULT true NOT NULL,
	`is_default` integer DEFAULT false NOT NULL,
	`available_online` integer DEFAULT true NOT NULL,
	`available_for_pickup` integer DEFAULT true NOT NULL,
	`allow_backorder` integer DEFAULT false NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`archived_at` integer,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `product_variants_sku_unique` ON `product_variants` (`sku`);--> statement-breakpoint
CREATE UNIQUE INDEX `product_variants_barcode_unique` ON `product_variants` (`barcode`);--> statement-breakpoint
CREATE INDEX `product_variants_product_idx` ON `product_variants` (`product_id`);--> statement-breakpoint
CREATE TABLE `products` (
	`id` text PRIMARY KEY NOT NULL,
	`slug` text NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`brand_id` text,
	`primary_category_id` text,
	`accessory_type` text,
	`product_family_id` text,
	`is_featured` integer DEFAULT false NOT NULL,
	`is_new` integer DEFAULT false NOT NULL,
	`is_bestseller` integer DEFAULT false NOT NULL,
	`published_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`archived_at` integer,
	FOREIGN KEY (`brand_id`) REFERENCES `brands`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`primary_category_id`) REFERENCES `categories`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `products_slug_unique` ON `products` (`slug`);--> statement-breakpoint
CREATE INDEX `products_status_idx` ON `products` (`status`,`archived_at`);--> statement-breakpoint
CREATE INDEX `products_brand_idx` ON `products` (`brand_id`);--> statement-breakpoint
CREATE INDEX `products_family_idx` ON `products` (`product_family_id`);--> statement-breakpoint
CREATE TABLE `variant_option_assignments` (
	`id` text PRIMARY KEY NOT NULL,
	`variant_id` text NOT NULL,
	`option_value_id` text NOT NULL,
	FOREIGN KEY (`variant_id`) REFERENCES `product_variants`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`option_value_id`) REFERENCES `variant_option_values`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `variant_option_assignments_unique` ON `variant_option_assignments` (`variant_id`,`option_value_id`);--> statement-breakpoint
CREATE TABLE `variant_option_groups` (
	`id` text PRIMARY KEY NOT NULL,
	`product_id` text NOT NULL,
	`code` text NOT NULL,
	`name_it` text NOT NULL,
	`name_en` text NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `variant_option_groups_unique` ON `variant_option_groups` (`product_id`,`code`);--> statement-breakpoint
CREATE TABLE `variant_option_values` (
	`id` text PRIMARY KEY NOT NULL,
	`group_id` text NOT NULL,
	`value` text NOT NULL,
	`label_it` text NOT NULL,
	`label_en` text NOT NULL,
	`swatch_hex` text,
	`sort_order` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`group_id`) REFERENCES `variant_option_groups`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `variant_option_values_unique` ON `variant_option_values` (`group_id`,`value`);--> statement-breakpoint
CREATE TABLE `compatibility_verification_logs` (
	`id` text PRIMARY KEY NOT NULL,
	`compatibility_id` text NOT NULL,
	`previous_level` text,
	`new_level` text NOT NULL,
	`previous_verified` integer,
	`new_verified` integer NOT NULL,
	`source` text,
	`note` text,
	`changed_by` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`compatibility_id`) REFERENCES `product_compatibility`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `compatibility_logs_compat_idx` ON `compatibility_verification_logs` (`compatibility_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `device_aliases` (
	`id` text PRIMARY KEY NOT NULL,
	`device_model_id` text NOT NULL,
	`alias` text NOT NULL,
	`alias_normalised` text NOT NULL,
	FOREIGN KEY (`device_model_id`) REFERENCES `device_models`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `device_aliases_unique` ON `device_aliases` (`device_model_id`,`alias_normalised`);--> statement-breakpoint
CREATE INDEX `device_aliases_lookup_idx` ON `device_aliases` (`alias_normalised`);--> statement-breakpoint
CREATE TABLE `device_brand_translations` (
	`id` text PRIMARY KEY NOT NULL,
	`device_brand_id` text NOT NULL,
	`locale` text NOT NULL,
	`description` text,
	FOREIGN KEY (`device_brand_id`) REFERENCES `device_brands`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `device_brand_translations_unique` ON `device_brand_translations` (`device_brand_id`,`locale`);--> statement-breakpoint
CREATE TABLE `device_brands` (
	`id` text PRIMARY KEY NOT NULL,
	`handle` text NOT NULL,
	`name` text NOT NULL,
	`logo_key` text,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`archived_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `device_brands_handle_unique` ON `device_brands` (`handle`);--> statement-breakpoint
CREATE TABLE `device_families` (
	`id` text PRIMARY KEY NOT NULL,
	`device_brand_id` text NOT NULL,
	`handle` text NOT NULL,
	`name` text NOT NULL,
	`release_year` integer,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`archived_at` integer,
	FOREIGN KEY (`device_brand_id`) REFERENCES `device_brands`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `device_families_handle_unique` ON `device_families` (`handle`);--> statement-breakpoint
CREATE INDEX `device_families_brand_idx` ON `device_families` (`device_brand_id`,`sort_order`);--> statement-breakpoint
CREATE TABLE `device_family_translations` (
	`id` text PRIMARY KEY NOT NULL,
	`device_family_id` text NOT NULL,
	`locale` text NOT NULL,
	`description` text,
	FOREIGN KEY (`device_family_id`) REFERENCES `device_families`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `device_family_translations_unique` ON `device_family_translations` (`device_family_id`,`locale`);--> statement-breakpoint
CREATE TABLE `device_model_translations` (
	`id` text PRIMARY KEY NOT NULL,
	`device_model_id` text NOT NULL,
	`locale` text NOT NULL,
	`display_name` text,
	`notes` text,
	FOREIGN KEY (`device_model_id`) REFERENCES `device_models`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `device_model_translations_unique` ON `device_model_translations` (`device_model_id`,`locale`);--> statement-breakpoint
CREATE TABLE `device_models` (
	`id` text PRIMARY KEY NOT NULL,
	`device_brand_id` text NOT NULL,
	`device_family_id` text NOT NULL,
	`handle` text NOT NULL,
	`name` text NOT NULL,
	`release_year` integer,
	`image_key` text,
	`connector` text,
	`is_popular` integer DEFAULT false NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`archived_at` integer,
	FOREIGN KEY (`device_brand_id`) REFERENCES `device_brands`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`device_family_id`) REFERENCES `device_families`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `device_models_handle_unique` ON `device_models` (`handle`);--> statement-breakpoint
CREATE INDEX `device_models_family_idx` ON `device_models` (`device_family_id`,`sort_order`);--> statement-breakpoint
CREATE INDEX `device_models_brand_idx` ON `device_models` (`device_brand_id`);--> statement-breakpoint
CREATE INDEX `device_models_popular_idx` ON `device_models` (`is_popular`,`sort_order`);--> statement-breakpoint
CREATE TABLE `product_compatibility` (
	`id` text PRIMARY KEY NOT NULL,
	`product_id` text NOT NULL,
	`variant_id` text,
	`device_model_id` text NOT NULL,
	`compatibility_level` text NOT NULL,
	`note` text,
	`verified` integer DEFAULT false NOT NULL,
	`verification_source` text,
	`verified_by` text,
	`verified_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`variant_id`) REFERENCES `product_variants`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`device_model_id`) REFERENCES `device_models`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `product_compatibility_variant_unique` ON `product_compatibility` (`product_id`,`variant_id`,`device_model_id`) WHERE variant_id IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `product_compatibility_product_unique` ON `product_compatibility` (`product_id`,`device_model_id`) WHERE variant_id IS NULL;--> statement-breakpoint
CREATE INDEX `product_compatibility_device_idx` ON `product_compatibility` (`device_model_id`,`product_id`);--> statement-breakpoint
CREATE INDEX `product_compatibility_product_idx` ON `product_compatibility` (`product_id`);--> statement-breakpoint
CREATE TABLE `product_families` (
	`id` text PRIMARY KEY NOT NULL,
	`handle` text NOT NULL,
	`name_it` text NOT NULL,
	`name_en` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`archived_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `product_families_handle_unique` ON `product_families` (`handle`);--> statement-breakpoint
CREATE TABLE `product_family_members` (
	`id` text PRIMARY KEY NOT NULL,
	`product_family_id` text NOT NULL,
	`product_id` text NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`product_family_id`) REFERENCES `product_families`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `product_family_members_unique` ON `product_family_members` (`product_family_id`,`product_id`);--> statement-breakpoint
CREATE INDEX `product_family_members_product_idx` ON `product_family_members` (`product_id`);--> statement-breakpoint
CREATE TABLE `coupon_redemptions` (
	`id` text PRIMARY KEY NOT NULL,
	`coupon_id` text NOT NULL,
	`order_id` text NOT NULL,
	`customer_email` text,
	`amount_discounted` integer NOT NULL,
	`currency` text DEFAULT 'EUR' NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`coupon_id`) REFERENCES `coupons`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `coupon_redemptions_order_unique` ON `coupon_redemptions` (`coupon_id`,`order_id`);--> statement-breakpoint
CREATE INDEX `coupon_redemptions_customer_idx` ON `coupon_redemptions` (`coupon_id`,`customer_email`);--> statement-breakpoint
CREATE TABLE `coupons` (
	`id` text PRIMARY KEY NOT NULL,
	`code` text NOT NULL,
	`discount_type` text NOT NULL,
	`discount_value` integer NOT NULL,
	`usage_limit` integer,
	`usage_count` integer DEFAULT 0 NOT NULL,
	`per_customer_limit` integer,
	`starts_at` integer NOT NULL,
	`ends_at` integer,
	`min_order_amount` integer,
	`active` integer DEFAULT true NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`archived_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `coupons_code_unique` ON `coupons` (`code`);--> statement-breakpoint
CREATE TABLE `price_history` (
	`id` text PRIMARY KEY NOT NULL,
	`variant_id` text NOT NULL,
	`price_list_id` text NOT NULL,
	`old_amount` integer,
	`new_amount` integer NOT NULL,
	`currency` text DEFAULT 'EUR' NOT NULL,
	`channel` text NOT NULL,
	`effective_from` integer NOT NULL,
	`effective_to` integer,
	`reason` text,
	`changed_by` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`variant_id`) REFERENCES `product_variants`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`price_list_id`) REFERENCES `price_lists`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `price_history_variant_idx` ON `price_history` (`variant_id`,`effective_from`);--> statement-breakpoint
CREATE TABLE `price_lists` (
	`id` text PRIMARY KEY NOT NULL,
	`code` text NOT NULL,
	`name` text NOT NULL,
	`channel` text NOT NULL,
	`is_default` integer DEFAULT false NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `price_lists_code_unique` ON `price_lists` (`code`);--> statement-breakpoint
CREATE TABLE `promotion_products` (
	`id` text PRIMARY KEY NOT NULL,
	`promotion_id` text NOT NULL,
	`product_id` text,
	`variant_id` text,
	FOREIGN KEY (`promotion_id`) REFERENCES `promotions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`variant_id`) REFERENCES `product_variants`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `promotion_products_promotion_idx` ON `promotion_products` (`promotion_id`);--> statement-breakpoint
CREATE TABLE `promotions` (
	`id` text PRIMARY KEY NOT NULL,
	`code` text NOT NULL,
	`name` text NOT NULL,
	`discount_type` text NOT NULL,
	`discount_value` integer NOT NULL,
	`channel` text DEFAULT 'online' NOT NULL,
	`starts_at` integer NOT NULL,
	`ends_at` integer,
	`priority` integer DEFAULT 0 NOT NULL,
	`stackable` integer DEFAULT false NOT NULL,
	`min_quantity` integer,
	`min_order_amount` integer,
	`active` integer DEFAULT true NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`archived_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `promotions_code_unique` ON `promotions` (`code`);--> statement-breakpoint
CREATE INDEX `promotions_window_idx` ON `promotions` (`active`,`starts_at`,`ends_at`);--> statement-breakpoint
CREATE TABLE `variant_prices` (
	`id` text PRIMARY KEY NOT NULL,
	`variant_id` text NOT NULL,
	`price_list_id` text NOT NULL,
	`amount` integer NOT NULL,
	`currency` text DEFAULT 'EUR' NOT NULL,
	`prior_price_30d` integer,
	`prior_price_reference_date` integer,
	`cost_price` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`variant_id`) REFERENCES `product_variants`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`price_list_id`) REFERENCES `price_lists`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `variant_prices_unique` ON `variant_prices` (`variant_id`,`price_list_id`);--> statement-breakpoint
CREATE INDEX `variant_prices_variant_idx` ON `variant_prices` (`variant_id`);--> statement-breakpoint
CREATE TABLE `inventory_levels` (
	`id` text PRIMARY KEY NOT NULL,
	`variant_id` text NOT NULL,
	`location_id` text NOT NULL,
	`on_hand` integer DEFAULT 0 NOT NULL,
	`reserved` integer DEFAULT 0 NOT NULL,
	`incoming` integer DEFAULT 0 NOT NULL,
	`reorder_threshold` integer,
	`allow_backorder` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`variant_id`) REFERENCES `product_variants`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`location_id`) REFERENCES `inventory_locations`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "inventory_levels_reserved_bounds" CHECK("inventory_levels"."reserved" >= 0 AND "inventory_levels"."reserved" <= "inventory_levels"."on_hand"),
	CONSTRAINT "inventory_levels_on_hand_non_negative" CHECK("inventory_levels"."on_hand" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `inventory_levels_unique` ON `inventory_levels` (`variant_id`,`location_id`);--> statement-breakpoint
CREATE INDEX `inventory_levels_variant_idx` ON `inventory_levels` (`variant_id`);--> statement-breakpoint
CREATE TABLE `inventory_locations` (
	`id` text PRIMARY KEY NOT NULL,
	`code` text NOT NULL,
	`name` text NOT NULL,
	`location_type` text NOT NULL,
	`sellable_online` integer DEFAULT false NOT NULL,
	`sellable_in_store` integer DEFAULT false NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`archived_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `inventory_locations_code_unique` ON `inventory_locations` (`code`);--> statement-breakpoint
CREATE TABLE `stock_adjustments` (
	`id` text PRIMARY KEY NOT NULL,
	`variant_id` text NOT NULL,
	`location_id` text NOT NULL,
	`quantity_before` integer NOT NULL,
	`quantity_after` integer NOT NULL,
	`reason_code` text NOT NULL,
	`reason_note` text NOT NULL,
	`performed_by` text NOT NULL,
	`movement_id` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`variant_id`) REFERENCES `product_variants`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`location_id`) REFERENCES `inventory_locations`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`movement_id`) REFERENCES `stock_movements`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `stock_adjustments_variant_idx` ON `stock_adjustments` (`variant_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `stock_movements` (
	`id` text PRIMARY KEY NOT NULL,
	`variant_id` text NOT NULL,
	`location_id` text NOT NULL,
	`movement_type` text NOT NULL,
	`quantity_delta` integer NOT NULL,
	`quantity_before` integer NOT NULL,
	`quantity_after` integer NOT NULL,
	`reference_type` text,
	`reference_id` text,
	`reason` text,
	`performed_by` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`variant_id`) REFERENCES `product_variants`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`location_id`) REFERENCES `inventory_locations`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `stock_movements_variant_idx` ON `stock_movements` (`variant_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `stock_movements_reference_idx` ON `stock_movements` (`reference_type`,`reference_id`);--> statement-breakpoint
CREATE INDEX `stock_movements_location_idx` ON `stock_movements` (`location_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `stock_reservations` (
	`id` text PRIMARY KEY NOT NULL,
	`order_id` text NOT NULL,
	`variant_id` text NOT NULL,
	`location_id` text NOT NULL,
	`quantity` integer NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`expires_at` integer NOT NULL,
	`released_at` integer,
	`released_reason` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`variant_id`) REFERENCES `product_variants`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`location_id`) REFERENCES `inventory_locations`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `stock_reservations_sweep_idx` ON `stock_reservations` (`status`,`expires_at`);--> statement-breakpoint
CREATE INDEX `stock_reservations_order_idx` ON `stock_reservations` (`order_id`);--> statement-breakpoint
CREATE INDEX `stock_reservations_variant_idx` ON `stock_reservations` (`variant_id`,`status`);--> statement-breakpoint
CREATE TABLE `stock_transfer_items` (
	`id` text PRIMARY KEY NOT NULL,
	`transfer_id` text NOT NULL,
	`variant_id` text NOT NULL,
	`quantity_sent` integer NOT NULL,
	`quantity_received` integer,
	FOREIGN KEY (`transfer_id`) REFERENCES `stock_transfers`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`variant_id`) REFERENCES `product_variants`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `stock_transfer_items_transfer_idx` ON `stock_transfer_items` (`transfer_id`);--> statement-breakpoint
CREATE TABLE `stock_transfers` (
	`id` text PRIMARY KEY NOT NULL,
	`reference` text NOT NULL,
	`from_location_id` text NOT NULL,
	`to_location_id` text NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`note` text,
	`created_by` text NOT NULL,
	`received_by` text,
	`received_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`from_location_id`) REFERENCES `inventory_locations`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`to_location_id`) REFERENCES `inventory_locations`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `stock_transfers_reference_unique` ON `stock_transfers` (`reference`);--> statement-breakpoint
CREATE TABLE `cart_items` (
	`id` text PRIMARY KEY NOT NULL,
	`cart_id` text NOT NULL,
	`variant_id` text NOT NULL,
	`quantity` integer NOT NULL,
	`compatibility_at_add` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`cart_id`) REFERENCES `carts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`variant_id`) REFERENCES `product_variants`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `cart_items_unique` ON `cart_items` (`cart_id`,`variant_id`);--> statement-breakpoint
CREATE INDEX `cart_items_cart_idx` ON `cart_items` (`cart_id`);--> statement-breakpoint
CREATE TABLE `carts` (
	`id` text PRIMARY KEY NOT NULL,
	`token` text NOT NULL,
	`user_id` text,
	`device_model_id` text,
	`currency` text DEFAULT 'EUR' NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`device_model_id`) REFERENCES `device_models`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `carts_token_unique` ON `carts` (`token`);--> statement-breakpoint
CREATE INDEX `carts_user_idx` ON `carts` (`user_id`);--> statement-breakpoint
CREATE INDEX `carts_expiry_idx` ON `carts` (`expires_at`);--> statement-breakpoint
CREATE TABLE `order_addresses` (
	`id` text PRIMARY KEY NOT NULL,
	`order_id` text NOT NULL,
	`address_type` text NOT NULL,
	`first_name` text NOT NULL,
	`last_name` text NOT NULL,
	`street` text NOT NULL,
	`street_number` text,
	`postcode` text NOT NULL,
	`city` text NOT NULL,
	`province` text,
	`country` text DEFAULT 'IT' NOT NULL,
	`phone` text,
	`note` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `order_addresses_unique` ON `order_addresses` (`order_id`,`address_type`);--> statement-breakpoint
CREATE TABLE `order_events` (
	`id` text PRIMARY KEY NOT NULL,
	`order_id` text NOT NULL,
	`event_type` text NOT NULL,
	`payload` text,
	`customer_visible` integer DEFAULT true NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `order_events_order_idx` ON `order_events` (`order_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `order_items` (
	`id` text PRIMARY KEY NOT NULL,
	`order_id` text NOT NULL,
	`product_id` text,
	`variant_id` text,
	`product_name` text NOT NULL,
	`variant_label` text,
	`sku` text NOT NULL,
	`image_key` text,
	`compatibility_state` text,
	`device_model_name` text,
	`quantity` integer NOT NULL,
	`unit_price` integer NOT NULL,
	`discount_amount` integer DEFAULT 0 NOT NULL,
	`tax_amount` integer DEFAULT 0 NOT NULL,
	`line_total` integer NOT NULL,
	`currency` text DEFAULT 'EUR' NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`variant_id`) REFERENCES `product_variants`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `order_items_order_idx` ON `order_items` (`order_id`);--> statement-breakpoint
CREATE TABLE `order_notes` (
	`id` text PRIMARY KEY NOT NULL,
	`order_id` text NOT NULL,
	`body` text NOT NULL,
	`customer_visible` integer DEFAULT false NOT NULL,
	`author_id` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `order_notes_order_idx` ON `order_notes` (`order_id`,`customer_visible`);--> statement-breakpoint
CREATE TABLE `order_status_history` (
	`id` text PRIMARY KEY NOT NULL,
	`order_id` text NOT NULL,
	`from_status` text,
	`to_status` text NOT NULL,
	`reason` text,
	`actor` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `order_status_history_order_idx` ON `order_status_history` (`order_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `orders` (
	`id` text PRIMARY KEY NOT NULL,
	`order_number` text NOT NULL,
	`tracking_token` text NOT NULL,
	`user_id` text,
	`status` text DEFAULT 'draft' NOT NULL,
	`customer_first_name` text NOT NULL,
	`customer_last_name` text NOT NULL,
	`customer_email` text NOT NULL,
	`customer_phone` text,
	`customer_whatsapp` text,
	`delivery_method` text NOT NULL,
	`shipping_method_id` text,
	`pickup_location_id` text,
	`payment_method_id` text,
	`device_model_id` text,
	`item_subtotal` integer NOT NULL,
	`discount_total` integer DEFAULT 0 NOT NULL,
	`shipping_total` integer DEFAULT 0 NOT NULL,
	`tax_total` integer DEFAULT 0 NOT NULL,
	`grand_total` integer NOT NULL,
	`currency` text DEFAULT 'EUR' NOT NULL,
	`customer_note` text,
	`terms_version_id` text,
	`reservation_expires_at` integer,
	`placed_at` integer,
	`cancelled_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`device_model_id`) REFERENCES `device_models`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `orders_number_unique` ON `orders` (`order_number`);--> statement-breakpoint
CREATE UNIQUE INDEX `orders_tracking_token_unique` ON `orders` (`tracking_token`);--> statement-breakpoint
CREATE INDEX `orders_status_idx` ON `orders` (`status`,`created_at`);--> statement-breakpoint
CREATE INDEX `orders_email_idx` ON `orders` (`customer_email`);--> statement-breakpoint
CREATE INDEX `orders_user_idx` ON `orders` (`user_id`);--> statement-breakpoint
CREATE INDEX `orders_reservation_idx` ON `orders` (`reservation_expires_at`);--> statement-breakpoint
CREATE TABLE `order_payments` (
	`id` text PRIMARY KEY NOT NULL,
	`order_id` text NOT NULL,
	`payment_method_id` text NOT NULL,
	`status` text DEFAULT 'awaiting_customer_contact' NOT NULL,
	`amount_expected` integer NOT NULL,
	`amount_claimed` integer,
	`amount_received` integer,
	`currency` text DEFAULT 'EUR' NOT NULL,
	`transaction_reference` text,
	`verified_by` text,
	`verified_at` integer,
	`verification_note` text,
	`rejected_reason` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`payment_method_id`) REFERENCES `payment_methods`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `order_payments_order_idx` ON `order_payments` (`order_id`);--> statement-breakpoint
CREATE INDEX `order_payments_status_idx` ON `order_payments` (`status`,`created_at`);--> statement-breakpoint
CREATE INDEX `order_payments_reference_idx` ON `order_payments` (`transaction_reference`);--> statement-breakpoint
CREATE TABLE `payment_methods` (
	`id` text PRIMARY KEY NOT NULL,
	`code` text NOT NULL,
	`method_type` text NOT NULL,
	`name_it` text NOT NULL,
	`name_en` text NOT NULL,
	`description_it` text,
	`description_en` text,
	`active` integer DEFAULT false NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`beneficiary_name` text,
	`account_identifier_encrypted` text,
	`account_identifier_masked` text,
	`merchant_qr_key` text,
	`instructions_it` text,
	`instructions_en` text,
	`staff_instructions` text,
	`reservation_minutes` integer DEFAULT 1440 NOT NULL,
	`eligible_for_shipping` integer DEFAULT true NOT NULL,
	`eligible_for_pickup` integer DEFAULT true NOT NULL,
	`min_amount` integer,
	`max_amount` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`archived_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `payment_methods_code_unique` ON `payment_methods` (`code`);--> statement-breakpoint
CREATE TABLE `payment_proof_access_logs` (
	`id` text PRIMARY KEY NOT NULL,
	`proof_id` text NOT NULL,
	`accessed_by` text NOT NULL,
	`accessed_at` integer NOT NULL,
	`ip_address` text,
	FOREIGN KEY (`proof_id`) REFERENCES `payment_proofs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `payment_proof_access_proof_idx` ON `payment_proof_access_logs` (`proof_id`,`accessed_at`);--> statement-breakpoint
CREATE TABLE `payment_proofs` (
	`id` text PRIMARY KEY NOT NULL,
	`order_payment_id` text NOT NULL,
	`object_key` text NOT NULL,
	`mime_type` text NOT NULL,
	`file_size` integer NOT NULL,
	`original_filename_display` text,
	`uploaded_at` integer NOT NULL,
	`uploaded_by_ip` text,
	`deleted_at` integer,
	FOREIGN KEY (`order_payment_id`) REFERENCES `order_payments`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `payment_proofs_payment_idx` ON `payment_proofs` (`order_payment_id`);--> statement-breakpoint
CREATE TABLE `payment_status_history` (
	`id` text PRIMARY KEY NOT NULL,
	`order_payment_id` text NOT NULL,
	`from_status` text,
	`to_status` text NOT NULL,
	`amount_at_transition` integer,
	`reason` text,
	`actor` text NOT NULL,
	`is_correction` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`order_payment_id`) REFERENCES `order_payments`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `payment_status_history_payment_idx` ON `payment_status_history` (`order_payment_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `fulfilment_items` (
	`id` text PRIMARY KEY NOT NULL,
	`fulfilment_id` text NOT NULL,
	`order_item_id` text NOT NULL,
	`quantity` integer NOT NULL,
	FOREIGN KEY (`fulfilment_id`) REFERENCES `fulfilments`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`order_item_id`) REFERENCES `order_items`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `fulfilment_items_unique` ON `fulfilment_items` (`fulfilment_id`,`order_item_id`);--> statement-breakpoint
CREATE TABLE `fulfilment_status_history` (
	`id` text PRIMARY KEY NOT NULL,
	`fulfilment_id` text NOT NULL,
	`from_status` text,
	`to_status` text NOT NULL,
	`reason` text,
	`actor` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`fulfilment_id`) REFERENCES `fulfilments`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `fulfilment_status_history_idx` ON `fulfilment_status_history` (`fulfilment_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `fulfilments` (
	`id` text PRIMARY KEY NOT NULL,
	`order_id` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`fulfilment_type` text NOT NULL,
	`location_id` text,
	`prepared_by` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`location_id`) REFERENCES `inventory_locations`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `fulfilments_order_idx` ON `fulfilments` (`order_id`);--> statement-breakpoint
CREATE INDEX `fulfilments_status_idx` ON `fulfilments` (`status`);--> statement-breakpoint
CREATE TABLE `pickup_orders` (
	`id` text PRIMARY KEY NOT NULL,
	`order_id` text NOT NULL,
	`location_id` text NOT NULL,
	`ready_at` integer,
	`ready_by` text,
	`collected_at` integer,
	`collected_by` text,
	`collected_by_name` text,
	`pickup_deadline` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`location_id`) REFERENCES `inventory_locations`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `pickup_orders_order_unique` ON `pickup_orders` (`order_id`);--> statement-breakpoint
CREATE TABLE `refund_items` (
	`id` text PRIMARY KEY NOT NULL,
	`refund_id` text NOT NULL,
	`order_item_id` text NOT NULL,
	`quantity` integer NOT NULL,
	`amount` integer NOT NULL,
	FOREIGN KEY (`refund_id`) REFERENCES `refunds`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`order_item_id`) REFERENCES `order_items`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `refund_items_refund_idx` ON `refund_items` (`refund_id`);--> statement-breakpoint
CREATE TABLE `refunds` (
	`id` text PRIMARY KEY NOT NULL,
	`order_id` text NOT NULL,
	`return_request_id` text,
	`amount` integer NOT NULL,
	`currency` text DEFAULT 'EUR' NOT NULL,
	`refund_method` text NOT NULL,
	`reference` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`processed_by` text,
	`processed_at` integer,
	`note` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`return_request_id`) REFERENCES `return_requests`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `refunds_order_idx` ON `refunds` (`order_id`);--> statement-breakpoint
CREATE TABLE `return_items` (
	`id` text PRIMARY KEY NOT NULL,
	`return_request_id` text NOT NULL,
	`order_item_id` text NOT NULL,
	`quantity` integer NOT NULL,
	`condition_code` text,
	`inspection_note` text,
	FOREIGN KEY (`return_request_id`) REFERENCES `return_requests`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`order_item_id`) REFERENCES `order_items`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `return_items_request_idx` ON `return_items` (`return_request_id`);--> statement-breakpoint
CREATE TABLE `return_requests` (
	`id` text PRIMARY KEY NOT NULL,
	`order_id` text NOT NULL,
	`reference` text NOT NULL,
	`status` text DEFAULT 'requested' NOT NULL,
	`reason_code` text NOT NULL,
	`reason_note` text,
	`is_withdrawal` integer DEFAULT false NOT NULL,
	`requested_at` integer NOT NULL,
	`approved_by` text,
	`approved_at` integer,
	`received_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `return_requests_reference_unique` ON `return_requests` (`reference`);--> statement-breakpoint
CREATE INDEX `return_requests_order_idx` ON `return_requests` (`order_id`);--> statement-breakpoint
CREATE INDEX `return_requests_status_idx` ON `return_requests` (`status`,`requested_at`);--> statement-breakpoint
CREATE TABLE `shipments` (
	`id` text PRIMARY KEY NOT NULL,
	`fulfilment_id` text NOT NULL,
	`carrier_name` text,
	`tracking_number` text,
	`tracking_url` text,
	`shipped_at` integer,
	`delivered_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`fulfilment_id`) REFERENCES `fulfilments`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `shipments_fulfilment_idx` ON `shipments` (`fulfilment_id`);--> statement-breakpoint
CREATE TABLE `shipping_methods` (
	`id` text PRIMARY KEY NOT NULL,
	`code` text NOT NULL,
	`name_it` text NOT NULL,
	`name_en` text NOT NULL,
	`description_it` text,
	`description_en` text,
	`rate_type` text NOT NULL,
	`active` integer DEFAULT false NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`dispatch_note_it` text,
	`dispatch_note_en` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`archived_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `shipping_methods_code_unique` ON `shipping_methods` (`code`);--> statement-breakpoint
CREATE TABLE `shipping_rates` (
	`id` text PRIMARY KEY NOT NULL,
	`shipping_method_id` text NOT NULL,
	`shipping_zone_id` text NOT NULL,
	`amount` integer NOT NULL,
	`currency` text DEFAULT 'EUR' NOT NULL,
	`free_over_amount` integer,
	`min_weight_grams` integer,
	`max_weight_grams` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`shipping_method_id`) REFERENCES `shipping_methods`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`shipping_zone_id`) REFERENCES `shipping_zones`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `shipping_rates_unique` ON `shipping_rates` (`shipping_method_id`,`shipping_zone_id`);--> statement-breakpoint
CREATE TABLE `shipping_zones` (
	`id` text PRIMARY KEY NOT NULL,
	`code` text NOT NULL,
	`name` text NOT NULL,
	`countries` text NOT NULL,
	`postcode_prefixes` text,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `shipping_zones_code_unique` ON `shipping_zones` (`code`);--> statement-breakpoint
CREATE TABLE `banners` (
	`id` text PRIMARY KEY NOT NULL,
	`placement` text NOT NULL,
	`message_it` text NOT NULL,
	`message_en` text NOT NULL,
	`link_url` text,
	`image_key` text,
	`starts_at` integer,
	`ends_at` integer,
	`active` integer DEFAULT false NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `banners_placement_idx` ON `banners` (`placement`,`active`);--> statement-breakpoint
CREATE TABLE `homepage_section_translations` (
	`id` text PRIMARY KEY NOT NULL,
	`section_id` text NOT NULL,
	`locale` text NOT NULL,
	`heading` text,
	`subheading` text,
	`body_text` text,
	`cta_label` text,
	`cta_url` text,
	FOREIGN KEY (`section_id`) REFERENCES `homepage_sections`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `homepage_section_translations_unique` ON `homepage_section_translations` (`section_id`,`locale`);--> statement-breakpoint
CREATE TABLE `homepage_sections` (
	`id` text PRIMARY KEY NOT NULL,
	`section_type` text NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`visible` integer DEFAULT true NOT NULL,
	`config` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `homepage_sections_order_idx` ON `homepage_sections` (`sort_order`);--> statement-breakpoint
CREATE TABLE `legal_document_versions` (
	`id` text PRIMARY KEY NOT NULL,
	`document_id` text NOT NULL,
	`version` text NOT NULL,
	`body_it` text,
	`body_en` text,
	`effective_from` integer NOT NULL,
	`published_at` integer,
	`published_by` text,
	`reviewed_by_lawyer` integer DEFAULT false NOT NULL,
	`review_note` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`document_id`) REFERENCES `legal_documents`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `legal_document_versions_unique` ON `legal_document_versions` (`document_id`,`version`);--> statement-breakpoint
CREATE INDEX `legal_document_versions_effective_idx` ON `legal_document_versions` (`document_id`,`effective_from`);--> statement-breakpoint
CREATE TABLE `legal_documents` (
	`id` text PRIMARY KEY NOT NULL,
	`code` text NOT NULL,
	`name_it` text NOT NULL,
	`name_en` text NOT NULL,
	`current_version_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `legal_documents_code_unique` ON `legal_documents` (`code`);--> statement-breakpoint
CREATE TABLE `navigation_items` (
	`id` text PRIMARY KEY NOT NULL,
	`menu_id` text NOT NULL,
	`parent_id` text,
	`label_it` text NOT NULL,
	`label_en` text NOT NULL,
	`url` text NOT NULL,
	`icon_name` text,
	`depth` integer DEFAULT 0 NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`visible` integer DEFAULT true NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`menu_id`) REFERENCES `navigation_menus`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `navigation_items_menu_idx` ON `navigation_items` (`menu_id`,`sort_order`);--> statement-breakpoint
CREATE INDEX `navigation_items_parent_idx` ON `navigation_items` (`parent_id`);--> statement-breakpoint
CREATE TABLE `navigation_menus` (
	`id` text PRIMARY KEY NOT NULL,
	`code` text NOT NULL,
	`name` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `navigation_menus_code_unique` ON `navigation_menus` (`code`);--> statement-breakpoint
CREATE TABLE `page_translations` (
	`id` text PRIMARY KEY NOT NULL,
	`page_id` text NOT NULL,
	`locale` text NOT NULL,
	`title` text NOT NULL,
	`excerpt` text,
	`body` text,
	`seo_title` text,
	`seo_description` text,
	FOREIGN KEY (`page_id`) REFERENCES `pages`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `page_translations_unique` ON `page_translations` (`page_id`,`locale`);--> statement-breakpoint
CREATE TABLE `pages` (
	`id` text PRIMARY KEY NOT NULL,
	`slug` text NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`publish_at` integer,
	`page_type` text DEFAULT 'page' NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`archived_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `pages_slug_unique` ON `pages` (`slug`);--> statement-breakpoint
CREATE INDEX `pages_status_idx` ON `pages` (`status`,`publish_at`);--> statement-breakpoint
CREATE TABLE `store_settings` (
	`id` text PRIMARY KEY NOT NULL,
	`key` text NOT NULL,
	`value` text DEFAULT '' NOT NULL,
	`value_type` text DEFAULT 'string' NOT NULL,
	`category` text NOT NULL,
	`description_it` text,
	`gates_feature` integer DEFAULT false NOT NULL,
	`is_sensitive` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `store_settings_key_unique` ON `store_settings` (`key`);--> statement-breakpoint
CREATE INDEX `store_settings_category_idx` ON `store_settings` (`category`);--> statement-breakpoint
CREATE TABLE `audit_logs` (
	`id` text PRIMARY KEY NOT NULL,
	`actor_id` text NOT NULL,
	`actor_label` text,
	`action` text NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` text NOT NULL,
	`before_value` text,
	`after_value` text,
	`request_id` text,
	`ip_address` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `audit_logs_entity_idx` ON `audit_logs` (`entity_type`,`entity_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `audit_logs_actor_idx` ON `audit_logs` (`actor_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `audit_logs_action_idx` ON `audit_logs` (`action`,`created_at`);--> statement-breakpoint
CREATE TABLE `email_logs` (
	`id` text PRIMARY KEY NOT NULL,
	`outbox_event_id` text,
	`recipient` text NOT NULL,
	`template` text NOT NULL,
	`subject` text NOT NULL,
	`status` text NOT NULL,
	`provider_message_id` text,
	`error` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`outbox_event_id`) REFERENCES `outbox_events`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `email_logs_recipient_idx` ON `email_logs` (`recipient`,`created_at`);--> statement-breakpoint
CREATE INDEX `email_logs_status_idx` ON `email_logs` (`status`,`created_at`);--> statement-breakpoint
CREATE TABLE `export_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`export_type` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`result_object_key` text,
	`row_count` integer,
	`filters` text,
	`created_by` text NOT NULL,
	`completed_at` integer,
	`expires_at` integer,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `export_jobs_status_idx` ON `export_jobs` (`status`,`created_at`);--> statement-breakpoint
CREATE TABLE `feature_flags` (
	`id` text PRIMARY KEY NOT NULL,
	`key` text NOT NULL,
	`description` text NOT NULL,
	`enabled` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `feature_flags_key_unique` ON `feature_flags` (`key`);--> statement-breakpoint
CREATE TABLE `idempotency_keys` (
	`id` text PRIMARY KEY NOT NULL,
	`key` text NOT NULL,
	`scope` text NOT NULL,
	`owner_token` text,
	`result_payload` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idempotency_keys_unique` ON `idempotency_keys` (`key`,`scope`);--> statement-breakpoint
CREATE INDEX `idempotency_keys_expiry_idx` ON `idempotency_keys` (`expires_at`);--> statement-breakpoint
CREATE TABLE `import_job_rows` (
	`id` text PRIMARY KEY NOT NULL,
	`import_job_id` text NOT NULL,
	`row_number` integer NOT NULL,
	`outcome` text NOT NULL,
	`entity_type` text,
	`entity_id` text,
	`message` text,
	`raw_data` text,
	FOREIGN KEY (`import_job_id`) REFERENCES `import_jobs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `import_job_rows_job_idx` ON `import_job_rows` (`import_job_id`,`row_number`);--> statement-breakpoint
CREATE TABLE `import_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`import_type` text NOT NULL,
	`filename` text NOT NULL,
	`source_object_key` text,
	`status` text DEFAULT 'uploaded' NOT NULL,
	`rows_total` integer DEFAULT 0 NOT NULL,
	`rows_to_create` integer DEFAULT 0 NOT NULL,
	`rows_to_update` integer DEFAULT 0 NOT NULL,
	`rows_unchanged` integer DEFAULT 0 NOT NULL,
	`rows_with_warnings` integer DEFAULT 0 NOT NULL,
	`rows_with_errors` integer DEFAULT 0 NOT NULL,
	`created_by` text NOT NULL,
	`confirmed_by` text,
	`confirmed_at` integer,
	`completed_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `import_jobs_status_idx` ON `import_jobs` (`status`,`created_at`);--> statement-breakpoint
CREATE TABLE `outbox_events` (
	`id` text PRIMARY KEY NOT NULL,
	`event_type` text NOT NULL,
	`aggregate_type` text NOT NULL,
	`aggregate_id` text NOT NULL,
	`payload` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`last_error` text,
	`next_attempt_at` integer,
	`delivered_at` integer,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `outbox_events_pending_idx` ON `outbox_events` (`status`,`next_attempt_at`);--> statement-breakpoint
CREATE INDEX `outbox_events_aggregate_idx` ON `outbox_events` (`aggregate_type`,`aggregate_id`);--> statement-breakpoint
CREATE TABLE `scheduled_job_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`job_name` text NOT NULL,
	`status` text NOT NULL,
	`started_at` integer NOT NULL,
	`finished_at` integer,
	`items_processed` integer DEFAULT 0 NOT NULL,
	`error` text,
	`summary` text
);
--> statement-breakpoint
CREATE INDEX `scheduled_job_runs_job_idx` ON `scheduled_job_runs` (`job_name`,`started_at`);--> statement-breakpoint
CREATE TABLE `system_settings` (
	`id` text PRIMARY KEY NOT NULL,
	`key` text NOT NULL,
	`value` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `system_settings_key_unique` ON `system_settings` (`key`);