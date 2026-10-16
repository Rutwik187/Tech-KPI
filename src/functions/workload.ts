import { timingSafeEqual } from 'node:crypto';
import { Pool } from 'pg';
import { attachDatabasePool } from '@neon/functions';

const pool = new Pool({connectionString: process.env.DATABASE_URL, max: 3});
attachDatabasePool(pool);
function authorized(request: Request) {
  const expected = process.env.WORKLOAD_SECRET;
  const provided = request.headers.get('authorization')?.replace(/^Bearer /, '');
  return Boolean(expected && provided && Buffer.byteLength(expected) === Buffer.byteLength(provided) && timingSafeEqual(Buffer.from(expected), Buffer.from(provided)));
}
const workloadHandler = {
  async fetch(request: Request): Promise<Response> {
    if (!authorized(request)) return Response.json({error:'Unauthorized'}, {status:401});
    if (request.method !== 'GET') return Response.json({error:'Method not allowed'}, {status:405});
    const result = await pool.query(`SELECT assignee_id AS "assigneeId", count(*) FILTER (WHERE type='task' AND status <> 'done')::int AS "pendingTasks", count(*) FILTER (WHERE status='blocked')::int AS "blockedTasks", count(*) FILTER (WHERE status='in_review')::int AS "awaitingReview", count(*) FILTER (WHERE type='bug' AND status IN ('open','in_progress'))::int AS "openBugs", coalesce(sum(estimate_hours) FILTER (WHERE type='task' AND status <> 'done'),0)::float AS "pendingHours" FROM tech_kpi_work_item GROUP BY assignee_id`);
    return Response.json({workloads: result.rows, computedAt: new Date().toISOString(), source:'Neon Functions'});
  }
};
export default workloadHandler;
