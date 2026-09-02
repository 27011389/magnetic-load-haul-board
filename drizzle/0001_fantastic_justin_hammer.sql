CREATE TABLE `magnetic_board_presence` (
	`session_id` text PRIMARY KEY NOT NULL,
	`display_name` text NOT NULL,
	`active_magnet_id` text,
	`updated_at` text NOT NULL
);
