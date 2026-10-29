CREATE TABLE `lockers` (
	`source` text NOT NULL,
	`external_id` text NOT NULL,
	`network` text NOT NULL,
	`country_code` text NOT NULL,
	`name` text NOT NULL,
	`address` text NOT NULL,
	`city` text NOT NULL,
	`zip` text NOT NULL,
	`lat` real NOT NULL,
	`lng` real NOT NULL,
	`comment` text,
	`updated_at` text NOT NULL,
	PRIMARY KEY(`source`, `external_id`)
);
--> statement-breakpoint
CREATE INDEX `lockers_country_network` ON `lockers` (`country_code`,`network`);--> statement-breakpoint
CREATE TABLE `session` (
	`id` text PRIMARY KEY NOT NULL,
	`shop` text NOT NULL,
	`state` text NOT NULL,
	`isOnline` integer DEFAULT false NOT NULL,
	`scope` text,
	`expires` text,
	`accessToken` text NOT NULL,
	`userId` blob,
	`firstName` text,
	`lastName` text,
	`email` text,
	`accountOwner` integer,
	`locale` text,
	`collaborator` integer,
	`emailVerified` integer,
	`refreshToken` text,
	`refreshTokenExpires` text
);
--> statement-breakpoint
CREATE TABLE `shop_settings` (
	`shop` text PRIMARY KEY NOT NULL,
	`settings` text NOT NULL,
	`carrier_service_id` text,
	`currency` text,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `sync_runs` (
	`source` text PRIMARY KEY NOT NULL,
	`finished_at` text NOT NULL,
	`count` integer NOT NULL,
	`error` text
);
