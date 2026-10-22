ALTER TABLE "tech_kpi_project_member" ADD COLUMN "is_primary" boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "tech_kpi_project_member_one_primary" ON "tech_kpi_project_member" USING btree ("project_id") WHERE "tech_kpi_project_member"."is_primary";
