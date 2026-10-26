"use client";

import { useState, type FormEvent, type ReactNode } from 'react';
import { AlertTriangle, ArrowUpRight, Bug, CalendarClock, CalendarDays, Check, CheckCheck, Clock3, Inbox, ListTodo, MessageSquareText, Plus, X } from 'lucide-react';
import type { DashboardData, DueDateRequest, TicketRequest, WorkItem } from '@/lib/types';
import { Avatar, EmptyState, FormDate, FormField, FormSelect, Modal, Panel, PriorityBadge } from '@/components/ui';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { FieldGroup } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { displayDate, displayDateTime, findMember, findProject, firstName, hours, isAdhocProject, MAX_TICKET_HOURS, projectPhases, ticketExtension, today, type MutationFn, type OnAction, type RequestChanges } from './lib';
import { daysBetween, reasonLabel } from '@/lib/timeline';
import { dayCount } from './timeline';
import { EstimateField, FormChoice, FormFooter } from './forms';
import { ItemActions, PhaseTag, ProjectTag } from './parts';

type ApprovalsProps = { data: DashboardData; onOpen: (id: string) => void; onAction: OnAction; onRequest: () => void; mutate: MutationFn; busy: boolean };
const requestStatus: Record<TicketRequest['status'], string> = { pending: 'Waiting for approval', approved: 'Approved', declined: 'Declined' };

/** Everything waiting for a decision. Admins approve; developers follow what they asked for. */
export function Approvals(props: ApprovalsProps) {
  return props.data.currentUser.role === 'admin' ? <AdminApprovals {...props} /> : <DeveloperApprovals {...props} />;
}

/** Finished work: completed tickets wait for approval, fixed bugs wait for verification. */
function finishedWork(data: DashboardData) {
  return data.items.filter(item => item.type === 'task' ? item.status === 'in_review' : item.status === 'fixed')
    .sort((a, b) => a.updatedAt.localeCompare(b.updatedAt));
}

function AdminApprovals({ data, onOpen, onAction, mutate, busy }: ApprovalsProps) {
  const [approving, setApproving] = useState<TicketRequest | null>(null);
  const [declining, setDeclining] = useState<TicketRequest | null>(null);
  const [approvingExtension, setApprovingExtension] = useState<DueDateRequest | null>(null);
  const [decliningExtension, setDecliningExtension] = useState<DueDateRequest | null>(null);
  const extensions = data.dueDateRequests.filter(r => r.status === 'pending').sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  // Oldest first, so nobody waits longest.
  const pending = data.requests.filter(r => r.status === 'pending').sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const reviewed = data.requests.filter(r => r.status !== 'pending').sort((a, b) => (b.reviewedAt ?? '').localeCompare(a.reviewedAt ?? '')).slice(0, 6);
  const finished = finishedWork(data);
  return <>
    <div className="team-overview-strip approvals-strip">
      <div><span className="mini-metric-icon"><Inbox size={18} /></span><strong>{pending.length}</strong><span>ticket {pending.length === 1 ? 'request' : 'requests'}</span></div>
      <div><span className="mini-metric-icon"><CalendarClock size={18} /></span><strong>{extensions.length}</strong><span>{extensions.length === 1 ? 'ask' : 'asks'} for more hours</span></div>
      <div><span className="mini-metric-icon"><ListTodo size={18} /></span><strong>{finished.filter(i => i.type === 'task').length}</strong><span>completed tickets to approve</span></div>
      <div><span className="mini-metric-icon"><Bug size={18} /></span><strong>{finished.filter(i => i.type === 'bug').length}</strong><span>fixed bugs to verify</span></div>
    </div>

    <Panel title="Ticket requests" className="requests-panel">
      <p className="panel-intro">Developers ask for these tickets. Check the estimate and the dates, then approve or decline. An approved request becomes the developer’s ticket.</p>
      {pending.length
        ? <div className="request-list">{pending.map(request => <RequestCard key={request.id} data={data} request={request} actions={<>
            <Button variant="outline" size="sm" onClick={() => setDeclining(request)} disabled={busy}><X data-icon="inline-start" />Decline</Button>
            <Button size="sm" onClick={() => setApproving(request)} disabled={busy}><Check data-icon="inline-start" />Approve</Button>
          </>} />)}</div>
        : <EmptyState title="No ticket requests" description="When a developer asks for a ticket, it waits here for you." />}
    </Panel>

    <Panel title="More hours on tickets">
      <p className="panel-intro">Developers ask for extra hours on a ticket. Approving adds the hours to the estimate, moves the due date by them, and keeps the reason in the ticket’s history.</p>
      {extensions.length
        ? <div className="request-list">{extensions.map(request => <ExtensionCard key={request.id} data={data} request={request} onOpen={onOpen} actions={<>
            <Button variant="outline" size="sm" onClick={() => setDecliningExtension(request)} disabled={busy}><X data-icon="inline-start" />Decline</Button>
            <Button size="sm" onClick={() => setApprovingExtension(request)} disabled={busy}><Check data-icon="inline-start" />Approve</Button>
          </>} />)}</div>
        : <EmptyState title="No extensions to review" description="When a developer asks for more hours on a ticket, it waits here for you." />}
    </Panel>

    <Panel title="Finished work to approve">
      <p className="panel-intro">Approve a completed ticket to credit its hours. Verify a fixed bug to close it.</p>
      {finished.length
        ? <div className="finished-list">{finished.map(item => <FinishedRow key={item.id} data={data} item={item} onOpen={onOpen} action={<ItemActions item={item} admin onAction={onAction} busy={busy} />} />)}</div>
        : <EmptyState title="Nothing to approve" description="Completed tickets and fixed bugs appear here." />}
    </Panel>

    {reviewed.length > 0 && <Panel title="Recently reviewed requests">
      <div className="request-list request-list-compact">{reviewed.map(request => <RequestCard key={request.id} data={data} request={request} compact
        actions={request.itemId && data.items.some(i => i.id === request.itemId) ? <Button variant="ghost" size="sm" onClick={() => onOpen(request.itemId!)}>Open ticket<ArrowUpRight data-icon="inline-end" /></Button> : undefined} />)}</div>
    </Panel>}

    {approving && <ApproveRequestForm data={data} request={approving} mutate={mutate} busy={busy} onClose={() => setApproving(null)} />}
    {declining && <DeclineRequestForm data={data} request={declining} mutate={mutate} busy={busy} onClose={() => setDeclining(null)} />}
    {approvingExtension && <ApproveExtensionForm data={data} request={approvingExtension} mutate={mutate} busy={busy} onClose={() => setApprovingExtension(null)} />}
    {decliningExtension && <DeclineExtensionForm data={data} request={decliningExtension} mutate={mutate} busy={busy} onClose={() => setDecliningExtension(null)} />}
  </>;
}

function DeveloperApprovals({ data, onOpen, onRequest, mutate, busy }: ApprovalsProps) {
  const [withdrawing, setWithdrawing] = useState<string | null>(null);
  const order = { pending: 0, declined: 1, approved: 2 } as const;
  const mine = [...data.requests].sort((a, b) => order[a.status] - order[b.status] || b.createdAt.localeCompare(a.createdAt));
  // Waiting extensions first, then the latest decisions.
  const extensions = [...data.dueDateRequests].sort((a, b) => order[a.status] - order[b.status] || b.createdAt.localeCompare(a.createdAt)).slice(0, 8);
  const finished = finishedWork(data);
  return <>
    <Panel title="Your ticket requests" action={mine.length > 0 && <Button variant="link" size="sm" onClick={onRequest}><Plus data-icon="inline-start" />Request ticket</Button>}>
      {mine.length
        ? <div className="request-list">{mine.map(request => <RequestCard key={request.id} data={data} request={request} mine actions={
            request.status === 'pending'
              ? withdrawing === request.id
                ? <span className="confirm-inline"><span>Withdraw this request?</span><Button size="sm" variant="destructive" disabled={busy} onClick={async () => { if (await mutate({ action: 'withdrawTicketRequest', id: request.id }, 'Request withdrawn')) setWithdrawing(null); }}>Withdraw</Button><Button size="sm" variant="ghost" onClick={() => setWithdrawing(null)}>Keep</Button></span>
                : <Button variant="ghost" size="sm" onClick={() => setWithdrawing(request.id)}>Withdraw</Button>
              : request.status === 'approved' && request.itemId && data.items.some(i => i.id === request.itemId)
                ? <Button variant="outline" size="sm" onClick={() => onOpen(request.itemId!)}>Open ticket<ArrowUpRight data-icon="inline-end" /></Button>
                : undefined
          } />)}</div>
        : <EmptyState title="No requests yet" description="Ask for a ticket when you take on new work. Your admin checks the estimate first." action={<Button onClick={onRequest}><Plus data-icon="inline-start" />Request ticket</Button>} />}
    </Panel>

    {extensions.length > 0 && <Panel title="Your asks for more hours">
      <div className="request-list">{extensions.map(request => <ExtensionCard key={request.id} data={data} request={request} onOpen={onOpen} mine actions={request.status === 'pending'
        ? <Button variant="ghost" size="sm" disabled={busy} onClick={() => mutate({ action: 'withdrawDueDateRequest', id: request.id }, 'Extension request withdrawn')}>Withdraw</Button>
        : undefined} />)}</div>
    </Panel>}

    <Panel title="Waiting for your admin">
      <p className="panel-intro">Tickets you completed and bugs you fixed. Hours count once your admin approves.</p>
      {finished.length
        ? <div className="finished-list">{finished.map(item => <FinishedRow key={item.id} data={data} item={item} onOpen={onOpen} action={<span className="cell-muted">{item.type === 'task' ? 'Waiting for review' : 'Waiting for verification'}</span>} />)}</div>
        : <EmptyState title="Nothing waiting" description="Complete a ticket and it waits here for approval." />}
    </Panel>
  </>;
}

function RequestCard({ data, request, actions, mine = false, compact = false }: { data: DashboardData; request: TicketRequest; actions?: ReactNode; mine?: boolean; compact?: boolean }) {
  const person = findMember(data, request.requesterId);
  return <article className={`request-card request-${request.status}`}>
    <header className="request-card-head">
      {!mine && <><Avatar member={person} size="small" /><strong>{person?.name ?? 'Former team member'}</strong></>}
      <span className="request-time">Asked {displayDateTime(request.createdAt)}</span>
      {(mine || request.status !== 'pending') && <Badge variant="outline" className={`request-status request-status-${request.status}`}><i />{requestStatus[request.status]}</Badge>}
    </header>
    <h3 className="request-title">{request.title}</h3>
    <div className="request-facts">
      <ProjectTag data={data} id={request.projectId} /><PhaseTag data={data} id={request.phaseId} />
      <span><Clock3 size={13} />{hours(request.estimateHours)} h</span>
      <span><CalendarDays size={13} />{request.dueDate ? `Due ${displayDate(request.dueDate)}` : 'No due date'}</span>
      <PriorityBadge priority={request.priority} />
    </div>
    {!compact && request.description && <p className="request-description">{request.description}</p>}
    {!compact && request.note && <p className="request-note"><MessageSquareText size={14} /><span>{request.note}</span></p>}
    {request.reviewNote && <p className="request-review"><CheckCheck size={14} /><span><strong>{request.status === 'declined' ? 'Why it was declined' : 'Admin note'}:</strong> {request.reviewNote}</span></p>}
    {actions && <footer className="request-card-actions">{actions}</footer>}
  </article>;
}

function ExtensionCard({ data, request, onOpen, actions, mine = false }: { data: DashboardData; request: DueDateRequest; onOpen: (id: string) => void; actions?: ReactNode; mine?: boolean }) {
  const person = findMember(data, request.requesterId);
  const item = data.items.find(i => i.id === request.itemId);
  const project = item ? findProject(data, item.projectId) : undefined;
  // While it waits, show what approving would do now. The ticket may have changed since it was asked.
  const unchanged = item && item.dueDate === request.fromDate && item.estimateHours === request.fromEstimate;
  const preview = request.status === 'pending' && item && unchanged ? ticketExtension(data, item, request.hours) : null;
  const pastTarget = preview?.dueDate && project && !isAdhocProject(project) && project.targetDate && preview.dueDate > project.targetDate;
  const category = reasonLabel(request.reasonCategory);
  const granted = request.status === 'approved' ? request.approvedHours ?? request.hours : null;
  return <article className={`request-card request-${request.status}`}>
    <header className="request-card-head">
      {!mine && <><Avatar member={person} size="small" /><strong>{person?.name ?? 'Former team member'}</strong></>}
      <span className="request-time">Asked {displayDateTime(request.createdAt)}</span>
      {(mine || request.status !== 'pending') && <Badge variant="outline" className={`request-status request-status-${request.status}`}><i />{requestStatus[request.status]}</Badge>}
    </header>
    <Button variant="ghost" className="request-title request-title-link" disabled={!item} onClick={() => item && onOpen(item.id)}>{item ? <><span className="item-key">{item.key}</span>{item.title}</> : 'Ticket no longer visible'}</Button>
    <div className="request-facts">
      {item && <ProjectTag data={data} id={item.projectId} />}
      <Badge variant="outline" className="extension-hours">+{granted ?? request.hours} h{granted !== null && granted !== request.hours ? ` (asked ${request.hours} h)` : ''}</Badge>
      {preview
        ? <><span className="extension-dates"><Clock3 size={13} />{request.fromEstimate} h → <strong>{preview.estimate} h</strong></span>
            {request.fromDate && preview.dueDate
              ? <span className="extension-dates"><CalendarDays size={13} />Due {displayDate(request.fromDate)} → <strong>{displayDate(preview.dueDate)}</strong>{preview.dueDate !== request.fromDate && ` (+${dayCount(daysBetween(request.fromDate, preview.dueDate))})`}</span>
              : <span className="extension-dates"><CalendarDays size={13} />No due date</span>}</>
        : <span className="extension-dates"><CalendarDays size={13} />{request.fromDate ? `Was due ${displayDate(request.fromDate)}` : 'No due date'} with {request.fromEstimate} h</span>}
      {category && <Badge variant="secondary">{category}</Badge>}
    </div>
    <p className="request-note"><MessageSquareText size={14} /><span>{request.reason}</span></p>
    {pastTarget && <p className="request-warning"><AlertTriangle size={14} /><span>The new due date is after the {project!.name} target date ({displayDate(project!.targetDate)}).</span></p>}
    {request.status === 'pending' && item && !unchanged && <p className="request-warning"><AlertTriangle size={14} /><span>The ticket’s due date or estimate changed after this was asked. Decline it, and {person ? firstName(person) : 'the developer'} can ask again.</span></p>}
    {request.reviewNote && <p className="request-review"><CheckCheck size={14} /><span><strong>{request.status === 'declined' ? 'Why it was declined' : 'Admin note'}:</strong> {request.reviewNote}</span></p>}
    {actions && <footer className="request-card-actions">{actions}</footer>}
  </article>;
}

/** Approving adds the hours to the estimate and moves the due date by them. The admin may approve a different number of hours. */
function ApproveExtensionForm({ data, request, mutate, busy, onClose }: { data: DashboardData; request: DueDateRequest; mutate: MutationFn; busy: boolean; onClose: () => void }) {
  const person = findMember(data, request.requesterId);
  const item = data.items.find(i => i.id === request.itemId);
  const [hoursText, setHoursText] = useState(String(request.hours));
  const granted = Number(hoursText);
  const room = item ? MAX_TICKET_HOURS - item.estimateHours : 0;
  const valid = !!item && granted >= 0.5 && Number.isInteger(granted * 2) && granted <= room;
  const preview = item && valid ? ticketExtension(data, item, granted) : null;
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const note = String(new FormData(event.currentTarget).get('note') ?? '').trim();
    const ok = await mutate({ action: 'approveDueDateRequest', id: request.id, ...(granted !== request.hours ? { hours: granted } : {}), ...(note ? { note } : {}) },
      `Approved +${granted} h.${preview?.dueDate ? ` ${item?.key ?? 'The ticket'} is now due ${displayDate(preview.dueDate)}.` : ''}`);
    if (ok) onClose();
  }
  return <Modal title="Approve more hours" subtitle={item ? `${item.key} · ${item.title}` : undefined} onClose={onClose}>
    <form onSubmit={submit}>
      <FieldGroup className="modal-form-body">
        <div className="request-context">
          <p><strong>{person?.name ?? 'The developer'} asks for {request.hours} more {request.hours === 1 ? 'hour' : 'hours'}</strong>{reasonLabel(request.reasonCategory) ?? 'Other'}</p>
          <p><strong>Their reason</strong>{request.reason}</p>
        </div>
        <FormField>Hours to approve<Input type="number" name="hours" required min={0.5} max={room} step={0.5} value={hoursText} onChange={event => setHoursText(event.target.value)} className="extend-hours-input" />
          <span className="field-help">{preview
            ? <>Estimate <strong>{item!.estimateHours} h → {preview.estimate} h</strong>.{preview.dueDate ? <> Due <strong>{displayDate(item!.dueDate)} → {displayDate(preview.dueDate, { weekday: 'short' })}</strong>.</> : ' No due date to move.'} You can approve a different number of hours.</>
            : granted > room ? `A ticket holds up to ${MAX_TICKET_HOURS} h. Approve ${room} h at most.` : 'Enter the hours, in steps of half an hour.'}</span></FormField>
        <FormField>Note for {person ? firstName(person) : 'the developer'} <span className="optional">optional</span><Textarea name="note" rows={2} placeholder="For example, why you approved fewer hours." /></FormField>
      </FieldGroup>
      <FormFooter busy={busy} disabled={!valid} onClose={onClose} label={valid ? `Approve +${granted} h` : 'Enter the hours'} />
    </form>
  </Modal>;
}

function DeclineExtensionForm({ data, request, mutate, busy, onClose }: { data: DashboardData; request: DueDateRequest; mutate: MutationFn; busy: boolean; onClose: () => void }) {
  const person = findMember(data, request.requesterId);
  const item = data.items.find(i => i.id === request.itemId);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const reason = String(new FormData(event.currentTarget).get('reason')).trim();
    if (await mutate({ action: 'declineDueDateRequest', id: request.id, reason }, `Extension declined. ${person ? firstName(person) : 'The developer'} sees your reason.`)) onClose();
  }
  return <Modal title="Decline more hours" subtitle={item ? `${item.key} · ${item.title}` : undefined} onClose={onClose}>
    <form onSubmit={submit}>
      <FieldGroup className="modal-form-body">
        <FormField>Why are you declining it?<Textarea name="reason" required minLength={3} maxLength={2000} rows={3} placeholder="For example, the release date cannot move. Let us split the ticket instead." /><span className="field-help">The estimate and due date stay as they are. {person ? firstName(person) : 'The developer'} sees this reason.</span></FormField>
      </FieldGroup>
      <FormFooter busy={busy} onClose={onClose} label="Decline" />
    </form>
  </Modal>;
}

function FinishedRow({ data, item, onOpen, action }: { data: DashboardData; item: WorkItem; onOpen: (id: string) => void; action: ReactNode }) {
  const person = findMember(data, item.assigneeId);
  return <div className="finished-row">
    <span className={`finished-kind finished-${item.type}`} aria-hidden="true">{item.type === 'task' ? <ListTodo size={15} /> : <Bug size={15} />}</span>
    <Button variant="ghost" className="finished-main" onClick={() => onOpen(item.id)}>
      <span className="item-key">{item.key}</span><strong>{item.title}</strong>
      <span className="finished-meta">{person ? firstName(person) : 'Former member'} · {item.type === 'task' ? `${hours(item.estimateHours)} h · completed ${displayDate(item.updatedAt)}` : `fixed ${displayDate(item.fixedAt ?? item.updatedAt)}`}</span>
    </Button>
    <ProjectTag data={data} id={item.projectId} />
    <span className="finished-action">{action}</span>
  </div>;
}

/** The admin may adjust the request before it becomes a ticket. Only changed values are sent. */
function ApproveRequestForm({ data, request, mutate, busy, onClose }: { data: DashboardData; request: TicketRequest; mutate: MutationFn; busy: boolean; onClose: () => void }) {
  const person = findMember(data, request.requesterId);
  const projects = data.projects.filter(p => p.id === request.projectId || (!p.isArchived && (isAdhocProject(p) || p.memberIds.includes(request.requesterId))))
    .sort((a, b) => Number(isAdhocProject(b)) - Number(isAdhocProject(a)) || a.name.localeCompare(b.name));
  const [projectId, setProjectId] = useState(request.projectId);
  const [phaseId, setPhaseId] = useState(request.phaseId ?? '');
  const phases = projectPhases(data, projectId);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const fields = new FormData(event.currentTarget);
    const final = {
      title: String(fields.get('title')).trim(), projectId, phaseId: phaseId || null, estimateHours: Number(fields.get('estimateHours')),
      dueDate: String(fields.get('dueDate') ?? '') || null, priority: String(fields.get('priority')) as TicketRequest['priority'],
    };
    const patch = Object.fromEntries(Object.entries(final).filter(([key, value]) => request[key as keyof RequestChanges] !== value)) as RequestChanges;
    const note = String(fields.get('note') ?? '').trim();
    const ok = await mutate({ action: 'approveTicketRequest', id: request.id, ...(Object.keys(patch).length ? { patch } : {}), ...(note ? { note } : {}) },
      `Approved. ${person ? firstName(person) : 'The developer'} has a new ticket.`);
    if (ok) onClose();
  }
  return <Modal title="Approve ticket request" subtitle={`${person?.name ?? 'A developer'} asked for this ticket. Adjust anything before you approve.`} onClose={onClose}>
    <form onSubmit={submit}>
      <FieldGroup className="modal-form-body">
        <FormField>Title<Input name="title" required minLength={3} maxLength={200} defaultValue={request.title} /></FormField>
        <FieldGroup className="form-grid">
          <FormField>Project<FormSelect required value={projectId} onValueChange={value => { setProjectId(value); setPhaseId(''); }}>{projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</FormSelect></FormField>
          <FormField>Phase<FormSelect value={phaseId} disabled={!phases.length} onValueChange={setPhaseId}><option value="">Ad hoc</option>{phases.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</FormSelect></FormField>
          <EstimateField defaultValue={request.estimateHours} />
          <FormField>Due date <span className="optional">optional</span><FormDate name="dueDate" defaultValue={request.dueDate ?? undefined} min={today(data.settings.timezone)} placeholder="No due date" /></FormField>
          <FormField>Priority<FormChoice name="priority" defaultValue={request.priority} options={[{ value: 'low', label: 'Low' }, { value: 'medium', label: 'Medium' }, { value: 'high', label: 'High' }, { value: 'urgent', label: 'Urgent' }]} /></FormField>
        </FieldGroup>
        {(request.description || request.note) && <div className="request-context">
          {request.description && <p><strong>Description</strong>{request.description}</p>}
          {request.note && <p><strong>Their note</strong>{request.note}</p>}
        </div>}
        <FormField>Note for {person ? firstName(person) : 'the developer'} <span className="optional">optional</span><Textarea name="note" rows={2} placeholder="For example, why you changed the estimate." /></FormField>
      </FieldGroup>
      <FormFooter busy={busy} onClose={onClose} label="Approve and create ticket" />
    </form>
  </Modal>;
}

function DeclineRequestForm({ data, request, mutate, busy, onClose }: { data: DashboardData; request: TicketRequest; mutate: MutationFn; busy: boolean; onClose: () => void }) {
  const person = findMember(data, request.requesterId);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const reason = String(new FormData(event.currentTarget).get('reason')).trim();
    if (await mutate({ action: 'declineTicketRequest', id: request.id, reason }, `Request declined. ${person ? firstName(person) : 'The developer'} sees your reason.`)) onClose();
  }
  return <Modal title="Decline ticket request" subtitle={`“${request.title}” from ${person?.name ?? 'a developer'}`} onClose={onClose}>
    <form onSubmit={submit}>
      <FieldGroup className="modal-form-body">
        <FormField>Why are you declining it?<Textarea name="reason" required minLength={3} maxLength={2000} rows={3} placeholder="For example, split it into smaller tickets, or it is not planned yet." /><span className="field-help">{person ? firstName(person) : 'The developer'} sees this reason.</span></FormField>
      </FieldGroup>
      <FormFooter busy={busy} onClose={onClose} label="Decline request" />
    </form>
  </Modal>;
}
