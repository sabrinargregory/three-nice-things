CREATE TABLE `chat_session` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` text NOT NULL,
	`started_at` integer NOT NULL,
	`last_active_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `chat_session_user_idx` ON `chat_session` (`user_id`,`last_active_at`);--> statement-breakpoint
ALTER TABLE `chat_message` ADD `session_id` integer REFERENCES chat_session(id);