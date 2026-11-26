import { timingSafeEqual } from "node:crypto";
import { deliverPending } from "@/server/mailer";
import { errorResponse } from "@/server/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Daily: sends emails still waiting, for example after Microsoft was briefly unavailable. Needs the cron secret. */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  const supplied = request.headers.get("authorization");
  const expected = Buffer.from(`Bearer ${secret ?? ""}`); const actual = Buffer.from(supplied ?? "");
  if (!secret || !supplied || expected.length !== actual.length || !timingSafeEqual(expected, actual)) return Response.json({ error: "Unauthorized" }, { status: 401 });
  try { return Response.json({ sent: await deliverPending(200) }); }
  catch (error) { return errorResponse(error); }
}
