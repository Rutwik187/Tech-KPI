-- Approved tickets count on their own date, not on the day the admin approved them.
-- Move each finished ticket that was credited after its date back to the end of that workday.
-- Weekly scores already locked for the weeks it leaves or joins are cleared, so those weeks show the corrected score.
CREATE TEMP TABLE "credit_move" ON COMMIT DROP AS
WITH "calendar" AS (
  SELECT COALESCE((SELECT "value"->>'timezone' FROM "tech_kpi_settings" WHERE "id" = 1), 'Asia/Kolkata') AS "tz",
         COALESCE((SELECT "value"->>'workdayEnd' FROM "tech_kpi_settings" WHERE "id" = 1), '19:00') AS "day_end"
)
SELECT "w"."id", "w"."completed_at" AS "old_at", (("w"."due_date" + "c"."day_end"::time) AT TIME ZONE "c"."tz") AS "new_at", "c"."tz"
FROM "tech_kpi_work_item" "w" CROSS JOIN "calendar" "c"
WHERE "w"."type" = 'task' AND "w"."status" = 'done' AND "w"."due_date" IS NOT NULL AND "w"."completed_at" IS NOT NULL
  AND "w"."completed_at" > (("w"."due_date" + "c"."day_end"::time) AT TIME ZONE "c"."tz");
--> statement-breakpoint
DELETE FROM "tech_kpi_weekly_snapshot" WHERE "week_start" IN (
  SELECT date_trunc('week', "old_at" AT TIME ZONE "tz")::date FROM "credit_move"
  UNION SELECT date_trunc('week', "new_at" AT TIME ZONE "tz")::date FROM "credit_move"
);
--> statement-breakpoint
UPDATE "tech_kpi_work_item" "w" SET
  "completed_at" = "m"."new_at",
  "started_at" = LEAST("w"."started_at", "m"."new_at"),
  "submitted_at" = LEAST("w"."submitted_at", "m"."new_at")
FROM "credit_move" "m" WHERE "w"."id" = "m"."id";
