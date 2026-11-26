-- Requests from other teams now pass a project manager before the tech lead.
-- Existing new requests stay "new", so they wait for a project manager. The tech lead can still act on them directly.
ALTER TABLE "tech_kpi_tech_request" ADD COLUMN "tool" text DEFAULT '' NOT NULL;
--> statement-breakpoint
ALTER TABLE "tech_kpi_tech_request" ADD COLUMN "forwarded_by_id" text REFERENCES "user"("id") ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE "tech_kpi_tech_request" ADD COLUMN "forwarded_at" timestamptz;
--> statement-breakpoint
ALTER TABLE "tech_kpi_tech_request" DROP CONSTRAINT "tech_kpi_tech_request_category";
--> statement-breakpoint
ALTER TABLE "tech_kpi_tech_request" ADD CONSTRAINT "tech_kpi_tech_request_category" CHECK ("category" IN ('feature', 'tool', 'change', 'problem', 'data', 'access', 'other'));
--> statement-breakpoint
ALTER TABLE "tech_kpi_tech_request" DROP CONSTRAINT "tech_kpi_tech_request_status";
--> statement-breakpoint
ALTER TABLE "tech_kpi_tech_request" ADD CONSTRAINT "tech_kpi_tech_request_status" CHECK ("status" IN ('new', 'forwarded', 'assigned', 'declined'));
--> statement-breakpoint
ALTER TABLE "tech_kpi_tech_request" DROP CONSTRAINT "tech_kpi_tech_request_reviewed";
--> statement-breakpoint
ALTER TABLE "tech_kpi_tech_request" ADD CONSTRAINT "tech_kpi_tech_request_reviewed" CHECK (("status" IN ('new', 'forwarded')) = ("reviewed_at" IS NULL));
--> statement-breakpoint
ALTER TABLE "tech_kpi_tech_request" ADD CONSTRAINT "tech_kpi_tech_request_forwarded" CHECK ("status" <> 'forwarded' OR "forwarded_at" IS NOT NULL);
--> statement-breakpoint
ALTER TABLE "tech_kpi_tech_request" ADD CONSTRAINT "tech_kpi_tech_request_tool_length" CHECK (length("tool") <= 120);
--> statement-breakpoint
CREATE TABLE "tech_kpi_request_comment" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "request_id" uuid NOT NULL REFERENCES "tech_kpi_tech_request"("id") ON DELETE CASCADE,
  "author_id" text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  "body" text NOT NULL,
  "internal" boolean DEFAULT false NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "tech_kpi_request_comment_body" CHECK (length(btrim("body")) > 0 AND length("body") <= 5000)
);
--> statement-breakpoint
CREATE INDEX "tech_kpi_request_comment_request_idx" ON "tech_kpi_request_comment" ("request_id", "created_at");
--> statement-breakpoint
-- An attachment belongs to one ticket or bug, or to one request.
ALTER TABLE "tech_kpi_attachment" ALTER COLUMN "item_id" DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE "tech_kpi_attachment" ADD COLUMN "request_id" uuid REFERENCES "tech_kpi_tech_request"("id") ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE "tech_kpi_attachment" ADD CONSTRAINT "tech_kpi_attachment_one_target" CHECK (("item_id" IS NULL) <> ("request_id" IS NULL));
--> statement-breakpoint
CREATE INDEX "tech_kpi_attachment_request_idx" ON "tech_kpi_attachment" ("request_id");
