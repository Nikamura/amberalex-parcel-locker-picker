ALTER TABLE `lockers` ADD `search` text DEFAULT '' NOT NULL;--> statement-breakpoint
CREATE INDEX `lockers_country_zip` ON `lockers` (`country_code`,`zip`);