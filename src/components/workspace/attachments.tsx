"use client";

import { useEffect, useId, useMemo, useRef, useState, type ClipboardEvent, type DragEvent, type ReactNode } from 'react';
import clsx from 'clsx';
import { toast } from 'sonner';
import { ChevronLeft, ChevronRight, Download, ExternalLink, Eye, File as FileIcon, FileImage, FileSpreadsheet, FileText, FileVideo, LoaderCircle, Paperclip, Presentation, Trash2, Upload, X } from 'lucide-react';
import type { Attachment, DashboardData } from '@/lib/types';
import { ATTACHMENT_ACCEPT, attachmentProblem, attachmentType, fileSize, previewKind, type AttachmentKind } from '@/lib/attachments';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
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

/** The reason a failed call gives. The hosting answers in plain text when a body is too large, so that case is named here. */
async function failure(response: Response, file: File) {
  if (response.status === 413) return `${file.name} is too large for this server. Each file can be up to 10 MB.`;
  const body = await response.json().catch(() => null) as { error?: string } | null;
  return body?.error ?? `Could not attach ${file.name} (error ${response.status}). Please try again.`;
}
const SMALL_ENOUGH_FOR_THE_APP = 4 * 1024 * 1024;
/** How far an upload is, from 0 to 1. */
type OnProgress = (fraction: number) => void;

/** The older path: the file goes through the app. The hosting limits this to a few megabytes. */
async function sendThroughApp(target: AttachmentTarget, file: File): Promise<Attachment[]> {
  const form = new FormData();
  if ('itemId' in target) form.append('itemId', target.itemId); else form.append('requestId', target.requestId);
  form.append('file', file);
  const response = await fetch('/api/attachments', { method: 'POST', body: form });
  if (!response.ok) throw new Error(await failure(response, file));
  return (await response.json()).attachments ?? [];
}

/** Sends the file to its upload link and reports progress. Resolves true when storage accepted it. */
function putWithProgress(url: string, contentType: string, file: File, onProgress?: OnProgress): Promise<boolean> {
  return new Promise(resolve => {
    const request = new XMLHttpRequest();
    request.open('PUT', url);
    request.setRequestHeader('Content-Type', contentType);
    request.upload.onprogress = event => { if (event.lengthComputable) onProgress?.(event.loaded / event.total); };
    request.onload = () => resolve(request.status >= 200 && request.status < 300);
    request.onerror = () => resolve(false);
    request.onabort = () => resolve(false);
    request.send(file);
  });
}

/**
 * Sends one file and returns the target's files after it, or throws a reason a person can act on.
 * The app checks the file and returns a short-lived upload link. The browser sends the file straight to private storage,
 * then the app checks it arrived and lists it. If the direct upload cannot run, a small file goes through the app instead.
 */
async function sendFile(target: AttachmentTarget, file: File, onProgress?: OnProgress): Promise<Attachment[]> {
  const call = (body: Record<string, unknown>) => fetch('/api/attachments', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...target, ...body }) });
  const start = await call({ step: 'start', name: file.name, size: file.size, type: file.type });
  if (!start.ok) throw new Error(await failure(start, file));
  const { attachmentId, uploadUrl, contentType } = await start.json() as { attachmentId: string; uploadUrl: string; contentType: string };
  if (!await putWithProgress(uploadUrl, contentType, file, onProgress)) {
    if (file.size <= SMALL_ENOUGH_FOR_THE_APP) return sendThroughApp(target, file);
    throw new Error(`Could not upload ${file.name}. Check your connection and try again.`);
  }
  const finish = await call({ step: 'finish', attachmentId, name: file.name });
  if (!finish.ok) throw new Error(await failure(finish, file));
  return (await finish.json()).attachments ?? [];
}

/**
 * Uploads files one by one, so a large file never blocks the others. Files that cannot be attached are skipped with a message.
 * Returns how many were attached.
 */
export async function uploadFiles(target: AttachmentTarget, files: File[], onEach?: (list: Attachment[]) => void, onProgress?: (file: File, fraction: number) => void): Promise<number> {
  let attached = 0;
  for (const file of files) {
    const problem = attachmentProblem(file);
    if (problem) { toast.error(problem); continue; }
    try { onEach?.(await sendFile(target, file, fraction => onProgress?.(file, fraction))); attached++; }
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
  const [uploading, setUploading] = useState<{ name: string; progress: number }[]>([]);
  const [viewing, setViewing] = useState<string | null>(null);
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
    setUploading(chosen.map(file => ({ name: file.name, progress: 0 })));
    const attached = await uploadFiles(target, chosen, list => { setFiles(list); setError(''); setLoaded(true); },
      (file, progress) => setUploading(current => current.map(row => row.name === file.name ? { ...row, progress } : row)));
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
          const preview = previewKind(file.name, file.mimeType);
          const open = () => setViewing(file.id);
          return <li key={file.id} className="attachment-item">
            {preview === 'image' && file.viewUrl
              ? <button type="button" className="attachment-thumb" onClick={open} aria-label={`Preview ${file.name}`}>
                {/* Signed links from private storage cannot go through the image optimiser. */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={file.viewUrl} alt="" loading="lazy" />
              </button>
              : <span className="attachment-icon">{iconFor(file.name, file.mimeType)}</span>}
            <span className="attachment-text">
              {preview && file.viewUrl
                ? <button type="button" className="attachment-name" onClick={open} title={`Preview ${file.name}`}>{file.name}</button>
                : <a href={file.url} className="attachment-name" title={`Download ${file.name}`}>{file.name}</a>}
              <span className="attachment-meta">{fileSize(file.size)} · {file.uploadedById === data.currentUser.id ? 'you' : file.uploadedByName} · {displayDateTime(file.createdAt)}</span>
            </span>
            {confirming === file.id
              ? <span className="confirm-inline"><span>Remove?</span><Button size="sm" variant="destructive" disabled={removing === file.id} onClick={() => void remove(file)}>Remove</Button><Button size="sm" variant="ghost" onClick={() => setConfirming(null)}>Keep</Button></span>
              : <span className="attachment-actions">
                {preview && file.viewUrl && <Button variant="ghost" size="icon-sm" aria-label={`Preview ${file.name}`} title="Preview" onClick={open}><Eye /></Button>}
                <Button variant="ghost" size="icon-sm" asChild><a href={file.url} aria-label={`Download ${file.name}`} title="Download"><Download /></a></Button>
                {file.canDelete && <Button variant="ghost" size="icon-sm" aria-label={`Remove ${file.name}`} title="Remove" onClick={() => setConfirming(file.id)}><Trash2 /></Button>}
              </span>}
          </li>;
        })}</ul>}
        {uploading.length > 0 && <ul className="attachment-list">{uploading.map(row => <li key={row.name} className="attachment-item is-uploading">
          <span className="attachment-icon"><LoaderCircle className="spin" aria-hidden="true" /></span>
          <span className="attachment-text"><span className="attachment-name">{row.name}</span>
            <span className="upload-progress" role="progressbar" aria-label={`Uploading ${row.name}`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(row.progress * 100)}><i style={{ width: `${Math.max(4, row.progress * 100)}%` }} /></span>
            <span className="attachment-meta">{row.progress >= 1 ? 'Finishing…' : `Uploading… ${Math.round(row.progress * 100)}%`}</span></span>
        </li>)}</ul>}
        {loaded && files.length === 0 && !busy && (canUpload
          ? <button type="button" className="attachment-drop" onClick={() => input.current?.click()}><Upload aria-hidden="true" /><span><strong>Drop files here, paste a screenshot, or choose files.</strong>{empty}</span></button>
          : <p className="attachment-help">No files yet.</p>)}
        {!loaded && <p className="attachment-help">Loading files…</p>}
        {canUpload && files.length > 0 && <p className="attachment-help">Drop more files here, or paste a screenshot. Up to 10 MB each.</p>}
      </>}
    {viewing && <FileViewer data={data} files={files.filter(file => previewKind(file.name, file.mimeType) && file.viewUrl)} startId={viewing} onClose={() => setViewing(null)} />}
  </section>;
}

/** Files chosen in a form, before the record they belong to exists. They upload once it is saved. */
export function FilePicker({ files, onChange, disabled }: { files: File[]; onChange: (files: File[]) => void; disabled?: boolean }) {
  const input = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  // A preview of each chosen image, so people see what they are about to send. The links are freed when the list changes.
  const thumbs = useMemo(() => files.map(file => file.type.startsWith('image/') && previewKind(file.name, file.type) === 'image' ? URL.createObjectURL(file) : null), [files]);
  useEffect(() => () => thumbs.forEach(url => { if (url) URL.revokeObjectURL(url); }), [thumbs]);
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
      {thumbs[index]
        // eslint-disable-next-line @next/next/no-img-element
        ? <span className="attachment-thumb"><img src={thumbs[index]!} alt="" /></span>
        : <span className="attachment-icon">{iconFor(file.name, file.type)}</span>}
      <span className="attachment-text"><span className="attachment-name">{file.name}</span><span className="attachment-meta">{fileSize(file.size)}</span></span>
      <Button type="button" variant="ghost" size="icon-sm" aria-label={`Remove ${file.name}`} disabled={disabled} onClick={() => onChange(files.filter((_, i) => i !== index))}><X /></Button>
    </li>)}</ul>}
  </div>;
}

/**
 * A large preview of a file inside the app: images (select to zoom), PDFs, videos, and text or CSV files.
 * Arrow keys and the side buttons move between files. Each file can also download or open in a new tab.
 */
function FileViewer({ data, files, startId, onClose }: { data: DashboardData; files: Attachment[]; startId: string; onClose: () => void }) {
  const [index, setIndex] = useState(() => Math.max(0, files.findIndex(file => file.id === startId)));
  const [zoomed, setZoomed] = useState(false);
  const file = files[Math.min(index, files.length - 1)];
  const many = files.length > 1;
  const go = (step: number) => { setZoomed(false); setIndex(current => (current + step + files.length) % files.length); };
  if (!file?.viewUrl) return null;
  const preview = previewKind(file.name, file.mimeType);
  return <Dialog open onOpenChange={open => { if (!open) onClose(); }}>
    <DialogContent showCloseButton={false} className="file-viewer" onKeyDown={event => { if (!many) return; if (event.key === 'ArrowRight') { event.preventDefault(); go(1); } if (event.key === 'ArrowLeft') { event.preventDefault(); go(-1); } }}>
      <header className="file-viewer-head">
        <span className="attachment-icon">{iconFor(file.name, file.mimeType)}</span>
        <div className="file-viewer-title">
          <DialogTitle>{file.name}</DialogTitle>
          <DialogDescription>{fileSize(file.size)} · {file.uploadedById === data.currentUser.id ? 'you' : file.uploadedByName} · {displayDateTime(file.createdAt)}{many ? ` · ${index + 1} of ${files.length}` : ''}</DialogDescription>
        </div>
        <div className="file-viewer-actions">
          <Button variant="ghost" size="icon-sm" asChild><a href={file.viewUrl} target="_blank" rel="noopener noreferrer" aria-label="Open in a new tab" title="Open in a new tab"><ExternalLink /></a></Button>
          <Button variant="ghost" size="icon-sm" asChild><a href={file.url} aria-label={`Download ${file.name}`} title="Download"><Download /></a></Button>
          <Button variant="ghost" size="icon-sm" aria-label="Close preview" title="Close" onClick={onClose}><X /></Button>
        </div>
      </header>
      <div className={clsx('file-viewer-body', `is-${preview}`, zoomed && 'is-zoomed')}>
        {preview === 'image' && <button type="button" className="file-viewer-image" onClick={() => setZoomed(!zoomed)} aria-label={zoomed ? 'Fit to the window' : 'Show at full size'}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img key={file.id} src={file.viewUrl} alt={file.name} />
        </button>}
        {preview === 'pdf' && <iframe key={file.id} src={file.viewUrl} title={file.name} />}
        {preview === 'video' && <video key={file.id} src={file.viewUrl} controls playsInline preload="metadata">Your browser cannot play this video. Download it instead.</video>}
        {preview === 'text' && <TextPreview key={file.id} file={file} />}
        {many && <>
          <Button variant="secondary" size="icon" className="file-viewer-nav is-prev" aria-label="Previous file" onClick={() => go(-1)}><ChevronLeft /></Button>
          <Button variant="secondary" size="icon" className="file-viewer-nav is-next" aria-label="Next file" onClick={() => go(1)}><ChevronRight /></Button>
        </>}
      </div>
    </DialogContent>
  </Dialog>;
}

const TEXT_LIMIT = 512 * 1024;
/** A text file as text, and a CSV file as a table. Very long files show their start, with the rest a download away. */
function TextPreview({ file }: { file: Attachment }) {
  const [state, setState] = useState<{ text: string; cut: boolean } | { error: string } | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      try {
        const response = await fetch(file.viewUrl!, { signal: controller.signal });
        if (!response.ok) throw new Error('This file could not be shown. Download it instead.');
        const text = await response.text();
        setState({ text: text.slice(0, TEXT_LIMIT), cut: text.length > TEXT_LIMIT });
      } catch (error) { if (!(error instanceof Error && error.name === 'AbortError')) setState({ error: error instanceof Error ? error.message : 'This file could not be shown.' }); }
    }
    void load();
    return () => controller.abort();
  }, [file.viewUrl]);
  if (!state) return <p className="file-viewer-note"><LoaderCircle className="spin" aria-hidden="true" />Loading…</p>;
  if ('error' in state) return <p className="file-viewer-note">{state.error}</p>;
  const csv = /\.csv$/i.test(file.name) ? parseCsv(state.text) : null;
  return <div className="file-viewer-text">
    {csv && csv.length > 0
      ? <table><thead><tr>{csv[0].map((cell, i) => <th key={i}>{cell}</th>)}</tr></thead><tbody>{csv.slice(1, 501).map((row, r) => <tr key={r}>{row.map((cell, i) => <td key={i}>{cell}</td>)}</tr>)}</tbody></table>
      : <pre>{state.text}</pre>}
    {(state.cut || (csv && csv.length > 501)) && <p className="file-viewer-note">Showing the start of the file. Download it to see everything.</p>}
  </div>;
}

/** Rows and cells of a CSV file, with quoted cells that may hold commas, quotes, and line breaks. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], cell = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (char === '"') quoted = false;
      else cell += char;
    } else if (char === '"') quoted = true;
    else if (char === ',') { row.push(cell); cell = ''; }
    else if (char === '\n' || char === '\r') {
      if (char === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += char;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

