CREATE TABLE "tech_kpi_ticket_request" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"requester_id" text NOT NULL,
	"title" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"project_id" uuid NOT NULL,
	"phase_id" uuid,
	"estimate_hours" numeric(6, 2) NOT NULL,
	"due_date" date,
	"priority" "tech_kpi_priority" DEFAULT 'medium' NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"reviewed_by_id" text,
	"reviewed_at" timestamp with time zone,
	"review_note" text,
	"item_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tech_kpi_ticket_request_estimate_range" CHECK ("tech_kpi_ticket_request"."estimate_hours" > 0 AND "tech_kpi_ticket_request"."estimate_hours" <= 80),
	CONSTRAINT "tech_kpi_ticket_request_status" CHECK ("tech_kpi_ticket_request"."status" IN ('pending', 'approved', 'declined')),
	CONSTRAINT "tech_kpi_ticket_request_reviewed" CHECK (("tech_kpi_ticket_request"."status" = 'pending') = ("tech_kpi_ticket_request"."reviewed_at" IS NULL))
);
--> statement-breakpoint
ALTER TABLE "tech_kpi_ticket_request" ADD CONSTRAINT "tech_kpi_ticket_request_requester_id_user_id_fk" FOREIGN KEY ("requester_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tech_kpi_ticket_request" ADD CONSTRAINT "tech_kpi_ticket_request_project_id_tech_kpi_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."tech_kpi_project"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tech_kpi_ticket_request" ADD CONSTRAINT "tech_kpi_ticket_request_reviewed_by_id_user_id_fk" FOREIGN KEY ("reviewed_by_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tech_kpi_ticket_request" ADD CONSTRAINT "tech_kpi_ticket_request_item_id_tech_kpi_work_item_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."tech_kpi_work_item"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tech_kpi_ticket_request" ADD CONSTRAINT "tech_kpi_ticket_request_project_phase_fk" FOREIGN KEY ("project_id","phase_id") REFERENCES "public"."tech_kpi_project_phase"("project_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "tech_kpi_ticket_request_status_idx" ON "tech_kpi_ticket_request" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "tech_kpi_ticket_request_requester_idx" ON "tech_kpi_ticket_request" USING btree ("requester_id");
