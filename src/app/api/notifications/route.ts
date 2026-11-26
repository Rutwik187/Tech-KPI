import { desc, gte, sql } from "drizzle-orm";
import { db } from "@/db";
import { notifications } from "@/db/schema";
import { assertSameOrigin, requireCapability, requireSession } from "@/server/authz";
import { AppError, errorResponse } from "@/server/errors";
import { deliverPending, mailSetup, sendMail } from "@/server/mailer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** For an admin: whether email is set up, how many went out this week, and the latest ones with any error. */
export async function GET(request: Request) {
  try {
    requireCapability(await requireSession(request.headers), "org.manage");
    const weekAgo = new Date(Date.now() - 7 * 86_400_000);
    const [counts, recent] = await Promise.all([
      db.select({ status: notifications.status, count: sql<number>`count(*)::int` }).from(notifications).where(gte(notifications.createdAt, weekAgo)).groupBy(notifications.status),
      db.select({ id: notifications.id, email: notifications.email, subject: notifications.subject, kind: notifications.kind, status: notifications.status, lastError: notifications.lastError, createdAt: notifications.createdAt, sentAt: notifications.sentAt })
        .from(notifications).orderBy(desc(notifications.createdAt)).limit(25),
    ]);
    return Response.json({ sender: await mailSetup(), week: Object.fromEntries(counts.map((row) => [row.status, row.count])), recent }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return errorResponse(error); }
}

/** For an admin: sends a test email to themselves now, and sends anything waiting. The answer says what Microsoft replied. */
export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const member = await requireSession(request.headers);
    requireCapability(member, "org.manage");
    if (!await mailSetup()) throw new AppError("Email is not set up yet. Connect the sending mailbox with npm run mail:connect.", 409);
    try {
      await sendMail({ to: member.email, subject: "Test email from the Urban Gabru tech workspace", html: `<p style="font-family:Segoe UI,Arial,sans-serif;font-size:14px">Hello ${member.name.replace(/[<>&]/g, "")},</p><p style="font-family:Segoe UI,Arial,sans-serif;font-size:14px">Email from the workspace works. People will get emails when requests move forward.</p>` });
    } catch (error) { throw new AppError(error instanceof Error ? error.message : "The test email could not be sent.", 502); }
    const sent = await deliverPending(50);
    return Response.json({ ok: true, to: member.email, waitingSent: sent });
  } catch (error) { return errorResponse(error); }
}
