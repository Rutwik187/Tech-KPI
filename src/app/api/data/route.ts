import { getDashboardData } from "@/server/data";
import { requireSession, assertSameOrigin } from "@/server/authz";
import { executeAction } from "@/server/actions";
import { AppError, errorResponse } from "@/server/errors";
import { actionSchema } from "@/server/validation";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  try { return Response.json(await getDashboardData(request.headers), { headers: { "Cache-Control": "private, no-store" } }); }
  catch (error) { return errorResponse(error); }
}
export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const actor = await requireSession(request.headers);
    if (Number(request.headers.get("content-length")) > 100_000) throw new AppError("This request is too large.", 413);
    let payload: unknown;
    try { payload = await request.json(); } catch { throw new AppError("The request body must be valid JSON."); }
    await executeAction(actor, actionSchema.parse(payload));
    return Response.json(await getDashboardData(request.headers), { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return errorResponse(error); }
}
export const PATCH = POST;
