CREATE SCHEMA "billing";
--> statement-breakpoint
CREATE TABLE "billing"."state" (
	"subject_id" text PRIMARY KEY NOT NULL,
	"version" bigint DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'none' NOT NULL,
	"product_id" text,
	"period_start" timestamp with time zone,
	"period_end" timestamp with time zone,
	"credits" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"dirty_at" timestamp with time zone,
	"synced_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "billing"."usage_event" (
	"id" uuid PRIMARY KEY NOT NULL,
	"recorded_at" timestamp with time zone NOT NULL,
	"subject_id" text NOT NULL,
	"meter" text NOT NULL,
	"period_start" timestamp with time zone NOT NULL,
	"units" bigint NOT NULL,
	"shipped_at" timestamp with time zone,
	"ship_error" text
);
--> statement-breakpoint
CREATE INDEX "state_dirty" ON "billing"."state" USING btree ("dirty_at") WHERE "billing"."state"."dirty_at" is not null;--> statement-breakpoint
CREATE INDEX "usage_event_unshipped" ON "billing"."usage_event" USING btree ("recorded_at") WHERE "billing"."usage_event"."shipped_at" is null and "billing"."usage_event"."ship_error" is null;--> statement-breakpoint
CREATE INDEX "usage_event_period" ON "billing"."usage_event" USING btree ("subject_id","period_start","meter");