CREATE TABLE `locker_snapshot` (
	`country_code` text PRIMARY KEY NOT NULL,
	`version` text NOT NULL,
	`data` text NOT NULL
);
--> statement-breakpoint
INSERT INTO `locker_snapshot` (`country_code`,`version`,`data`) SELECT `country_code`, strftime('%Y-%m-%dT%H:%M:%fZ','now'), json_group_array(json_array(`source`,`external_id`,`network`,`name`,`address`,`city`,`zip`,`lat`,`lng`,`comment`,`search`)) FROM `lockers` GROUP BY `country_code`;
