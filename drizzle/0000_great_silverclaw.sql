CREATE TABLE `app_setting` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`updated_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `game` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`title` text NOT NULL,
	`search_query` text NOT NULL,
	`current_version_date` text NOT NULL,
	`current_version` text,
	`status` text DEFAULT 'monitored' NOT NULL,
	`platform_filter` text DEFAULT 'Windows' NOT NULL,
	`exclude_keywords` text,
	`is_manual` integer DEFAULT 0 NOT NULL,
	`qbit_synced_at` text,
	`igdb_id` integer,
	`cover_url` text,
	`steam_app_id` integer,
	`source_url` text,
	`raw_name` text,
	`info_hash` text,
	`created_at` text NOT NULL,
	`last_scanned_at` text
);
--> statement-breakpoint
CREATE INDEX `idx_game_title` ON `game` (`title`);--> statement-breakpoint
CREATE TABLE `ignored_release` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`game_id` integer NOT NULL,
	`release_title` text NOT NULL,
	`ignored_at` text NOT NULL,
	FOREIGN KEY (`game_id`) REFERENCES `game`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_ignored_release_game_id` ON `ignored_release` (`game_id`);--> statement-breakpoint
CREATE TABLE `release` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`game_id` integer NOT NULL,
	`raw_title` text NOT NULL,
	`parsed_version` text,
	`upload_date` text NOT NULL,
	`indexer` text NOT NULL,
	`magnet_url` text,
	`info_url` text,
	`size` text,
	`seeders` integer,
	`leechers` integer,
	`grabs` integer,
	`is_ignored` integer DEFAULT 0 NOT NULL,
	`found_at` text NOT NULL,
	FOREIGN KEY (`game_id`) REFERENCES `game`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_release_game_id` ON `release` (`game_id`);--> statement-breakpoint
CREATE INDEX `idx_release_raw_title` ON `release` (`raw_title`);--> statement-breakpoint
CREATE TABLE `scan_log` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`started_at` text NOT NULL,
	`duration_seconds` real DEFAULT 0 NOT NULL,
	`games_processed` integer DEFAULT 0 NOT NULL,
	`updates_found` integer DEFAULT 0 NOT NULL,
	`status` text DEFAULT 'success' NOT NULL,
	`details` text,
	`skip_details` text
);
