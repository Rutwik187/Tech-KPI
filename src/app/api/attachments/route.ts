import { randomUUID } from 'node:crypto';
import { and, desc, eq } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { z } from 'zod';
import { db } from '@/db';
import { activities, attachments, techRequests, user, workItems } from '@/db/schema';
import { ATTACHMENT_BUCKET, storageClient } from '@/lib/storage';
import { ATTACHMENT_ACCEPT, MAX_ATTACHMENT_BYTES, attachmentType } from '@/lib/attachments';
import { assertSameOrigin, requireSession } from '@/server/authz';
import { visibleRequest } from '@/server/request-access';
import { AppError, errorResponse } from '@/server/errors';
import type { Attachment, Member } from '@/lib/types';
import { can, leadsWork } from '@/lib/permissions';

export const runtime = 'nodejs';

/** What a file is attached to: one ticket or bug, or one request. */
type Target = { kind: 'item'; id: string } | { kind: 'request'; id: string };

function readTarget(values: { itemId?: unknown; requestId?: unknown }): Target {
  const itemId = typeof values.itemId === 'string' && values.itemId ? values.itemId : null;
  const requestId = typeof values.requestId === 'string' && values.requestId ? values.requestId : null;
  if (!!itemId === !!requestId) throw new AppError('Choose one ticket, bug, or request for this file.');
  return itemId ? { kind: 'item', id: z.uuid().parse(itemId) } : { kind: 'request', id: z.uuid().parse(requestId) };
}

/**
 * Checks this person may see the target. The tech lead sees every ticket and bug, a developer their own.
 * Requests follow the request rules: the tech lead and project managers see all, a requester their own and their team's,
 * and a developer the request behind their own work.
 */
async function authorize(member: Member, target: Target) {
  if (target.kind === 'request') { await visibleRequest(db, member, target.id); return; }
  if (!can(member, 'work.manage') && !can(member, 'work.own')) throw new AppError('This ticket or bug is not available.', 404);
  const [item] = await db.select({ id: workItems.id }).from(workItems)
    .where(and(eq(workItems.id, target.id), leadsWork(member) ? undefined : eq(workItems.assigneeId, member.id)));
  if (!item) throw new AppError('This ticket or bug is not available.', 404);
}

/** A download name for the Content-Disposition header: an ASCII fallback, and the full name encoded for browsers that read it. */
function disposition(kind: 'attachment' | 'inline', name: string) {
  const fallback = name.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  return `${kind}; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}

async function list(member: Member, target: Target): Promise<{ attachments: Attachment[] }> {
  const uploader = alias(user, 'uploader');
  const rows = await db.select({ file: attachments, uploaderName: uploader.name }).from(attachments)
    .innerJoin(uploader, eq(uploader.id, attachments.uploadedById))
    .where(target.kind === 'item' ? eq(attachments.itemId, target.id) : eq(attachments.requestId, target.id))
    .orderBy(desc(attachments.createdAt));
  if (!rows.length) return { attachments: [] };
  const s3 = storageClient();
  return {
    attachments: await Promise.all(rows.map(async ({ file, uploaderName }) => {
      const download = getSignedUrl(s3, new GetObjectCommand({ Bucket: ATTACHMENT_BUCKET, Key: file.objectKey, ResponseContentDisposition: disposition('attachment', file.name) }), { expiresIn: 300 });
      // Images, PDFs, and videos can open in a new tab. Everything else downloads.
      const viewable = attachmentType(file.name, file.mimeType)?.viewable ?? false;
      const view = viewable ? getSignedUrl(s3, new GetObjectCommand({ Bucket: ATTACHMENT_BUCKET, Key: file.objectKey, ResponseContentDisposition: disposition('inline', file.name), ResponseContentType: file.mimeType }), { expiresIn: 300 }) : null;
      return {
        id: file.id, name: file.name, size: file.size, mimeType: file.mimeType, createdAt: file.createdAt.toISOString(),
        uploadedById: file.uploadedById, uploadedByName: uploaderName, canDelete: file.uploadedById === member.id || leadsWork(member),
        url: await download, viewUrl: view ? await view : null,
      };
    })),
  };
}

const noStore = { 'Cache-Control': 'private, no-store' };

export async function GET(request: Request) {
  try {
    const params = new URL(request.url).searchParams;
    const member = await requireSession(request.headers);
    const target = readTarget({ itemId: params.get('itemId'), requestId: params.get('requestId') });
    await authorize(member, target);
    return Response.json(await list(member, target), { headers: noStore });
  } catch (error) { return errorResponse(error); }
}

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const member = await requireSession(request.headers);
    if (Number(request.headers.get('content-length') ?? 0) > MAX_ATTACHMENT_BYTES + 1024 * 1024) throw new AppError('Each file can be up to 10 MB.', 413);
    const form = await request.formData();
    const target = readTarget({ itemId: form.get('itemId'), requestId: form.get('requestId') });
    await authorize(member, target);
    const file = form.get('file');
    if (!(file instanceof File) || file.size === 0) throw new AppError('Choose a file to attach.');
    if (file.size > MAX_ATTACHMENT_BYTES) throw new AppError('Each file can be up to 10 MB.', 413);
    const type = attachmentType(file.name, file.type);
    if (!type) throw new AppError(`This kind of file cannot be attached. Use ${ATTACHMENT_ACCEPT.label}.`);
    const name = file.name.trim().slice(0, 240) || 'file';
    const attachmentId = randomUUID();
    const key = `${target.kind === 'item' ? 'work-items' : 'tech-requests'}/${target.id}/${attachmentId}`;
    const s3 = storageClient();
    await s3.send(new PutObjectCommand({ Bucket: ATTACHMENT_BUCKET, Key: key, Body: Buffer.from(await file.arrayBuffer()), ContentType: type.mimeType, ContentDisposition: 'attachment' }));
    try {
      await db.transaction(async (tx) => {
        // The request may have been withdrawn while the file uploaded. Its row is locked, so the file cannot outlive it.
        if (target.kind === 'request') {
          const [still] = await tx.select({ id: techRequests.id }).from(techRequests).where(eq(techRequests.id, target.id)).for('share');
          if (!still) throw new AppError('This request was not found.', 404);
        }
        await tx.insert(attachments).values({
          id: attachmentId, ...(target.kind === 'item' ? { itemId: target.id } : { requestId: target.id }),
          uploadedById: member.id, name, mimeType: type.mimeType, size: file.size, objectKey: key,
        });
        await tx.insert(activities).values({ entityId: target.id, actorId: member.id, action: 'attachment.added', payload: { name, size: file.size, attachmentId } });
        if (target.kind === 'request') await tx.update(techRequests).set({ updatedAt: new Date() }).where(eq(techRequests.id, target.id));
      });
    } catch (error) {
      await s3.send(new DeleteObjectCommand({ Bucket: ATTACHMENT_BUCKET, Key: key })).catch(() => {});
      throw error;
    }
    return Response.json(await list(member, target), { status: 201, headers: noStore });
  } catch (error) { return errorResponse(error); }
}

/** Removes a file. The person who added it can remove it, and so can the tech lead or an admin. */
export async function DELETE(request: Request) {
  try {
    assertSameOrigin(request);
    const member = await requireSession(request.headers);
    const id = z.uuid().parse(new URL(request.url).searchParams.get('id') ?? '');
    const [file] = await db.select().from(attachments).where(eq(attachments.id, id));
    if (!file) throw new AppError('This file was not found.', 404);
    const target: Target = file.itemId ? { kind: 'item', id: file.itemId } : { kind: 'request', id: file.requestId! };
    await authorize(member, target);
    if (file.uploadedById !== member.id && !leadsWork(member)) throw new AppError('You can remove only the files you added.', 403);
    await db.transaction(async (tx) => {
      const removed = await tx.delete(attachments).where(eq(attachments.id, file.id)).returning({ id: attachments.id });
      if (!removed.length) throw new AppError('This file was already removed.', 404);
      await tx.insert(activities).values({ entityId: target.id, actorId: member.id, action: 'attachment.removed', payload: { name: file.name, attachmentId: file.id } });
    });
    await storageClient().send(new DeleteObjectCommand({ Bucket: ATTACHMENT_BUCKET, Key: file.objectKey })).catch(() => {});
    return Response.json(await list(member, target), { headers: noStore });
  } catch (error) { return errorResponse(error); }
}
