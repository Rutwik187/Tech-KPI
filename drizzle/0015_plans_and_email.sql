-- A request's plan: the feature list, the timeline, and notes that project managers keep and send to the requester.
-- `plan` is the working draft. `plan_shared` is the last version sent, which the requester sees. Every version sent stays in
-- the request's history, so the whole conversation can be read back.
ALTER TABLE "tech_kpi_tech_request" ADD COLUMN "plan" jsonb;
--> statement-breakpoint
ALTER TABLE "tech_kpi_tech_request" ADD COLUMN "plan_shared" jsonb;
--> statement-breakpoint
-- Each person can turn request emails off on My account.
ALTER TABLE "tech_kpi_member_profile" ADD COLUMN "email_notifications" boolean DEFAULT true NOT NULL;
--> statement-breakpoint
-- Emails the workspace sends. A row is written in the same transaction as the change it reports, then sent.
-- If sending is not set up yet, rows wait, and recent ones go out once it is.
CREATE TABLE "tech_kpi_notification" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" text REFERENCES "user"("id") ON DELETE SET NULL,
  "email" text NOT NULL,
  "kind" text NOT NULL,
  "entity_id" text,
  "subject" text NOT NULL,
  "html" text NOT NULL,
  "text" text NOT NULL,
  "status" text DEFAULT 'pending' NOT NULL,
  "attempts" integer DEFAULT 0 NOT NULL,
  "last_error" text,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "sent_at" timestamptz,
  CONSTRAINT "tech_kpi_notification_status" CHECK ("status" IN ('pending', 'sent', 'failed', 'expired'))
);
--> statement-breakpoint
CREATE INDEX "tech_kpi_notification_status_idx" ON "tech_kpi_notification" ("status", "created_at");
--> statement-breakpoint
CREATE INDEX "tech_kpi_notification_entity_idx" ON "tech_kpi_notification" ("entity_id");
