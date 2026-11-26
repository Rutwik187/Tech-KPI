import { describe, expect, it } from 'vitest';
import { attachmentProblem, attachmentType, fileSize, MAX_ATTACHMENT_BYTES } from '../attachments';

describe('attachment rules', () => {
  it('accepts images, documents, sheets, slides, videos, and text by their extension', () => {
    expect(attachmentType('screen.PNG', 'image/png')?.kind).toBe('image');
    expect(attachmentType('brief.docx', '')?.mimeType).toBe('application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    expect(attachmentType('stock.xlsx', 'application/octet-stream')?.kind).toBe('sheet');
    expect(attachmentType('orders.csv', 'application/vnd.ms-excel')?.mimeType).toBe('text/csv');
    expect(attachmentType('recording.mov', 'video/quicktime')?.viewable).toBe(true);
    expect(attachmentType('server.log', '')?.mimeType).toBe('text/plain');
  });

  it('refuses web pages, scripts, unknown files, and a type that disagrees with the name', () => {
    expect(attachmentType('page.html', 'text/html')).toBeNull();
    expect(attachmentType('logo.svg', 'image/svg+xml')).toBeNull();
    expect(attachmentType('setup.exe', 'application/octet-stream')).toBeNull();
    expect(attachmentType('README', 'text/plain')).toBeNull();
    expect(attachmentType('photo.png', 'text/html')).toBeNull();
  });

  it('explains a refused file before it is sent', () => {
    expect(attachmentProblem({ name: 'big.pdf', size: MAX_ATTACHMENT_BYTES + 1, type: 'application/pdf' })).toContain('up to 10 MB');
    expect(attachmentProblem({ name: 'empty.txt', size: 0, type: 'text/plain' })).toContain('empty');
    expect(attachmentProblem({ name: 'run.sh', size: 10, type: 'text/x-sh' })).toContain('cannot be attached');
    expect(attachmentProblem({ name: 'ok.pdf', size: 10, type: 'application/pdf' })).toBeNull();
    expect(fileSize(2_516_582)).toBe('2.4 MB');
  });
});

describe('file previews', () => {
  it('previews images, PDFs, videos, and text, and downloads everything else', async () => {
    const { previewKind } = await import('../attachments');
    expect(previewKind('screen.png', 'image/png')).toBe('image');
    expect(previewKind('brief.pdf', 'application/pdf')).toBe('pdf');
    expect(previewKind('demo.mp4', 'video/mp4')).toBe('video');
    expect(previewKind('server.log', 'text/plain')).toBe('text');
    expect(previewKind('orders.csv', 'text/csv')).toBe('text');
    expect(previewKind('photo.heic', 'image/heic')).toBeNull();
    expect(previewKind('plan.docx', '')).toBeNull();
  });

  it('reads CSV cells with commas, quotes, and line breaks inside quotes', async () => {
    const { parseCsv } = await import('@/components/workspace/attachments');
    expect(parseCsv('name,note\r\n"Rao, A","said ""hi""\nthen left"\nB,plain')).toEqual([['name', 'note'], ['Rao, A', 'said "hi"\nthen left'], ['B', 'plain']]);
  });
});
