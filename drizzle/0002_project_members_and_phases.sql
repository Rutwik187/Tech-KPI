CREATE TABLE "tech_kpi_project_member" (
	"project_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	CONSTRAINT "tech_kpi_project_member_project_id_user_id_pk" PRIMARY KEY("project_id","user_id"),
	CONSTRAINT "tech_kpi_project_member_not_adhoc" CHECK ("tech_kpi_project_member"."project_id" <> '00000000-0000-4000-8000-000000000001'::uuid)
);
--> statement-breakpoint
CREATE TABLE "tech_kpi_project_phase" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"name" text NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "tech_kpi_project_phase_position_nonnegative" CHECK ("tech_kpi_project_phase"."position" >= 0),
	CONSTRAINT "tech_kpi_project_phase_not_adhoc" CHECK ("tech_kpi_project_phase"."project_id" <> '00000000-0000-4000-8000-000000000001'::uuid),
	CONSTRAINT "tech_kpi_project_phase_name_not_adhoc" CHECK (length(btrim("tech_kpi_project_phase"."name")) > 0 AND lower(regexp_replace(btrim("tech_kpi_project_phase"."name"), '[[:space:]]+', ' ', 'g')) <> 'ad hoc')
);
--> statement-breakpoint
ALTER TABLE "tech_kpi_project" ADD COLUMN "is_adhoc" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "tech_kpi_work_item" ADD COLUMN "phase_id" uuid;--> statement-breakpoint
ALTER TABLE "tech_kpi_project_member" ADD CONSTRAINT "tech_kpi_project_member_project_id_tech_kpi_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."tech_kpi_project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tech_kpi_project_member" ADD CONSTRAINT "tech_kpi_project_member_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tech_kpi_project_phase" ADD CONSTRAINT "tech_kpi_project_phase_project_id_tech_kpi_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."tech_kpi_project"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "tech_kpi_project_member_user_idx" ON "tech_kpi_project_member" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "tech_kpi_project_phase_project_id_idx" ON "tech_kpi_project_phase" USING btree ("project_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "tech_kpi_project_phase_name_idx" ON "tech_kpi_project_phase" USING btree ("project_id",lower("name"));--> statement-breakpoint
CREATE INDEX "tech_kpi_project_phase_position_idx" ON "tech_kpi_project_phase" USING btree ("project_id","position");--> statement-breakpoint
ALTER TABLE "tech_kpi_work_item" ADD CONSTRAINT "tech_kpi_item_project_phase_fk" FOREIGN KEY ("project_id","phase_id") REFERENCES "public"."tech_kpi_project_phase"("project_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "tech_kpi_item_project_phase_idx" ON "tech_kpi_work_item" USING btree ("project_id","phase_id");--> statement-breakpoint
ALTER TABLE "tech_kpi_project" ADD CONSTRAINT "tech_kpi_project_adhoc_reserved" CHECK (("tech_kpi_project"."id" = '00000000-0000-4000-8000-000000000001'::uuid AND "tech_kpi_project"."is_adhoc" = true AND "tech_kpi_project"."name" = 'Ad hoc' AND "tech_kpi_project"."is_archived" = false) OR ("tech_kpi_project"."id" <> '00000000-0000-4000-8000-000000000001'::uuid AND "tech_kpi_project"."is_adhoc" = false AND lower("tech_kpi_project"."name") <> 'ad hoc'));
--> statement-breakpoint
INSERT INTO "tech_kpi_project" ("id", "name", "color", "description", "is_adhoc", "is_archived")
VALUES ('00000000-0000-4000-8000-000000000001', 'Ad hoc', '#64748b', 'Work outside a planned project.', true, false)
ON CONFLICT ("id") DO NOTHING;
--> statement-breakpoint
-- Preserve existing ownership when introducing project membership. Existing work keeps its null phase.
INSERT INTO "tech_kpi_project_member" ("project_id", "user_id")
SELECT DISTINCT "project_id", "assignee_id" FROM "tech_kpi_work_item"
WHERE "project_id" <> '00000000-0000-4000-8000-000000000001'
ON CONFLICT ("project_id", "user_id") DO NOTHING;
