CREATE TABLE `notification` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`type` text NOT NULL,
	`game_id` integer,
	`game_title` text NOT NULL,
	`message` text NOT NULL,
	`is_read` integer DEFAULT false NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`game_id`) REFERENCES `game`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_notification_is_read` ON `notification` (`is_read`);--> statement-breakpoint
CREATE INDEX `idx_notification_created_at` ON `notification` (`created_at`);--> statement-breakpoint
ALTER TABLE `game` ADD `auto_download_enabled` integer;