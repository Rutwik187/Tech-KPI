import { requireAdmin, requireSession } from '@/server/authz';
import { errorResponse, AppError } from '@/server/errors';
export const runtime = 'nodejs';
export async function GET(request: Request) {
  try {
    requireAdmin(await requireSession(request.headers));
    const url = process.env.NEON_FUNCTION_WORKLOAD_BASE_URL;
    if (!url || !process.env.WORKLOAD_SECRET) throw new AppError('Workload function is not configured.',503);
    const response = await fetch(url,{headers:{Authorization:`Bearer ${process.env.WORKLOAD_SECRET}`},signal:AbortSignal.timeout(20000),cache:'no-store'});
    if (!response.ok) throw new AppError('The workload function is unavailable.',502);
    return Response.json(await response.json());
  } catch(error) {return errorResponse(error);}
}
