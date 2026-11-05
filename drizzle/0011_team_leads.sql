ALTER TABLE "tech_kpi_member_profile" ADD COLUMN "is_team_lead" boolean DEFAULT false NOT NULL;--> statement-breakpoint
-- Until now, an admin added everyone in a team as its team lead. They stay team leads.
UPDATE "tech_kpi_member_profile" AS "profile" SET "is_team_lead" = true
FROM "user" WHERE "user"."id" = "profile"."user_id" AND "user"."role" = 'requester' AND "profile"."department_id" IS NOT NULL;
