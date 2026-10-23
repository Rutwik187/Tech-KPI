CREATE TABLE "tech_kpi_due_date_request" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"item_id" uuid NOT NULL,
	"requester_id" text NOT NULL,
	"from_date" date NOT NULL,
	"from_estimate" numeric(6, 2) NOT NULL,
	"hours" numeric(6, 2) NOT NULL,
	"approved_hours" numeric(6, 2),
	"reason_category" text NOT NULL,
	"reason" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"reviewed_by_id" text,
	"reviewed_at" timestamp with time zone,
	"review_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tech_kpi_due_date_request_hours" CHECK ("tech_kpi_due_date_request"."hours" > 0 AND "tech_kpi_due_date_request"."hours" <= 80 AND ("tech_kpi_due_date_request"."approved_hours" IS NULL OR ("tech_kpi_due_date_request"."approved_hours" > 0 AND "tech_kpi_due_date_request"."approved_hours" <= 80))),
	CONSTRAINT "tech_kpi_due_date_request_category" CHECK ("tech_kpi_due_date_request"."reason_category" IN ('scope_change', 'blocked_dependency', 'underestimated', 'other')),
	CONSTRAINT "tech_kpi_due_date_request_status" CHECK ("tech_kpi_due_date_request"."status" IN ('pending', 'approved', 'declined')),
	CONSTRAINT "tech_kpi_due_date_request_reviewed" CHECK (("tech_kpi_due_date_request"."status" = 'pending') = ("tech_kpi_due_date_request"."reviewed_at" IS NULL))
);
--> statement-breakpoint
ALTER TABLE "tech_kpi_due_date_request" ADD CONSTRAINT "tech_kpi_due_date_request_item_id_tech_kpi_work_item_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."tech_kpi_work_item"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tech_kpi_due_date_request" ADD CONSTRAINT "tech_kpi_due_date_request_requester_id_user_id_fk" FOREIGN KEY ("requester_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tech_kpi_due_date_request" ADD CONSTRAINT "tech_kpi_due_date_request_reviewed_by_id_user_id_fk" FOREIGN KEY ("reviewed_by_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "tech_kpi_due_date_request_status_idx" ON "tech_kpi_due_date_request" USING btree ("status","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "tech_kpi_due_date_request_one_pending" ON "tech_kpi_due_date_request" USING btree ("item_id") WHERE "tech_kpi_due_date_request"."status" = 'pending';
