"use client";

import { useEffect, useId, useRef, useState, type ClipboardEvent, type DragEvent, type ReactNode } from 'react';
import clsx from 'clsx';
import { toast } from 'sonner';
import { Download, Eye, File as FileIcon, FileImage, FileSpreadsheet, FileText, FileVideo, LoaderCircle, Paperclip, Presentation, Trash2, Upload, X } from 'lucide-react';
import type { Attachment, DashboardData } from '@/lib/types';
import { ATTACHMENT_ACCEPT, attachmentProblem, attachmentType, fileSize, type AttachmentKind } from '@/lib/attachments';
import { Button } from '@/components/ui/button';
import { displayDateTime } from './lib';

/** What a file belongs to. The attachments endpoint takes the same two keys. */
export type AttachmentTarget = { itemId: string } | { requestId: string };

const kindIcons: Record<AttachmentKind, ReactNode> = {
  image: <FileImage aria-hidden="true" />, pdf: <FileText aria-hidden="true" />, video: <FileVideo aria-hidden="true" />,
  document: <FileText aria-hidden="true" />, sheet: <FileSpreadsheet aria-hidden="true" />, slides: <Presentation aria-hidden="true" />, text: <FileText aria-hidden="true" />,
};
function iconFor(name: string, mimeType: string) {
  const kind = attachmentType(name, mimeType)?.kind;
  return kind ? kindIcons[kind] : <FileIcon aria-hidden="true" />;
}

/** Sends one file. It returns the target's files after the upload, or throws the server's reason. */
async function sendFile(target: AttachmentTarget, file: File): Promise<Attachment[]> {
  const form = new FormData();
  if ('itemId' in target) form.append('itemId', target.itemId); else form.append('requestId', target.requestId);
  form.append('file', file);
  const response = await fetch('/api/attachments', { method: 'POST', body: form });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error ?? `Could not attach ${file.name}.`);
  return result.attachments ?? [];
}

/**
 * Uploads files one by one, so a large file never blocks the others. Files that cannot be attached are skipped with a message.
 * Returns how many were attached.
 */
export async function uploadFiles(target: AttachmentTarget, files: File[], onEach?: (list: Attachment[]) => void): Promise<number> {
  let attached = 0;
  for (const file of files) {
    const problem = attachmentProblem(file);
    if (problem) { toast.error(problem); continue; }
    try { onEach?.(await sendFile(target, file)); attached++; }
    catch (error) { toast.error(error instanceof Error ? error.message : `Could not attach ${file.name}.`); }
  }
  return attached;
}

/** Files from a drop or a paste. A pasted screenshot arrives as "image.png", so it gets a clearer name with the time. */
function filesFrom(list: FileList | null | undefined, pasted = false): File[] {
  const files = Array.from(list ?? []);
  if (!pasted) return files;
  const stamp = new Date().toISOString().slice(0, 16).replace('T', ' ').replace(':', '.');
  return files.map(file => /^image\.(png|jpe?g|gif|webp)$/i.test(file.name) ? new File([file], `Screenshot ${stamp}.${file.name.split('.').pop()}`, { type: file.type }) : file);
}

type PanelProps = { data: DashboardData; target: AttachmentTarget; canUpload?: boolean; title?: string; empty?: string; onChange?: () => void };

/**
 * The files on a ticket, a bug, or a request. Drop files on the panel, paste a screenshot into it, or choose files.
 * Each file opens or downloads through a link that expires after a few minutes, so the list refreshes while it is open.
 */
export function AttachmentPanel({ data, target, canUpload = true, title = 'Attachments', empty = 'Add a screenshot, document, or short video. Up to 10 MB each.', onChange }: PanelProps) {
  const inputId = useId();
  const input = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<Attachment[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState('');
  const [uploading, setUploading] = useState<string[]>([]);
  const [dragging, setDragging] = useState(false);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);
  const live = data.mode === 'live';
  const key = 'itemId' in target ? `itemId=${encodeURIComponent(target.itemId)}` : `requestId=${encodeURIComponent(target.requestId)}`;

  useEffect(() => {
    if (!live) return;
    const controller = new AbortController();
    async function load() {
      try {
        const response = await fetch(`/api/attachments?${key}`, { signal: controller.signal, cache: 'no-store' });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error ?? 'Files could not be loaded.');
        setFiles(result.attachments ?? []); setError(''); setLoaded(true);
      } catch (e) { if (e instanceof Error && e.name !== 'AbortError') { setError(e.message); setLoaded(true); } }
    }
    void load();
    // Links last five minutes. Fetch fresh ones before they expire.
    const timer = window.setInterval(() => void load(), 4 * 60_000);
    return () => { controller.abort(); window.clearInterval(timer); };
  }, [live, key]);

  async function add(chosen: File[]) {
    if (!chosen.length || !live || !canUpload) return;
    setUploading(chosen.map(file => file.name));
    const attached = await uploadFiles(target, chosen, list => { setFiles(list); setError(''); setLoaded(true); });
    setUploading([]);
    if (attached) { toast.success(attached === 1 ? 'File attached' : `${attached} files attached`); onChange?.(); }
  }
  async function remove(file: Attachment) {
    setRemoving(file.id);
    try {
      const response = await fetch(`/api/attachments?id=${encodeURIComponent(file.id)}`, { method: 'DELETE' });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error ?? 'Could not remove this file.');
      setFiles(result.attachments ?? []); setConfirming(null); toast.success(`${file.name} removed`); onChange?.();
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Could not remove this file.'); }
    finally { setRemoving(null); }
  }
  const dropProps = live && canUpload ? {
    onDragOver: (event: DragEvent) => { if (event.dataTransfer.types.includes('Files')) { event.preventDefault(); setDragging(true); } },
    onDragLeave: (event: DragEvent) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false); },
    onDrop: (event: DragEvent) => { event.preventDefault(); setDragging(false); void add(filesFrom(event.dataTransfer.files)); },
    onPaste: (event: ClipboardEvent) => { const pasted = filesFrom(event.clipboardData.files, true); if (pasted.length) { event.preventDefault(); void add(pasted); } },
  } : {};
  const busy = uploading.length > 0;

  return <section className={clsx('drawer-section attachments-section', dragging && 'is-dragging')} aria-label={title} {...dropProps}>
    <div className="detail-section-heading">{title}{files.length > 0 && <span>{files.length}</span>}{live && canUpload && <>
      <Button variant="outline" size="sm" type="button" disabled={busy} onClick={() => input.current?.click()}>{busy ? <LoaderCircle data-icon="inline-start" className="spin" /> : <Paperclip data-icon="inline-start" />}{busy ? 'Uploading…' : 'Attach files'}</Button>
      <input ref={input} id={inputId} aria-label="Choose files to attach" className="sr-only" type="file" multiple accept={ATTACHMENT_ACCEPT.input} disabled={busy} onChange={e => { void add(filesFrom(e.target.files)); e.target.value = ''; }} />
    </>}</div>
    {!live ? <p className="attachment-help">Attach screenshots, documents, and short videos in your live workspace.</p>
      : error ? <p className="attachment-help field-error" role="alert">{error}</p>
      : <>
        {files.length > 0 && <ul className="attachment-list">{files.map(file => {
          const image = file.mimeType.startsWith('image/') && file.viewUrl;
          return <li key={file.id} className="attachment-item">
            {image ? <a className="attachment-thumb" href={file.viewUrl!} target="_blank" rel="noopener noreferrer" aria-label={`Open ${file.name}`}>
                {/* Signed links from private storage cannot go through the image optimiser. */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={file.viewUrl!} alt="" loading="lazy" />
              </a>
              : <span className="attachment-icon">{iconFor(file.name, file.mimeType)}</span>}
            <span className="attachment-text">
              <a href={file.url} className="attachment-name" title={`Download ${file.name}`}>{file.name}</a>
              <span className="attachment-meta">{fileSize(file.size)} · {file.uploadedById === data.currentUser.id ? 'you' : file.uploadedByName} · {displayDateTime(file.createdAt)}</span>
            </span>
            {confirming === file.id
              ? <span className="confirm-inline"><span>Remove?</span><Button size="sm" variant="destructive" disabled={removing === file.id} onClick={() => void remove(file)}>Remove</Button><Button size="sm" variant="ghost" onClick={() => setConfirming(null)}>Keep</Button></span>
              : <span className="attachment-actions">
                {file.viewUrl && <Button variant="ghost" size="icon-sm" asChild><a href={file.viewUrl} target="_blank" rel="noopener noreferrer" aria-label={`Open ${file.name}`} title="Open in a new tab"><Eye /></a></Button>}
                <Button variant="ghost" size="icon-sm" asChild><a href={file.url} aria-label={`Download ${file.name}`} title="Download"><Download /></a></Button>
                {file.canDelete && <Button variant="ghost" size="icon-sm" aria-label={`Remove ${file.name}`} title="Remove" onClick={() => setConfirming(file.id)}><Trash2 /></Button>}
              </span>}
          </li>;
        })}</ul>}
        {uploading.length > 0 && <ul className="attachment-list">{uploading.map(name => <li key={name} className="attachment-item is-uploading"><span className="attachment-icon"><LoaderCircle className="spin" aria-hidden="true" /></span><span className="attachment-text"><span className="attachment-name">{name}</span><span className="attachment-meta">Uploading…</span></span></li>)}</ul>}
        {loaded && files.length === 0 && !busy && (canUpload
          ? <button type="button" className="attachment-drop" onClick={() => input.current?.click()}><Upload aria-hidden="true" /><span><strong>Drop files here, paste a screenshot, or choose files.</strong>{empty}</span></button>
          : <p className="attachment-help">No files yet.</p>)}
        {!loaded && <p className="attachment-help">Loading files…</p>}
        {canUpload && files.length > 0 && <p className="attachment-help">Drop more files here, or paste a screenshot. Up to 10 MB each.</p>}
      </>}
  </section>;
}

/** Files chosen in a form, before the record they belong to exists. They upload once it is saved. */
export function FilePicker({ files, onChange, disabled }: { files: File[]; onChange: (files: File[]) => void; disabled?: boolean }) {
  const input = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  function add(chosen: File[]) {
    const fine = chosen.filter(file => { const problem = attachmentProblem(file); if (problem) toast.error(problem); return !problem; });
    const names = new Set(files.map(file => `${file.name}:${file.size}`));
    onChange([...files, ...fine.filter(file => !names.has(`${file.name}:${file.size}`))].slice(0, 10));
  }
  return <div className={clsx('file-picker', dragging && 'is-dragging')}
    onDragOver={event => { if (event.dataTransfer.types.includes('Files')) { event.preventDefault(); setDragging(true); } }}
    onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false); }}
    onDrop={event => { event.preventDefault(); setDragging(false); add(filesFrom(event.dataTransfer.files)); }}
    onPaste={event => { const pasted = filesFrom(event.clipboardData.files, true); if (pasted.length) { event.preventDefault(); add(pasted); } }}>
    <button type="button" className="attachment-drop" disabled={disabled || files.length >= 10} onClick={() => input.current?.click()}>
      <Upload aria-hidden="true" /><span><strong>Drop files here, paste a screenshot, or choose files.</strong>Screenshots, documents, sheets, or a short screen recording. Up to 10 files, 10 MB each.</span>
    </button>
    <input ref={input} aria-label="Choose files to attach" className="sr-only" type="file" multiple accept={ATTACHMENT_ACCEPT.input} disabled={disabled} onChange={e => { add(filesFrom(e.target.files)); e.target.value = ''; }} />
    {files.length > 0 && <ul className="attachment-list">{files.map((file, index) => <li key={`${file.name}-${index}`} className="attachment-item">
      <span className="attachment-icon">{iconFor(file.name, file.type)}</span>
      <span className="attachment-text"><span className="attachment-name">{file.name}</span><span className="attachment-meta">{fileSize(file.size)}</span></span>
      <Button type="button" variant="ghost" size="icon-sm" aria-label={`Remove ${file.name}`} disabled={disabled} onClick={() => onChange(files.filter((_, i) => i !== index))}><X /></Button>
    </li>)}</ul>}
  </div>;
}
