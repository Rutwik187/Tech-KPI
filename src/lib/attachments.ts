/**
 * The files people can attach to tickets, bugs, and requests. The server and the upload form share these rules.
 * Browsers often send no type for documents and logs, so the extension decides, and a type the browser sends must agree with it.
 * Web pages and scripts are never accepted, and every download is served as a file to save.
 */
export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;

export type AttachmentKind = 'image' | 'pdf' | 'video' | 'document' | 'sheet' | 'slides' | 'text';
/** How a file shows in the app's viewer. Files without a preview download instead. */
export type PreviewKind = 'image' | 'pdf' | 'video' | 'text';
type FileRule = { mimeType: string; kind: AttachmentKind; viewable: boolean; alsoSentAs?: string[] };

const RULES: Record<string, FileRule> = {
  png: { mimeType: 'image/png', kind: 'image', viewable: true },
  jpg: { mimeType: 'image/jpeg', kind: 'image', viewable: true },
  jpeg: { mimeType: 'image/jpeg', kind: 'image', viewable: true },
  webp: { mimeType: 'image/webp', kind: 'image', viewable: true },
  gif: { mimeType: 'image/gif', kind: 'image', viewable: true },
  heic: { mimeType: 'image/heic', kind: 'image', viewable: false },
  pdf: { mimeType: 'application/pdf', kind: 'pdf', viewable: true },
  mp4: { mimeType: 'video/mp4', kind: 'video', viewable: true },
  mov: { mimeType: 'video/quicktime', kind: 'video', viewable: true },
  webm: { mimeType: 'video/webm', kind: 'video', viewable: true },
  doc: { mimeType: 'application/msword', kind: 'document', viewable: false },
  docx: { mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', kind: 'document', viewable: false },
  xls: { mimeType: 'application/vnd.ms-excel', kind: 'sheet', viewable: false },
  xlsx: { mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', kind: 'sheet', viewable: false },
  csv: { mimeType: 'text/csv', kind: 'sheet', viewable: true, alsoSentAs: ['application/vnd.ms-excel', 'text/plain'] },
  ppt: { mimeType: 'application/vnd.ms-powerpoint', kind: 'slides', viewable: false },
  pptx: { mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', kind: 'slides', viewable: false },
  txt: { mimeType: 'text/plain', kind: 'text', viewable: true },
  log: { mimeType: 'text/plain', kind: 'text', viewable: true },
  md: { mimeType: 'text/markdown', kind: 'text', viewable: true, alsoSentAs: ['text/plain', 'text/x-markdown'] },
  json: { mimeType: 'application/json', kind: 'text', viewable: true, alsoSentAs: ['text/plain'] },
};
/** Types a browser sends when it does not know a file. The extension decides then. */
const UNKNOWN_TYPES = new Set(['', 'application/octet-stream']);

/** The rule for a file, from its name and the type the browser sent, or null when it cannot be attached. */
export function attachmentType(name: string, sentType = ''): FileRule | null {
  const dot = name.lastIndexOf('.');
  const extension = dot > 0 ? name.slice(dot + 1).toLowerCase() : '';
  const rule = RULES[extension];
  if (!rule) return null;
  const sent = sentType.toLowerCase().split(';')[0].trim();
  if (UNKNOWN_TYPES.has(sent) || sent === rule.mimeType || rule.alsoSentAs?.includes(sent)) return rule;
  return null;
}

/** For the file picker, and for the message when a file is refused. */
export const ATTACHMENT_ACCEPT = {
  input: Object.keys(RULES).map((extension) => `.${extension}`).join(','),
  label: 'an image, PDF, short video, Word, Excel, PowerPoint, CSV, or text file',
};

/** "820 KB", "2.4 MB". */
export function fileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)} MB`;
}

/** Why a file cannot be attached, before it is sent, or null when it can. */
export function attachmentProblem(file: Pick<File, 'name' | 'size' | 'type'>): string | null {
  if (file.size === 0) return `${file.name} is empty.`;
  if (file.size > MAX_ATTACHMENT_BYTES) return `${file.name} is ${fileSize(file.size)}. Each file can be up to 10 MB.`;
  if (!attachmentType(file.name, file.type)) return `${file.name} cannot be attached. Use ${ATTACHMENT_ACCEPT.label}.`;
  return null;
}

/** How the viewer shows this file, or null when it only downloads. Text is always shown as plain text, never run as a page. */
export function previewKind(name: string, mimeType: string): PreviewKind | null {
  const rule = attachmentType(name, mimeType);
  if (!rule?.viewable) return null;
  if (rule.kind === 'image' || rule.kind === 'pdf' || rule.kind === 'video') return rule.kind;
  return rule.kind === 'text' || rule.mimeType === 'text/csv' ? 'text' : null;
}

