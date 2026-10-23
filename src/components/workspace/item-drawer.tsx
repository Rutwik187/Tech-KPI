"use client";

import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import clsx from 'clsx';
import { toast } from 'sonner';
import { Activity as ActivityIcon, AlertTriangle, ArrowDown, ArrowUpRight, Bug, CalendarClock, CalendarDays, FileText, Flag, Link2, LoaderCircle, Pencil, Plus, RotateCcw } from 'lucide-react';
import type { Activity, DashboardData, WorkItem } from '@/lib/types';
import { getBugKpi } from '@/lib/kpi';
import { Avatar, FormField, FormSelect, Modal, PriorityBadge, StatusBadge } from '@/components/ui';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { FieldGroup } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { extensionHistory, reasonLabel, ticketExtendedDays } from '@/lib/timeline';
import { displayDate, displayDateTime, findMember, findProject, hours, isAdhocProject, kindLabels, pendingExtension, percent, projectMembers, statusLabels, today, type MutationFn, type OnAction, type WorkClassification } from './lib';
import { canMoveDueDate, ItemActions, PhaseTag, ProjectTag, SeverityBadge } from './parts';
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
  }
  if (event.action.endsWith('.due_changed')) {
    const from = event.payload.from;
    if (typeof from !== 'string') return `set the due date to ${date(event.payload.to)}`;
    const moved = `from ${date(from)} to ${date(event.payload.to)}${category ? ` · ${category}` : ''}`;
    // An extension in hours names them. An older one only moved the date.
    if (typeof event.payload.addedHours === 'number') return `${typeof event.payload.requestedBy === 'string' ? 'approved' : 'added'} ${event.payload.addedHours} more ${event.payload.addedHours === 1 ? 'hour' : 'hours'}, so the due date moved ${moved}`;
    return `${String(event.payload.to) > from ? 'extended the due date' : 'moved the due date'} ${moved}`;
  }
  if (event.action.endsWith('status_changed')) {
    const to = event.payload.to as WorkItem['status'];
    if (event.payload.from === 'in_review' && to === 'in_progress') return 'sent it back for changes';
    if (event.payload.from === 'done') return 'reopened the ticket';
    return to === 'blocked' ? 'marked it blocked' : to === 'in_review' ? 'submitted it for review' : `moved it to ${statusLabels[to]?.toLowerCase() ?? String(to)}`;
  }
  return event.action.replaceAll('.', ' ').replaceAll('_', ' ');
}

export function ItemDrawer({ item, data, busy, onClose, onAction, onRevise, onExtend, mutate }: { item: WorkItem; data: DashboardData; busy: boolean; onClose: () => void; onAction: OnAction; onRevise: (patch: Partial<WorkItem>, label: string) => void; onExtend: () => void; mutate: MutationFn }) {
  const [editing, setEditing] = useState(false);
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

  return <Modal title={item.key} subtitle={item.type === 'task' ? 'Ticket' : 'Bug'} onClose={onClose} drawer>
    <div className="item-drawer-body">
      <div className="detail-title-row"><h2>{item.title}</h2>{(admin || owner) && <Button variant="ghost" size="icon" onClick={() => setEditing(!editing)} aria-label={`Edit ${kindLabels[item.type].toLowerCase()} details`} aria-pressed={editing}><Pencil size={16} /></Button>}</div>
      <div className="detail-status-row"><StatusBadge status={item.status} /><PriorityBadge priority={item.priority} />{item.type === 'bug' && <SeverityBadge item={item} />}{item.type === 'task' && <TicketExtendedBadge data={data} item={item} />}</div>
      <div className="detail-owner-row">
        <Avatar member={person} /><div><strong>{owner ? 'You' : person?.name ?? 'Unassigned'}</strong><span>Owner</span></div>
        <div className="project-phase-cell"><ProjectTag data={data} id={item.projectId} /><PhaseTag data={data} id={item.phaseId} /></div>
      </div>
      {phase?.description && <p className="phase-note"><strong>{phase.name}:</strong> {phase.description}</p>}

      <div className="detail-actions">
        <ItemActions item={item} admin={admin} onAction={onAction} busy={busy} />
        {item.type === 'task' && ['todo', 'in_progress'].includes(item.status) && <Button variant="outline" size="sm" onClick={() => onAction(item, 'blocked')} disabled={busy}><Flag data-icon="inline-start" size={13} />Mark blocked</Button>}
        {admin && item.status === 'in_review' && <Button variant="outline" size="sm" onClick={() => onAction(item, 'in_progress')} disabled={busy}>Send back<ArrowDown data-icon="inline-end" size={13} /></Button>}
        {admin && item.status === 'done' && <Button variant="outline" size="sm" onClick={() => onAction(item, 'in_progress')} disabled={busy}><RotateCcw data-icon="inline-start" size={13} />Reopen</Button>}
        {admin && (item.status === 'fixed' || item.status === 'verified') && <Button variant="outline" size="sm" onClick={() => onAction(item, 'open')} disabled={busy}><RotateCcw data-icon="inline-start" size={13} />Reopen</Button>}
      </div>
      {item.status === 'blocked' && <Alert variant="destructive" className="detail-blocker"><AlertTriangle /><AlertTitle>This ticket is blocked</AlertTitle><AlertDescription>{item.blocker || 'A blocker has been recorded.'}</AlertDescription></Alert>}
      {editing && <ItemDetailsForm item={item} data={data} mutate={mutate} busy={busy} onClose={() => setEditing(false)} />}

      {item.type === 'task'
        ? <div className="detail-facts">
            <div><span>Estimate</span><strong>{item.estimateHours} <small>hours</small></strong>{admin && !closed && <Button variant="link" size="sm" onClick={() => onRevise({ estimateHours: item.estimateHours }, 'Revise estimate')}>Revise<Pencil data-icon="inline-end" size={11} /></Button>}</div>
            <div><span>Due date</span><strong className={clsx(overdue && 'due-overdue')}>{item.dueDate ? displayDate(item.dueDate) : '—'}{overdue && <small> · overdue</small>}</strong>{canMoveDueDate(item, data) && (item.dueDate
              ? <Button variant="link" size="sm" onClick={onExtend}>{admin ? 'Extend' : 'Ask to extend'}<CalendarClock data-icon="inline-end" size={11} /></Button>
              : <Button variant="link" size="sm" onClick={onExtend}>Set date<CalendarDays data-icon="inline-end" size={11} /></Button>)}
              {waitingExtension && <small className="extension-waiting">Asked for {waitingExtension.hours} more {waitingExtension.hours === 1 ? 'hour' : 'hours'} · waits for approval</small>}</div>
            {item.completedAt
              ? <div><span>Approved on</span><strong>{displayDate(item.completedAt)}</strong><small>{item.estimateHours} h credited</small></div>
              : <div><span>Extended</span><strong>{extendedDays ? `+${dayCount(extendedDays)}` : extensionCount ? 'Moved' : 'No'}</strong><small>{extensionCount ? `${extensionCount} time${extensionCount === 1 ? '' : 's'} · reasons below` : item.dueDate ? 'On its first due date' : 'No due date yet'}</small></div>}
          </div>
        : <div className="detail-facts">
            <div><span>Reported</span><strong>{displayDate(item.reportedAt)}</strong><small>{displayDateTime(item.reportedAt)}</small></div>
            <div><span>Fix by</span><strong>{bugKpi ? displayDate(bugKpi.deadline1) : '—'}</strong><small>{bugKpi ? `${displayDateTime(bugKpi.deadline1)} · ${item.severity === 'critical' ? data.settings.criticalTargetHours : data.settings.normalTargetHours} working h target` : ''}</small></div>
            <div><span>{closed ? 'Bug points' : 'Time left'}</span><strong>{closed ? percent(bugKpi?.score ?? null) : bugKpi && bugKpi.overdueHours > 0 ? `${hours(bugKpi.overdueHours)} h late` : `${hours(bugKpi?.hoursRemaining ?? 0)} h`}</strong><small>{closed ? `${hours(bugKpi?.resolutionWorkingHours ?? 0)} working h to fix` : 'Working hours only'}</small></div>
          </div>}

      {pastProjectTarget && <Alert className="detail-blocker"><CalendarClock /><AlertTitle>Due after the project target</AlertTitle><AlertDescription>{project!.name} targets {displayDate(project!.targetDate)}. {admin ? 'Extend the project if the whole project slips.' : 'Your admin may need to extend the project.'}</AlertDescription></Alert>}
      {!editing && <div className="detail-description"><h3 className="detail-section-heading">Details</h3><p>{item.description || 'No details yet.'}</p></div>}
      {item.type === 'task' && item.dueDate && <div className="drawer-section"><h3 className="detail-section-heading">Due date history <span>{extensionCount}</span></h3><ExtensionHistory data={data} entityId={item.id} empty={`Still on its first due date, ${displayDate(item.originalDueDate ?? item.dueDate)}.`} /></div>}
      {linkedTicket && <div className="linked-task"><Link2 size={14} /><span>Linked ticket</span><strong>{linkedTicket.key} · {linkedTicket.title}</strong></div>}
      {linkedBugs.length > 0 && <div className="linked-bugs"><h3 className="detail-section-heading">Linked bugs</h3>{linkedBugs.map(b => <div key={b.id}><Bug size={14} /><span>{b.title}</span><StatusBadge status={b.status} /></div>)}</div>}
      <Attachments data={data} itemId={item.id} />
      <div className="activity-section">
        <h3 className="detail-section-heading">Timeline <span>{events.length}</span></h3>
        <div className="timeline">{events.length === 0 ? <p className="form-help">Changes to this {kindLabels[item.type].toLowerCase()} will appear here.</p>
          : events.map(event => <div className="timeline-entry" key={event.id}>
              <span className="timeline-marker"><ActivityIcon size={12} /></span>
              <div className="timeline-content"><p><strong>{actorName(event.actorId)}</strong> {activityText(event, item)}.</p><time dateTime={event.createdAt}>{displayDateTime(event.createdAt)}</time>{event.reason && <blockquote>{event.reason}</blockquote>}</div>
            </div>)}</div>
      </div>
    </div>
    <div className="drawer-footer">
      <span>Created {displayDate(item.createdAt)}{creator ? ` by ${actorName(creator.actorId) === 'You' ? 'you' : actorName(creator.actorId)}` : ''}</span>
      <Button variant="link" size="sm" onClick={async () => { try { await navigator.clipboard.writeText(`${item.key}: ${item.title}\nOwner: ${person?.name ?? 'Unassigned'}\nStatus: ${statusLabels[item.status]}`); toast.success('Summary copied'); } catch { toast.error('Could not copy the summary.'); } }}>Copy summary<Link2 data-icon="inline-end" size={12} /></Button>
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
    <FormField>Details<Textarea name="description" rows={3} defaultValue={item.description} /></FormField>
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
  return <div className="attachments-section">
    <div className="detail-section-heading">Attachments{data.mode === 'live' && <>
      <Button variant="outline" size="sm" type="button" disabled={loading} onClick={() => uploadInputRef.current?.click()}>{loading ? <LoaderCircle data-icon="inline-start" className="spin" /> : <Plus data-icon="inline-start" />}{loading ? 'Uploading…' : 'Attach file'}</Button>
      <Input ref={uploadInputRef} id={uploadInputId} aria-label="Choose an attachment" className="sr-only" type="file" accept="image/png,image/jpeg,image/webp,.pdf,.txt,.log,.csv,.json" disabled={loading} onChange={e => { void upload(e.target.files?.[0]); e.target.value = ''; }} />
    </>}</div>
    {data.mode === 'demo' ? <p className="attachment-help">Attach screenshots, PDFs, and logs in your live workspace.</p>
      : error ? <p className="attachment-help">{error}</p>
      : files.length === 0 ? <p className="attachment-help">Add a screenshot, document, or log. Up to 10 MB each.</p>
      : files.map(file => <a key={file.id} className="attachment-row" href={file.url} target="_blank" rel="noopener noreferrer"><FileText size={17} /><span>{file.name}</span><ArrowUpRight size={14} /></a>)}
  </div>;
}
