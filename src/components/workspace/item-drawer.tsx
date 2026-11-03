"use client";

import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from 'react';
import clsx from 'clsx';
import { toast } from 'sonner';
import { Activity as ActivityIcon, AlertTriangle, ArrowDown, ArrowUpRight, Bug, CalendarClock, CalendarDays, CircleDot, ClipboardCopy, FileText, Flag, Link2, ListTodo, LoaderCircle, Pencil, Plus, RotateCcw } from 'lucide-react';
import type { Activity, DashboardData, WorkItem } from '@/lib/types';
import { getBugKpi } from '@/lib/kpi';
import { Avatar, FormField, FormSelect, Modal, PriorityBadge, StatusBadge, StatusIcon } from '@/components/ui';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { FieldGroup } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { extensionHistory, reasonLabel, ticketExtendedDays } from '@/lib/timeline';
import { displayDate, displayDateTime, findMember, findProject, hours, isAdhocProject, kindLabels, pendingExtension, percent, projectMembers, statusLabels, today, type MutationFn, type OnAction, type WorkClassification } from './lib';
import { canAddHours, canMoveDueDate, copyItemLink, ItemActions, PendingExtensionBadge, PhaseTag, ProjectTag, SeverityBadge } from './parts';
import { dayCount, ExtensionHistory, TicketExtendedBadge } from './timeline';
import { ClassificationFields, FormChoice } from './forms';

function activityText(event: Activity, item: WorkItem) {
  const noun = kindLabels[item.type].toLowerCase();
  const date = (value: unknown) => displayDate(typeof value === 'string' ? value : null);
  switch (event.action) {
    case 'task.created': case 'created': return item.type === 'task' ? 'created this ticket' : 'reported this bug';
    case 'bug.reported': return 'reported this bug';
    case 'task.completed': return 'approved the ticket';
    case 'bug.fixed': return 'marked the bug fixed';
    case 'bug.verified': return 'verified the fix';
    case 'bug.reopened': return 'reopened the bug';
    case 'task.estimate_revised': return `changed the estimate from ${event.payload.from} h to ${event.payload.to} h`;
    case 'task.updated': case 'bug.updated': case 'updated': return `updated the ${noun} details`;
  }
  const category = reasonLabel(event.payload.reasonCategory);
  const asked = `${event.payload.hours} more ${event.payload.hours === 1 ? 'hour' : 'hours'}`;
  switch (event.action) {
    case 'task.due_change_requested': return `asked for ${asked}${category ? ` · ${category}` : ''}`;
    case 'task.due_change_declined': return `declined the ask for ${asked}`;
    case 'task.due_change_withdrawn': return `withdrew the ask for ${asked}`;
    // Hours added to a ticket with no date change only the estimate.
    case 'task.hours_added': return `${typeof event.payload.requestedBy === 'string' ? 'approved' : 'added'} ${event.payload.addedHours} more ${event.payload.addedHours === 1 ? 'hour' : 'hours'}, so the estimate went from ${event.payload.estimateFrom} h to ${event.payload.estimateTo} h${category ? ` · ${category}` : ''}`;
  }
  if (event.action.endsWith('.due_changed')) {
    const from = event.payload.from;
    if (typeof from !== 'string') return `set the date to ${date(event.payload.to)}`;
    const moved = `from ${date(from)} to ${date(event.payload.to)}${category ? ` · ${category}` : ''}`;
    // An extension in hours names them. An older one only moved the date.
    if (typeof event.payload.addedHours === 'number') return `${typeof event.payload.requestedBy === 'string' ? 'approved' : 'added'} ${event.payload.addedHours} more ${event.payload.addedHours === 1 ? 'hour' : 'hours'}, so the date moved ${moved}`;
    return `${String(event.payload.to) > from ? 'extended the date' : 'moved the date'} ${moved}`;
  }
  if (event.action.endsWith('status_changed')) {
    const to = event.payload.to as WorkItem['status'];
    if (event.payload.from === 'in_review' && to === 'in_progress') return 'sent it back for changes';
    if (event.payload.from === 'blocked' && to === 'in_progress') return 'unblocked it';
    if (event.payload.from === 'done') return 'reopened the ticket';
    return to === 'blocked' ? 'marked it blocked' : to === 'in_review' ? 'submitted it for review' : `moved it to ${statusLabels[to]?.toLowerCase() ?? String(to)}`;
  }
  return event.action.replaceAll('.', ' ').replaceAll('_', ' ');
}

/** A label and its value. The details panel lists every fact this way, so they line up and read the same. */
function Fact({ label, children, action, className }: { label: string; children: ReactNode; action?: ReactNode; className?: string }) {
  return <div className={clsx('detail-fact', className)}><span className="detail-fact-label">{label}</span><strong className="detail-fact-value">{children}</strong>{action}</div>;
}

type DrawerProps = { item: WorkItem; data: DashboardData; busy: boolean; onClose: () => void; onOpen: (id: string) => void; onAction: OnAction; onAddHours: () => void; onExtend: () => void; mutate: MutationFn };

export function ItemDrawer({ item, data, busy, onClose, onOpen, onAction, onAddHours, onExtend, mutate }: DrawerProps) {
  // Editing belongs to one item. Opening a linked item shows it unedited, without closing the panel.
  const [editingId, setEditingId] = useState<string | null>(null);
  const editing = editingId === item.id;
  const setEditing = (on: boolean) => setEditingId(on ? item.id : null);
  const admin = data.currentUser.role === 'admin';
  const owner = item.assigneeId === data.currentUser.id;
  const person = findMember(data, item.assigneeId);
  const phase = item.phaseId ? data.phases.find(p => p.id === item.phaseId) : undefined;
  const events = data.activities.filter(a => a.entityId === item.id).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const creator = events.find(event => event.action === 'task.created' || event.action === 'bug.reported' || event.action === 'created');
  const linkedBugs = data.items.filter(i => i.taskId === item.id);
  const linkedTicket = item.taskId ? data.items.find(i => i.id === item.taskId) : undefined;
  const bugKpi = item.type === 'bug' ? getBugKpi(item, data) : null;
  const closed = item.status === 'done' || item.status === 'fixed' || item.status === 'verified';
  const extensionCount = extensionHistory(data, item.id).length;
  const extendedDays = ticketExtendedDays(item);
  const waitingExtension = pendingExtension(data, item.id);
  const project = findProject(data, item.projectId);
  const pastProjectTarget = item.type === 'task' && !closed && !!item.dueDate && !!project?.targetDate && !isAdhocProject(project) && item.dueDate > project.targetDate;
  const overdue = item.type === 'task' && !closed && !!item.dueDate && item.dueDate < today(data.settings.timezone);
  const actorName = (id: string) => id === data.currentUser.id ? 'You' : findMember(data, id)?.name ?? 'Your admin';
  const creatorName = creator ? actorName(creator.actorId) : null;
  const ticket = item.type === 'task';

  async function copySummary() {
    try { await navigator.clipboard.writeText(`${item.key}: ${item.title}\nOwner: ${person?.name ?? 'Unassigned'}\nStatus: ${statusLabels[item.status]}`); toast.success('Summary copied'); }
    catch { toast.error('Could not copy the summary.'); }
  }

  return <Modal title={item.key} subtitle={ticket ? 'Ticket' : 'Bug'} onClose={onClose} drawer titleIcon={ticket ? <ListTodo className="drawer-kind-icon" aria-hidden="true" /> : <Bug className="drawer-kind-icon drawer-kind-bug" aria-hidden="true" />}
    headerActions={<Button variant="ghost" size="icon-sm" onClick={() => void copyItemLink(data, item)} aria-label={`Copy link to ${item.key}`} title="Copy link"><Link2 /></Button>}>
    <div className="item-drawer-body">
      <div className="detail-title-row"><h2>{item.title}</h2>{(admin || owner) && <Button variant="ghost" size="icon-sm" onClick={() => setEditing(!editing)} aria-label={`Edit ${kindLabels[item.type].toLowerCase()} details`} aria-pressed={editing}><Pencil size={15} /></Button>}</div>
      <div className="detail-status-row"><StatusBadge status={item.status} /><PriorityBadge priority={item.priority} />{item.type === 'bug' && <SeverityBadge item={item} />}{ticket && <TicketExtendedBadge data={data} item={item} />}{ticket && <PendingExtensionBadge data={data} item={item} />}</div>

      <div className="detail-actions">
        <ItemActions item={item} admin={admin} onAction={onAction} busy={busy} />
        {ticket && ['todo', 'in_progress'].includes(item.status) && <Button variant="outline" size="sm" onClick={() => onAction(item, 'blocked')} disabled={busy}><Flag data-icon="inline-start" size={13} />Mark blocked</Button>}
        {ticket && item.status === 'blocked' && <Button variant="outline" size="sm" onClick={() => onAction(item, 'in_progress')} disabled={busy}><CircleDot data-icon="inline-start" size={13} />Unblock</Button>}
        {admin && item.status === 'in_review' && <Button variant="outline" size="sm" onClick={() => onAction(item, 'in_progress')} disabled={busy}>Send back<ArrowDown data-icon="inline-end" size={13} /></Button>}
        {admin && item.status === 'done' && <Button variant="outline" size="sm" onClick={() => onAction(item, 'in_progress')} disabled={busy}><RotateCcw data-icon="inline-start" size={13} />Reopen</Button>}
        {admin && (item.status === 'fixed' || item.status === 'verified') && <Button variant="outline" size="sm" onClick={() => onAction(item, 'open')} disabled={busy}><RotateCcw data-icon="inline-start" size={13} />Reopen</Button>}
      </div>
      {item.status === 'blocked' && <Alert variant="destructive" className="detail-blocker"><AlertTriangle /><AlertTitle>This ticket is blocked</AlertTitle><AlertDescription>{item.blocker || 'A blocker has been recorded.'}{(admin || owner) && ' When it is cleared, choose Unblock.'}</AlertDescription></Alert>}
      {editing && <ItemDetailsForm item={item} data={data} mutate={mutate} busy={busy} onClose={() => setEditing(false)} />}

      <div className="detail-facts">
        <Fact label="Owner"><span className="detail-person"><Avatar member={person} size="small" />{owner ? 'You' : person?.name ?? 'Unassigned'}</span></Fact>
        <Fact label="Project"><ProjectTag data={data} id={item.projectId} /></Fact>
        <Fact label="Phase"><PhaseTag data={data} id={item.phaseId} /></Fact>
        {ticket ? <>
          <Fact label="Estimate" action={canAddHours(item, data) && <Button variant="link" size="sm" onClick={onAddHours}>{admin ? 'Add hours' : 'Ask for hours'}<Plus data-icon="inline-end" size={11} /></Button>}>{item.estimateHours} <small>hours</small></Fact>
          <Fact label="Date" className={clsx(overdue && 'detail-fact-late')} action={<>{canMoveDueDate(item, data) && (item.dueDate
              ? <Button variant="link" size="sm" onClick={onExtend}>{admin ? 'Extend' : 'Ask to extend'}<CalendarClock data-icon="inline-end" size={11} /></Button>
              : <Button variant="link" size="sm" onClick={onExtend}>Set date<CalendarDays data-icon="inline-end" size={11} /></Button>)}
            {waitingExtension && <small className="extension-waiting">Asked for {waitingExtension.hours} more {waitingExtension.hours === 1 ? 'hour' : 'hours'} · waits for approval</small>}</>}>
            <span className={clsx(overdue && 'due-overdue')}>{item.dueDate ? displayDate(item.dueDate) : '—'}</span>{overdue && <small> · carried over</small>}
          </Fact>
          {item.completedAt
            ? <Fact label="Approved on">{displayDate(item.completedAt)} <small>· {item.estimateHours} h credited</small></Fact>
            : <Fact label="Extended">{extendedDays ? `+${dayCount(extendedDays)}` : extensionCount ? 'Moved' : 'No'} <small>{extensionCount ? `· ${extensionCount} time${extensionCount === 1 ? '' : 's'}` : item.dueDate ? '· on its first date' : '· no date yet'}</small></Fact>}
        </> : <>
          <Fact label="Reported">{displayDateTime(item.reportedAt)}</Fact>
          <Fact label="Fix by" className={clsx(bugKpi && bugKpi.overdueHours > 0 && !closed && 'detail-fact-late')}>{bugKpi ? displayDateTime(bugKpi.deadline1) : '—'} <small>· {item.severity === 'critical' ? data.settings.criticalTargetHours : data.settings.normalTargetHours} working h target</small></Fact>
          <Fact label={closed ? 'Bug points' : 'Time left'}>{closed ? percent(bugKpi?.score ?? null) : bugKpi && bugKpi.overdueHours > 0 ? `${hours(bugKpi.overdueHours)} h late` : `${hours(bugKpi?.hoursRemaining ?? 0)} h`} <small>{closed ? `· ${hours(bugKpi?.resolutionWorkingHours ?? 0)} working h to fix` : '· working hours only'}</small></Fact>
        </>}
        <Fact label="Created">{displayDate(item.createdAt)}{creatorName && <small> · by {creatorName === 'You' ? 'you' : creatorName === 'Your admin' ? 'your admin' : creatorName}</small>}</Fact>
      </div>
      {phase?.description && <p className="phase-note"><strong>{phase.name}:</strong> {phase.description}</p>}
      {pastProjectTarget && <Alert className="detail-blocker"><CalendarClock /><AlertTitle>Dated after the project target</AlertTitle><AlertDescription>{project!.name} targets {displayDate(project!.targetDate)}. {admin ? 'Extend the project if the whole project slips.' : 'Your admin may need to extend the project.'}</AlertDescription></Alert>}

      {!editing && <section className="drawer-section detail-description"><h3 className="detail-section-heading">Details</h3><p className={clsx(!item.description && 'detail-empty')}>{item.description || 'No details yet.'}</p></section>}
      {(linkedTicket || linkedBugs.length > 0) && <section className="drawer-section">
        <h3 className="detail-section-heading">{linkedTicket ? 'Linked ticket' : 'Linked bugs'} {linkedBugs.length > 0 && <span>{linkedBugs.length}</span>}</h3>
        <div className="linked-items">{[...(linkedTicket ? [linkedTicket] : []), ...linkedBugs].map(linked => <button type="button" key={linked.id} className="linked-item" onClick={() => onOpen(linked.id)}>
          <StatusIcon status={linked.status} label /><span className="item-key">{linked.key}</span><span className="linked-item-title">{linked.title}</span><ArrowUpRight size={14} aria-hidden="true" />
        </button>)}</div>
      </section>}
      {ticket && item.dueDate && <section className="drawer-section"><h3 className="detail-section-heading">Date history <span>{extensionCount}</span></h3><ExtensionHistory data={data} entityId={item.id} empty={`Still on its first date, ${displayDate(item.originalDueDate ?? item.dueDate)}.`} /></section>}
      <Attachments data={data} itemId={item.id} />
      <section className="activity-section">
        <h3 className="detail-section-heading">Timeline <span>{events.length}</span></h3>
        <div className="timeline">{events.length === 0 ? <p className="form-help">Changes to this {kindLabels[item.type].toLowerCase()} will appear here.</p>
          : events.map(event => <div className="timeline-entry" key={event.id}>
              <span className="timeline-marker"><ActivityIcon size={12} /></span>
              <div className="timeline-content"><p><strong>{actorName(event.actorId)}</strong> {activityText(event, item)}.</p><time dateTime={event.createdAt}>{displayDateTime(event.createdAt)}</time>{event.reason && <blockquote>{event.reason}</blockquote>}</div>
            </div>)}</div>
      </section>
    </div>
    <div className="drawer-footer">
      <span>Updated {displayDateTime(item.updatedAt)}</span>
      <Button variant="ghost" size="sm" onClick={() => void copySummary()}><ClipboardCopy data-icon="inline-start" size={12} />Copy summary</Button>
    </div>
  </Modal>;
}

/** Admins can change everything here. An owner can change the wording and priority, not the owner, project, or estimate. */
function ItemDetailsForm({ item, data, mutate, busy, onClose }: { item: WorkItem; data: DashboardData; mutate: MutationFn; busy: boolean; onClose: () => void }) {
  const admin = data.currentUser.role === 'admin';
  const [classification, setClassification] = useState<WorkClassification>({ projectId: item.projectId, phaseId: item.phaseId, assigneeId: item.assigneeId });
  const [taskId, setTaskId] = useState(item.taskId ?? '');
  const hasLinkedBugs = item.type === 'task' && data.items.some(bug => bug.type === 'bug' && bug.taskId === item.id);
  function linkTask(id: string) {
    setTaskId(id);
    const task = data.items.find(i => i.id === id);
    if (task) {
      const eligible = projectMembers(data, task.projectId);
      setClassification({ projectId: task.projectId, phaseId: task.phaseId, assigneeId: eligible.some(m => m.id === task.assigneeId) ? task.assigneeId : eligible[0]?.id ?? '' });
    }
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const fields = new FormData(event.currentTarget);
    const wording = { title: String(fields.get('title')).trim(), description: String(fields.get('description')), priority: String(fields.get('priority')) as WorkItem['priority'] };
    const patch = admin ? { ...wording, ...classification, ...(item.type === 'bug' ? { taskId: taskId || null } : {}) } : wording;
    if (await mutate({ action: 'updateItem', id: item.id, patch }, 'Details saved')) onClose();
  }
  return <form className="detail-edit-form" onSubmit={submit}><FieldGroup>
    <FormField>Title<Input name="title" defaultValue={item.title} required minLength={3} maxLength={200} /></FormField>
    {admin && item.type === 'bug' && <FormField>Linked ticket<FormSelect value={taskId} onValueChange={linkTask}><option value="">No linked ticket</option>{data.items.filter(i => i.type === 'task').map(task => <option key={task.id} value={task.id}>{task.key} · {task.title}</option>)}</FormSelect></FormField>}
    {admin && <ClassificationFields data={data} value={classification} onChange={setClassification} retained={item} lockProjectPhase={hasLinkedBugs || (item.type === 'bug' && !!taskId)} />}
    {admin && (hasLinkedBugs || (item.type === 'bug' && taskId)) && <Alert><Link2 /><AlertDescription>{hasLinkedBugs ? 'This ticket has linked bugs. Unlink them before you change its project or phase.' : 'Project and phase come from the linked ticket. Choose No linked ticket to move this bug.'}</AlertDescription></Alert>}
    <FormField>Priority<FormChoice name="priority" defaultValue={item.priority} options={['low', 'medium', 'high', 'urgent'].map(priority => ({ value: priority, label: priority[0].toUpperCase() + priority.slice(1) }))} /></FormField>
    <FormField>Details<Textarea name="description" rows={4} defaultValue={item.description} /></FormField>
    {!admin && <p className="form-help">Your admin changes the owner, project, phase, and estimate.</p>}
    <div className="detail-edit-actions"><Button variant="outline" size="sm" type="button" onClick={onClose}>Cancel</Button><Button size="sm" disabled={busy || !classification.assigneeId} type="submit">Save details</Button></div>
  </FieldGroup></form>;
}

function Attachments({ data, itemId }: { data: DashboardData; itemId: string }) {
  const uploadInputId = useId();
  const uploadInputRef = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<{ id: string; name: string; url: string; createdAt: string }[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    if (data.mode === 'demo') return;
    const controller = new AbortController();
    async function load() {
      try {
        const response = await fetch(`/api/attachments?itemId=${encodeURIComponent(itemId)}`, { signal: controller.signal });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error ?? 'Attachments could not be loaded.');
        setFiles(result.attachments ?? []);
      } catch (e) { if (e instanceof Error && e.name !== 'AbortError') setError(e.message); }
    }
    void load();
    return () => controller.abort();
  }, [data.mode, itemId]);
  async function upload(file?: File) {
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) { toast.error('Choose a file smaller than 10 MB.'); return; }
    const form = new FormData();
    form.append('itemId', itemId); form.append('file', file);
    setLoading(true);
    try {
      const response = await fetch('/api/attachments', { method: 'POST', body: form });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? 'Could not attach this file.');
      setFiles(result.attachments ?? []); setError(''); toast.success('File attached');
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Could not attach this file.'); }
    finally { setLoading(false); }
  }
  return <section className="drawer-section attachments-section">
    <div className="detail-section-heading">Attachments{data.mode === 'live' && <>
      <Button variant="outline" size="sm" type="button" disabled={loading} onClick={() => uploadInputRef.current?.click()}>{loading ? <LoaderCircle data-icon="inline-start" className="spin" /> : <Plus data-icon="inline-start" />}{loading ? 'Uploading…' : 'Attach file'}</Button>
      <Input ref={uploadInputRef} id={uploadInputId} aria-label="Choose an attachment" className="sr-only" type="file" accept="image/png,image/jpeg,image/webp,.pdf,.txt,.log,.csv,.json" disabled={loading} onChange={e => { void upload(e.target.files?.[0]); e.target.value = ''; }} />
    </>}</div>
    {data.mode === 'demo' ? <p className="attachment-help">Attach screenshots, PDFs, and logs in your live workspace.</p>
      : error ? <p className="attachment-help">{error}</p>
      : files.length === 0 ? <p className="attachment-help">Add a screenshot, document, or log. Up to 10 MB each.</p>
      : files.map(file => <a key={file.id} className="attachment-row" href={file.url} target="_blank" rel="noopener noreferrer"><FileText size={17} /><span>{file.name}</span><ArrowUpRight size={14} /></a>)}
  </section>;
}
