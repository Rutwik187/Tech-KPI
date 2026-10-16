import { randomUUID } from 'node:crypto';
import { eq, and, desc } from 'drizzle-orm';
import { PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { db } from '@/db';
import { attachments, workItems, activities } from '@/db/schema';
import { storageClient, ATTACHMENT_BUCKET } from '@/lib/storage';
import { assertSameOrigin, requireSession } from '@/server/authz';
import { AppError, errorResponse } from '@/server/errors';
import { z } from 'zod';
import type { Member } from '@/lib/types';
export const runtime = 'nodejs';
const allowedTypes = new Set(['image/png','image/jpeg','image/webp','application/pdf','text/plain','text/csv','application/json']);
async function authorizedItem(request: Request, id: string, currentMember?: Member) {
  z.string().uuid().parse(id);
  const member = currentMember ?? await requireSession(request.headers);
  const [item] = await db.select().from(workItems).where(and(eq(workItems.id,id), member.role==='admin'?undefined:eq(workItems.assigneeId,member.id)));
  if (!item) throw new AppError('This task or bug is not available.',404);
  return member;
}
async function list(itemId: string) {
  const rows = await db.select().from(attachments).where(eq(attachments.itemId,itemId)).orderBy(desc(attachments.createdAt));
  if (!rows.length) return {attachments:[]};
  const s3 = storageClient();
  return {attachments:await Promise.all(rows.map(async a=>({id:a.id,name:a.name,size:a.size,createdAt:a.createdAt.toISOString(),url:await getSignedUrl(s3,new GetObjectCommand({Bucket:ATTACHMENT_BUCKET,Key:a.objectKey,ResponseContentDisposition:`attachment; filename="${a.name.replace(/[^a-zA-Z0-9._ -]/g,'_')}"`}),{expiresIn:300})}))) };
}
export async function GET(request: Request) {
  try {const id = new URL(request.url).searchParams.get('itemId')??'';await authorizedItem(request,id);return Response.json(await list(id),{headers:{'Cache-Control':'private, no-store'}});}
  catch(error) {return errorResponse(error);}
}
export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const member = await requireSession(request.headers);
    if (Number(request.headers.get('content-length')??0)>11*1024*1024) throw new AppError('Maximum file size is 10 MB.',413);
    const form = await request.formData();
    const id = String(form.get('itemId')??'');
    await authorizedItem(request,id,member);
    const file = form.get('file');
    if (!(file instanceof File) || file.size===0) throw new AppError('Choose a file to attach.');
    if (file.size>10*1024*1024) throw new AppError('Maximum file size is 10 MB.',413);
    if (!allowedTypes.has(file.type)) throw new AppError('Use a PNG, JPEG, WebP, PDF, text, CSV, or JSON file.');
    const attachmentId = randomUUID();
    const key = `work-items/${id}/${attachmentId}`;
    const s3 = storageClient();
    await s3.send(new PutObjectCommand({Bucket:ATTACHMENT_BUCKET,Key:key,Body:Buffer.from(await file.arrayBuffer()),ContentType:file.type,ContentDisposition:'attachment'}));
    try {
      await db.transaction(async tx=>{
        await tx.insert(attachments).values({id:attachmentId,itemId:id,uploadedById:member.id,name:file.name.slice(0,240),mimeType:file.type,size:file.size,objectKey:key});
        await tx.insert(activities).values({entityId:id,actorId:member.id,action:'attachment.added',payload:{name:file.name,size:file.size}});
      });
    } catch(error) {await s3.send(new DeleteObjectCommand({Bucket:ATTACHMENT_BUCKET,Key:key})).catch(()=>{});throw error;}
    return Response.json(await list(id),{status:201});
  } catch(error) {return errorResponse(error);}
}
