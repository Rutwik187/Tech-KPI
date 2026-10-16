import { count } from "drizzle-orm";
import { db } from "@/db";
import { user } from "@/db/schema";
import { errorResponse } from "@/server/errors";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Setup has no public write endpoint. The first account is created with the local CLI.
export async function GET() {
  try {
    const [result] = await db.select({ count: count() }).from(user);
    return Response.json({ needsSetup: result.count === 0 }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return errorResponse(error); }
}
