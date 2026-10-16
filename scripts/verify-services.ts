import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { config } from 'dotenv';
import { eq } from 'drizzle-orm';
import { DeleteObjectCommand } from '@aws-sdk/client-s3';
import type { DashboardData } from '../src/lib/types';

config({path:'.env.local',quiet:true});
const base = process.env.TEST_BASE_URL ?? 'http://localhost:3100';
async function main() {
  const {db,pool} = await import('../src/db');
  const {workItems,attachments,activities} = await import('../src/db/schema');
  const {storageClient,ATTACHMENT_BUCKET} = await import('../src/lib/storage');
  let itemId: string|undefined;
  let disposeFixture: (() => Promise<void>)|undefined;
  try {
    const {createOfflineSessionFixture} = await import('../src/server/verification-fixtures');
    const fixture = await createOfflineSessionFixture({baseURL:base,role:'admin',name:'Service verification admin'});
    disposeFixture = fixture.dispose;
    const cookie = fixture.cookieHeader;
    console.log('Authentication: temporary Node-only session fixture; real Microsoft OAuth is not tested by this script.');
    const headers={Cookie:cookie,Origin:base};
    const initial:DashboardData=await (await fetch(base+'/api/data',{headers})).json();
    const title=`Service verification ${randomUUID().slice(0,8)}`;
    const created=await fetch(base+'/api/data',{method:'POST',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify({action:'createItem',type:'task',title,assigneeId:initial.currentUser.id,estimateHours:1})});
    assert.equal(created.status,200,'Task save');
    const data:DashboardData=await created.json();
    itemId=data.items.find(i=>i.title===title)?.id;assert(itemId);
    console.log('Postgres: task created via authenticated app API and returned from Neon.');
    const content='Urban Gabru object storage end-to-end verification.';
    const form=new FormData();form.set('itemId',itemId);form.set('file',new File([content],'verification.txt',{type:'text/plain'}));
    const uploaded=await fetch(base+'/api/attachments',{method:'POST',headers,body:form});
    assert.equal(uploaded.status,201,'Attachment upload');
    const body=await uploaded.json();assert.equal(body.attachments.length,1);
    const download=await fetch(body.attachments[0].url);assert.equal(await download.text(),content);
    const denied=await fetch(base+'/api/attachments?itemId='+itemId);assert.equal(denied.status,401);
    console.log('Object Storage: app upload → private bucket → signed download matched; anonymous access denied.');
    const workload=await fetch(base+'/api/workload',{headers});assert.equal(workload.status,200);
    const work=await workload.json();assert.equal(work.source,'Neon Functions');assert(work.workloads.some((w:{assigneeId:string;pendingTasks:number})=>w.assigneeId===initial.currentUser.id&&w.pendingTasks>=1));
    const direct=await fetch(process.env.NEON_FUNCTION_WORKLOAD_BASE_URL!);assert.equal(direct.status,401);
    console.log('Functions: authenticated app → deployed workload function → Postgres returned task; anonymous access denied.');
    const services=await (await fetch(base+'/api/services',{headers})).json();
    assert.equal(services.database.status,'connected');assert.equal(services.storage.status,'connected');assert.equal(services.functions.status,'connected');
    console.log('Service health:',JSON.stringify(services));
    console.log('All provisioned services passed end-to-end checks. AI Gateway remains unavailable on Free plan.');
  } finally {
    if (itemId) {
      const files=await db.select().from(attachments).where(eq(attachments.itemId,itemId));
      const s3=storageClient();
      for(const file of files)await s3.send(new DeleteObjectCommand({Bucket:ATTACHMENT_BUCKET,Key:file.objectKey}));
      await db.delete(attachments).where(eq(attachments.itemId,itemId));
      await db.delete(activities).where(eq(activities.entityId,itemId));
      await db.delete(workItems).where(eq(workItems.id,itemId));
      console.log('Temporary service verification task and attachment removed.');
    }
    await disposeFixture?.();
    await pool.end();
  }
}
main().catch(error=>{console.error(error instanceof Error?error.message:'Service verification failed.');process.exitCode=1;});
