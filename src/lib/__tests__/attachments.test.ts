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
