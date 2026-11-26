import { randomUUID } from 'node:crypto';
import { deflateSync } from 'node:zlib';
import { expect, test } from '@playwright/test';
import type { DashboardData } from '../src/lib/types';
import { createSession, type SessionFixture } from './session';

/**
 * Live files, against the real storage bucket in .env.local: upload straight to storage with progress, thumbnails,
 * the viewer for images, CSV, PDF, and text, moving between files, removing one, and a file larger than the hosting
 * limit for a request body. Local test server only. Everything it creates is removed at the end.
 */
const baseURL = process.env.TEST_BASE_URL ?? 'http://localhost:3100';

/** A real PNG: a colour gradient, so the thumbnail and the viewer have something to show. */
function png(width: number, height: number) {
  const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (buffer: Buffer) => { let c = 0xffffffff; for (const byte of buffer) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type: string, data: Buffer) => { const length = Buffer.alloc(4); length.writeUInt32BE(data.length); const body = Buffer.concat([Buffer.from(type), data]); const sum = Buffer.alloc(4); sum.writeUInt32BE(crc(body)); return Buffer.concat([length, body, sum]); };
  const header = Buffer.alloc(13); header.writeUInt32BE(width, 0); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 2;
  const rows = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) { const at = y * (width * 3 + 1) + 1 + x * 3; rows[at] = 40 + x * 2; rows[at + 1] = 90 + y; rows[at + 2] = 220; }
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', header), chunk('IDAT', deflateSync(rows)), chunk('IEND', Buffer.alloc(0))]);
}
const pdf = Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj 2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj 3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 300 144]/Contents 4 0 R/Resources<</Font<</F1<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>>>>>>>endobj 4 0 obj<</Length 44>>stream\nBT /F1 18 Tf 40 70 Td (Workspace brief) Tj ET\nendstream endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n');

test('files upload straight to storage, show clean previews, and can be removed', async ({ page }) => {
  test.setTimeout(120_000);
  let lead: SessionFixture | undefined, owner: SessionFixture | undefined;
  let itemId: string | undefined;
  try {
    lead = await createSession('admin', `Files verification admin ${randomUUID().slice(0, 6)}`);
    owner = await createSession('developer', `Files verification developer ${randomUUID().slice(0, 6)}`);
    await page.context().addCookies([lead.cookie]);
    const title = `Files verification ${randomUUID().slice(0, 8)}`;
    const created = await page.request.post('/api/data', { headers: { origin: baseURL }, data: { action: 'createItem', type: 'task', title, assigneeId: owner.userId, estimateHours: 1 } });
    expect(created.status()).toBe(200);
    const item = ((await created.json()) as DashboardData).items.find(row => row.title === title)!;
    itemId = item.id;
    await page.goto(`/tickets?open=${item.key}`);
    const drawer = page.locator('.drawer');
    await expect(drawer.getByRole('heading', { name: title })).toBeVisible();

    // Four files at once. The log is 6 MB: more than the hosting accepts in one request body, so it must go straight to storage.
    const bigLog = Buffer.alloc(6 * 1024 * 1024, 'payment callback retried\n');
    await drawer.getByLabel('Choose files to attach').setInputFiles([
      { name: 'checkout.png', mimeType: 'image/png', buffer: png(160, 100) },
      { name: 'orders.csv', mimeType: 'text/csv', buffer: Buffer.from('order,amount,note\n1001,499,"gift, wrapped"\n1002,1299,plain\n') },
      { name: 'brief.pdf', mimeType: 'application/pdf', buffer: pdf },
      { name: 'server.log', mimeType: 'text/plain', buffer: bigLog },
    ]);
    // Each file shows its own progress while it uploads, then joins the list.
    await expect(drawer.getByRole('progressbar', { name: 'Uploading server.log' })).toBeVisible();
    const files = drawer.locator('.attachment-item:not(.is-uploading)');
    await expect(files).toHaveCount(4, { timeout: 90_000 });
    await expect(drawer.locator('.attachment-item.is-uploading')).toHaveCount(0);
    await expect(page.getByText('4 files attached')).toBeVisible();
    await expect(drawer.getByText('6.0 MB', { exact: false })).toBeVisible();
    // The thumbnail is the real image, loaded from private storage through a short-lived link.
    const thumb = drawer.locator('button.attachment-thumb img');
    await expect.poll(() => thumb.evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth)).toBe(160);

    // The viewer: the image first, then the arrow keys move through every file that can be previewed.
    await drawer.getByRole('button', { name: 'Preview checkout.png', exact: true }).first().click();
    const viewer = page.locator('.file-viewer');
    await expect(viewer.getByRole('heading', { name: 'checkout.png' })).toBeVisible();
    await expect.poll(() => viewer.locator('.file-viewer-image img').evaluate((image: HTMLImageElement) => image.naturalHeight)).toBe(100);
    // Newest first, as in the list, so the first file sent is the last one.
    await expect(viewer).toContainText('4 of 4');
    const seen = new Set<string>();
    for (let step = 0; step < 4; step++) {
      const name = await viewer.locator('[data-slot="dialog-title"]').textContent();
      seen.add(name ?? '');
      if (name === 'orders.csv') await expect(viewer.locator('.file-viewer-text table')).toContainText('gift, wrapped');
      if (name === 'brief.pdf') await expect(viewer.locator('iframe')).toHaveAttribute('src', /brief\.pdf|X-Amz-Signature/);
      if (name === 'server.log') { await expect(viewer.locator('.file-viewer-text pre')).toContainText('payment callback retried'); await expect(viewer).toContainText('Showing the start of the file'); }
      await page.keyboard.press('ArrowRight');
    }
    expect([...seen].sort()).toEqual(['brief.pdf', 'checkout.png', 'orders.csv', 'server.log']);
    await viewer.getByRole('button', { name: 'Close preview', exact: true }).click();
    await expect(viewer).toBeHidden();

    // The PDF opens inline from storage, as a PDF, and downloads keep the file's name.
    const listed = await (await page.request.get(`/api/attachments?itemId=${itemId}`)).json() as { attachments: { name: string; url: string; viewUrl: string | null; size: number }[] };
    const brief = listed.attachments.find(file => file.name === 'brief.pdf')!;
    const inline = await page.request.get(brief.viewUrl!);
    expect(inline.headers()['content-type']).toBe('application/pdf');
    expect(inline.headers()['content-disposition']).toContain('inline');
    const download = await page.request.get(listed.attachments.find(file => file.name === 'server.log')!.url);
    expect(download.headers()['content-disposition']).toContain('attachment; filename="server.log"');
    expect((await download.body()).length).toBe(bigLog.length);

    // Removing a file asks first, then the list and storage drop it.
    const csvRow = files.filter({ hasText: 'orders.csv' });
    await csvRow.getByRole('button', { name: 'Remove orders.csv', exact: true }).click();
    await csvRow.getByRole('button', { name: 'Remove', exact: true }).click();
    await expect(files).toHaveCount(3);
    const csvLink = listed.attachments.find(file => file.name === 'orders.csv')!.url;
    expect((await page.request.get(csvLink)).status()).toBe(404);
  } finally {
    // Remove every file the test made, from storage too, then the ticket and the people.
    if (itemId && lead) {
      const listed = await page.request.get(`/api/attachments?itemId=${itemId}`).then(r => r.json()).catch(() => ({ attachments: [] })) as { attachments: { id: string }[] };
      for (const file of listed.attachments ?? []) await page.request.delete(`/api/attachments?id=${file.id}`, { headers: { origin: baseURL } });
      const { Pool } = await import('pg');
      const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
      try {
        await pool.query('DELETE FROM tech_kpi_activity WHERE entity_id = $1', [itemId]);
        await pool.query('DELETE FROM tech_kpi_work_item WHERE id = $1', [itemId]);
      } finally { await pool.end(); }
    }
    await owner?.dispose();
    await lead?.dispose();
  }
});
