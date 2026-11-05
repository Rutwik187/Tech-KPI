CREATE TABLE "tech_kpi_department" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"is_archived" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tech_kpi_department_name_filled" CHECK (length(btrim("tech_kpi_department"."name")) > 0),
	CONSTRAINT "tech_kpi_department_position_nonnegative" CHECK ("tech_kpi_department"."position" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "tech_kpi_department_name_idx" ON "tech_kpi_department" USING btree (lower("name"));--> statement-breakpoint
INSERT INTO "tech_kpi_department" ("name", "position") VALUES
	('Sales', 0), ('E-commerce', 1), ('Influencer marketing', 2), ('Digital marketing', 3), ('Creative', 4), ('Graphics', 5)
ON CONFLICT DO NOTHING;--> statement-breakpoint
ALTER TABLE "tech_kpi_member_profile" ADD COLUMN "department_id" uuid;--> statement-breakpoint
ALTER TABLE "tech_kpi_member_profile" ADD CONSTRAINT "tech_kpi_member_profile_department_id_tech_kpi_department_id_fk" FOREIGN KEY ("department_id") REFERENCES "public"."tech_kpi_department"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE TABLE "tech_kpi_tech_request" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sequence" integer GENERATED ALWAYS AS IDENTITY (sequence name "tech_kpi_tech_request_sequence_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"requester_id" text NOT NULL,
	"department_id" uuid NOT NULL,
	"title" text NOT NULL,
	"description" text NOT NULL,
	"category" text NOT NULL,
	"priority" "tech_kpi_priority" DEFAULT 'medium' NOT NULL,
	"needed_by" date,
	"status" text DEFAULT 'new' NOT NULL,
	"reviewed_by_id" text,
	"reviewed_at" timestamp with time zone,
	"review_note" text,
	"item_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tech_kpi_tech_request_sequence_unique" UNIQUE("sequence"),
	CONSTRAINT "tech_kpi_tech_request_category" CHECK ("tech_kpi_tech_request"."category" IN ('feature', 'change', 'problem', 'data', 'access', 'other')),
	CONSTRAINT "tech_kpi_tech_request_status" CHECK ("tech_kpi_tech_request"."status" IN ('new', 'assigned', 'declined')),
	CONSTRAINT "tech_kpi_tech_request_reviewed" CHECK (("tech_kpi_tech_request"."status" = 'new') = ("tech_kpi_tech_request"."reviewed_at" IS NULL)),
	CONSTRAINT "tech_kpi_tech_request_decline_reason" CHECK ("tech_kpi_tech_request"."status" <> 'declined' OR length(btrim(coalesce("tech_kpi_tech_request"."review_note", ''))) > 0)
);
--> statement-breakpoint
ALTER TABLE "tech_kpi_tech_request" ADD CONSTRAINT "tech_kpi_tech_request_requester_id_user_id_fk" FOREIGN KEY ("requester_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tech_kpi_tech_request" ADD CONSTRAINT "tech_kpi_tech_request_department_id_tech_kpi_department_id_fk" FOREIGN KEY ("department_id") REFERENCES "public"."tech_kpi_department"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tech_kpi_tech_request" ADD CONSTRAINT "tech_kpi_tech_request_reviewed_by_id_user_id_fk" FOREIGN KEY ("reviewed_by_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tech_kpi_tech_request" ADD CONSTRAINT "tech_kpi_tech_request_item_id_tech_kpi_work_item_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."tech_kpi_work_item"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "tech_kpi_tech_request_status_idx" ON "tech_kpi_tech_request" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "tech_kpi_tech_request_requester_idx" ON "tech_kpi_tech_request" USING btree ("requester_id");--> statement-breakpoint
CREATE INDEX "tech_kpi_tech_request_department_idx" ON "tech_kpi_tech_request" USING btree ("department_id");--> statement-breakpoint
CREATE UNIQUE INDEX "tech_kpi_tech_request_item_idx" ON "tech_kpi_tech_request" USING btree ("item_id") WHERE "tech_kpi_tech_request"."item_id" IS NOT NULL;
