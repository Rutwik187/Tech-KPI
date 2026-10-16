import { sql } from 'drizzle-orm';
import { HeadBucketCommand } from '@aws-sdk/client-s3';
import { db } from '@/db';
import { storageClient, ATTACHMENT_BUCKET } from '@/lib/storage';
import { requireAdmin, requireSession } from '@/server/authz';
import { errorResponse } from '@/server/errors';
export const runtime = 'nodejs';
export async function GET(request: Request) {
  try {
    requireAdmin(await requireSession(request.headers));
    const results = await Promise.allSettled([
      db.execute(sql`select 1 as connected`),
      storageClient().send(new HeadBucketCommand({Bucket:ATTACHMENT_BUCKET})),
      fetch(process.env.NEON_FUNCTION_WORKLOAD_BASE_URL!,{headers:{Authorization:`Bearer ${process.env.WORKLOAD_SECRET}`},cache:'no-store',signal:AbortSignal.timeout(15000)}).then(async r=>{if(!r.ok)throw new Error('Function unavailable');return r.json();})
    ]);
    return Response.json({database:{status:results[0].status==='fulfilled'?'connected':'error'},storage:{status:results[1].status==='fulfilled'?'connected':'error'},functions:{status:results[2].status==='fulfilled'?'connected':'error'},aiGateway:{status:process.env.NEON_AI_GATEWAY_TOKEN?'configured':'unavailable',message:process.env.NEON_AI_GATEWAY_TOKEN?'Optional AI is configured.':'AI Gateway requires a paid Neon plan.'}},{headers:{'Cache-Control':'no-store'}});
  } catch(error) {return errorResponse(error);}
}
