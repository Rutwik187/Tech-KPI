CREATE TYPE "public"."tech_kpi_priority" AS ENUM('low', 'medium', 'high', 'urgent');--> statement-breakpoint
CREATE TYPE "public"."tech_kpi_severity" AS ENUM('normal', 'critical');--> statement-breakpoint
CREATE TYPE "public"."tech_kpi_item_type" AS ENUM('task', 'bug');--> statement-breakpoint
CREATE TYPE "public"."tech_kpi_work_status" AS ENUM('todo', 'in_progress', 'blocked', 'in_review', 'done', 'open', 'fixed', 'verified');--> statement-breakpoint
CREATE TABLE "tech_kpi_activity" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entity_id" text NOT NULL,
	"actor_id" text NOT NULL,
	"action" text NOT NULL,
	"reason" text,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tech_kpi_attachment" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"item_id" uuid NOT NULL,
	"uploaded_by_id" text NOT NULL,
	"name" text NOT NULL,
	"mime_type" text NOT NULL,
	"size" integer NOT NULL,
	"object_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tech_kpi_holiday" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"date" date NOT NULL,
	"name" text NOT NULL,
	CONSTRAINT "tech_kpi_holiday_date_unique" UNIQUE("date")
);
--> statement-breakpoint
CREATE TABLE "tech_kpi_leave" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"date" date NOT NULL,
	"type" text NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	CONSTRAINT "tech_kpi_leave_type" CHECK ("tech_kpi_leave"."type" IN ('full_day','half_day'))
);
--> statement-breakpoint
CREATE TABLE "tech_kpi_member_profile" (
	"user_id" text PRIMARY KEY NOT NULL,
	"capacity" numeric(6, 2) DEFAULT 33 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"joined_on" date DEFAULT (now() AT TIME ZONE 'Asia/Kolkata')::date NOT NULL,
	CONSTRAINT "tech_kpi_capacity_range" CHECK ("tech_kpi_member_profile"."capacity" > 0 AND "tech_kpi_member_profile"."capacity" <= 168)
);
--> statement-breakpoint
CREATE TABLE "tech_kpi_project" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"color" text DEFAULT '#2563eb' NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"is_archived" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tech_kpi_project_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "tech_kpi_settings" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"value" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tech_kpi_settings_singleton" CHECK ("tech_kpi_settings"."id" = 1)
);
--> statement-breakpoint
CREATE TABLE "tech_kpi_weekly_snapshot" (
	"user_id" text NOT NULL,
	"week_start" date NOT NULL,
	"value" jsonb NOT NULL,
	"computed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tech_kpi_weekly_snapshot_user_id_week_start_pk" PRIMARY KEY("user_id","week_start")
);
--> statement-breakpoint
CREATE TABLE "tech_kpi_work_item" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sequence" integer GENERATED ALWAYS AS IDENTITY (sequence name "tech_kpi_work_item_sequence_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"type" "tech_kpi_item_type" NOT NULL,
	"title" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"project_id" uuid NOT NULL,
	"assignee_id" text NOT NULL,
	"created_by_id" text NOT NULL,
	"status" "tech_kpi_work_status" NOT NULL,
	"priority" "tech_kpi_priority" DEFAULT 'medium' NOT NULL,
	"severity" "tech_kpi_severity" DEFAULT 'normal' NOT NULL,
	"estimate_hours" numeric(6, 2) DEFAULT 0 NOT NULL,
	"original_estimate_hours" numeric(6, 2) DEFAULT 0 NOT NULL,
	"due_date" date,
	"original_due_date" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"submitted_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"fixed_at" timestamp with time zone,
	"reported_at" timestamp with time zone DEFAULT now() NOT NULL,
	"verified_at" timestamp with time zone,
	"blocker" text,
	"task_id" uuid,
	"reopen_count" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "tech_kpi_work_item_sequence_unique" UNIQUE("sequence"),
	CONSTRAINT "tech_kpi_item_estimate_range" CHECK (("tech_kpi_work_item"."type" = 'task' AND "tech_kpi_work_item"."estimate_hours" > 0 AND "tech_kpi_work_item"."estimate_hours" <= 80) OR ("tech_kpi_work_item"."type" = 'bug' AND "tech_kpi_work_item"."estimate_hours" = 0)),
	CONSTRAINT "tech_kpi_item_status_type" CHECK (("tech_kpi_work_item"."type" = 'task' AND "tech_kpi_work_item"."status" IN ('todo', 'in_progress', 'blocked', 'in_review', 'done')) OR ("tech_kpi_work_item"."type" = 'bug' AND "tech_kpi_work_item"."status" IN ('open', 'in_progress', 'fixed', 'verified')))
);
--> statement-breakpoint
CREATE TABLE "account" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp with time zone,
	"refresh_token_expires_at" timestamp with time zone,
	"scope" text,
	"password" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rate_limit" (
	"id" text PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"count" integer NOT NULL,
	"last_request" bigint NOT NULL,
	CONSTRAINT "rate_limit_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "session" (
	"id" text PRIMARY KEY NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"token" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"user_id" text NOT NULL,
	"impersonated_by" text,
	CONSTRAINT "session_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "user" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"role" text,
	"banned" boolean DEFAULT false,
	"ban_reason" text,
	"ban_expires" timestamp with time zone,
	CONSTRAINT "user_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "verification" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "tech_kpi_activity" ADD CONSTRAINT "tech_kpi_activity_actor_id_user_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tech_kpi_attachment" ADD CONSTRAINT "tech_kpi_attachment_item_id_tech_kpi_work_item_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."tech_kpi_work_item"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tech_kpi_attachment" ADD CONSTRAINT "tech_kpi_attachment_uploaded_by_id_user_id_fk" FOREIGN KEY ("uploaded_by_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tech_kpi_leave" ADD CONSTRAINT "tech_kpi_leave_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tech_kpi_member_profile" ADD CONSTRAINT "tech_kpi_member_profile_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tech_kpi_weekly_snapshot" ADD CONSTRAINT "tech_kpi_weekly_snapshot_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tech_kpi_work_item" ADD CONSTRAINT "tech_kpi_work_item_project_id_tech_kpi_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."tech_kpi_project"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tech_kpi_work_item" ADD CONSTRAINT "tech_kpi_work_item_assignee_id_user_id_fk" FOREIGN KEY ("assignee_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tech_kpi_work_item" ADD CONSTRAINT "tech_kpi_work_item_created_by_id_user_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "tech_kpi_activity_entity_idx" ON "tech_kpi_activity" USING btree ("entity_id","created_at");--> statement-breakpoint
CREATE INDEX "tech_kpi_attachment_item_idx" ON "tech_kpi_attachment" USING btree ("item_id");--> statement-breakpoint
CREATE UNIQUE INDEX "tech_kpi_leave_user_date_idx" ON "tech_kpi_leave" USING btree ("user_id","date");--> statement-breakpoint
CREATE INDEX "tech_kpi_item_assignee_status_idx" ON "tech_kpi_work_item" USING btree ("assignee_id","status");--> statement-breakpoint
CREATE INDEX "tech_kpi_item_project_idx" ON "tech_kpi_work_item" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "tech_kpi_item_completed_idx" ON "tech_kpi_work_item" USING btree ("completed_at");--> statement-breakpoint
CREATE INDEX "account_userId_idx" ON "account" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "session_userId_idx" ON "session" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "verification_identifier_idx" ON "verification" USING btree ("identifier");