CREATE TABLE `shipments` (
	`shop` text NOT NULL,
	`order_id` text NOT NULL,
	`order_name` text,
	`locker_id` text,
	`service_code` text,
	`status` text NOT NULL,
	`shipment_id` text,
	`tracking_number` text,
	`error` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	PRIMARY KEY(`shop`, `order_id`)
);
