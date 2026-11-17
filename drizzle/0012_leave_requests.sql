CREATE TABLE "tech_kpi_leave_request" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "requester_id" text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  "dates" jsonb NOT NULL,
  "type" text NOT NULL,
  "note" text DEFAULT '' NOT NULL,
  "status" text DEFAULT 'pending' NOT NULL,
  "reviewed_by_id" text REFERENCES "user"("id") ON DELETE SET NULL,
  "reviewed_at" timestamptz,
  "review_note" text,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "tech_kpi_leave_request_status" CHECK ("status" IN ('pending','approved','declined')),
  CONSTRAINT "tech_kpi_leave_request_type" CHECK ("type" IN ('full_day','half_day')),
  CONSTRAINT "tech_kpi_leave_request_dates" CHECK (jsonb_typeof("dates") = 'array' AND jsonb_array_length("dates") BETWEEN 1 AND 62),
  CONSTRAINT "tech_kpi_leave_request_reviewed" CHECK (("status" = 'pending') = ("reviewed_at" IS NULL))
);
--> statement-breakpoint
CREATE INDEX "tech_kpi_leave_request_requester_idx" ON "tech_kpi_leave_request" ("requester_id");
--> statement-breakpoint
CREATE INDEX "tech_kpi_leave_request_status_idx" ON "tech_kpi_leave_request" ("status", "created_at");
