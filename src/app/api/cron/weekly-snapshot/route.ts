import { timingSafeEqual } from "node:crypto";
import { db } from "@/db";
import { snapshots } from "@/db/schema";
import { calculateTeamKpi, getWeekStart, previousWeekStart } from "@/lib/kpi";
import { getSnapshotSource } from "@/server/data";
import { errorResponse } from "@/server/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
function isAuthorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  const supplied = request.headers.get("authorization");
  if (!secret || !supplied) return false;
  const expected = Buffer.from(`Bearer ${secret}`); const actual = Buffer.from(supplied);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
export async function GET(request: Request) {
  if (!isAuthorized(request)) return Response.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const data = await getSnapshotSource();
    if (!data) return Response.json({ skipped: "Set up an active admin first." });
    const now = new Date();
    const weekStart = previousWeekStart(getWeekStart(now, data.settings.timezone), data.settings.timezone);
    if (weekStart < getWeekStart(data.settings.trackingStartDate, data.settings.timezone)) return Response.json({ weekStart, skipped: "This week is before tracking started." });
    const result = calculateTeamKpi(data, weekStart, now);
    const rows = await db.transaction(async (tx) => {
      const saved: string[] = [];
      for (const member of result.members) {
        const inserted = await tx.insert(snapshots).values({
          userId: member.memberId, weekStart,
          value: { ...member, isLocked: true, ...(member.member.role === "admin" ? { teamEfficiency: result.teamEfficiency, teamBand: result.band } : {}) },
        }).onConflictDoNothing().returning({ userId: snapshots.userId });
        saved.push(...inserted.map((row) => row.userId));
      }
      return saved;
    });
    return Response.json({ weekStart, saved: rows.length, alreadyLocked: result.members.length - rows.length });
  } catch (error) { return errorResponse(error); }
}
