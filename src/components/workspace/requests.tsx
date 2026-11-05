"use client";

import { Fragment, useMemo, useState, type CSSProperties, type FormEvent, type ReactNode } from 'react';
import Link from 'next/link';
import clsx from 'clsx';
import { useSearchParams } from 'next/navigation';
import { ArrowUpRight, Briefcase, Bug, CalendarDays, ChartColumn, Check, CheckCheck, CircleHelp, Clock3, Hourglass, Inbox, KeyRound, ListTodo, MessageSquareText, Pencil, PencilLine, Plus, Search, Sparkles, TriangleAlert, X } from 'lucide-react';
import type { DashboardData, Member, RequestCategory, TechRequest, WorkItem } from '@/lib/types';
import { ADHOC_PROJECT_ID } from '@/lib/project-defaults';
import { addWorkingHours, dateKey, getWorkCalendar } from '@/lib/kpi';
import { daysBetween } from '@/lib/timeline';
import { Avatar, EmptyState, FormDate, FormField, FormSelect, Modal, Panel, PriorityBadge } from '@/components/ui';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { FieldGroup } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/components/ui/input-group';
import { Textarea } from '@/components/ui/textarea';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { activeDepartments, categoryLabel, displayDate, displayDateTime, findDepartment, findMember, firstName, priorities, requestCategories, requestStage, requestWork, routeFor, stageLabels, today, type MutationFn, type RequestStage, type TechRequestInput, type WorkClassification } from './lib';
import { ClassificationFields, EstimateField, FormChoice, FormFooter } from './forms';
import { plural } from './timeline';

const PRIORITY_OPTIONS = [{ value: 'low', label: 'Low' }, { value: 'medium', label: 'Medium' }, { value: 'high', label: 'High' }, { value: 'urgent', label: 'Urgent' }];
const categoryIcons: Record<RequestCategory, ReactNode> = {
  feature: <Sparkles aria-hidden="true" />, change: <PencilLine aria-hidden="true" />, problem: <TriangleAlert aria-hidden="true" />,
  data: <ChartColumn aria-hidden="true" />, access: <KeyRound aria-hidden="true" />, other: <CircleHelp aria-hidden="true" />,
};
const OPEN_STAGES: RequestStage[] = ['waiting', 'assigned', 'in_progress', 'checking'];

/**
 * The same team always gets the same colour, so a long list is easy to scan. Teams are numbered in the order they
 * were added, and each step of the golden angle lands far from the hues before it.
 */
function teamHue(data: DashboardData, id: string) {
  return Math.round(((findDepartment(data, id)?.position ?? 0) * 137.508 + 20) % 360);
}
/** A team's colour dot and name. Without `name`, only the dot shows, for rows that already show the name. */
export function TeamTag({ data, id, name = true }: { data: DashboardData; id: string; name?: boolean }) {
  const team = findDepartment(data, id);
  return <span className="team-tag" style={{ '--team-hue': teamHue(data, id) } as CSSProperties}><i aria-hidden="true" />{name && (team?.name ?? 'Former team')}</span>;
}
export function StageBadge({ stage }: { stage: RequestStage }) {
  return <Badge variant="outline" className={clsx('stage-badge', `stage-${stage}`)}><i aria-hidden="true" />{stageLabels[stage]}</Badge>;
}
/** A requester appears with their avatar even when this person sees no one else's profile. */
function requesterOf(data: DashboardData, request: TechRequest): Member {
  return findMember(data, request.requesterId) ?? { id: request.requesterId, name: request.requesterName, email: '', role: 'requester', image: null, capacity: 0, isActive: true };
}
/** "today at 11:15", "yesterday", "3 days ago", then the date. */
function raised(data: DashboardData, iso: string) {
  const timezone = data.settings.timezone;
  const days = daysBetween(dateKey(iso, timezone), today(timezone));
  const time = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: timezone }).format(new Date(iso));
  return days <= 0 ? `today at ${time}` : days === 1 ? 'yesterday' : days < 7 ? `${days} days ago` : displayDate(iso);
}

/** Text with its web links made clickable. Requests often point to a sheet, a design, or an example page. */
function LinkedText({ text }: { text: string }) {
  const parts = text.split(/(https?:\/\/[^\s<>"']+)/g);
  return <>{parts.map((part, index) => index % 2 === 1
    ? <a key={index} href={part.replace(/[.,;:!?)]+$/, '')} target="_blank" rel="noopener noreferrer">{part}</a>
    : <Fragment key={index}>{part}</Fragment>)}</>;
}
function RequestDetails({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  const long = text.length > 240 || text.split('\n').length > 4;
  return <div className="tech-request-details">
    <p className={clsx('request-description', long && !open && 'is-clamped')}><LinkedText text={text} /></p>
    {long && <Button variant="link" size="sm" className="details-toggle" onClick={() => setOpen(!open)} aria-expanded={open}>{open ? 'Show less' : 'Show more'}</Button>}
  </div>;
}

/** Raised, assigned, in progress, done. Each step says who does what next, in plain words. */
function RequestProgress({ data, request }: { data: DashboardData; request: TechRequest }) {
  const stage = requestStage(data, request);
  const work = requestWork(data, request);
  const step = stage === 'waiting' ? 0 : stage === 'assigned' ? 1 : stage === 'done' ? 3 : 2;
  const who = work ? work.assigneeName.split(' ')[0] : 'A developer';
  const planned = work?.type === 'task' && work.dueDate && stage !== 'done' ? ` It is planned for ${displayDate(work.dueDate, { weekday: 'short' })}.` : '';
  const line = stage === 'waiting' ? 'Waiting for the tech lead to review it.'
    : stage === 'assigned' ? `${who} will work on it.${planned}`
    : stage === 'in_progress' ? `${who} is working on it.${planned}`
    : stage === 'checking' ? `${who} finished it. The tech lead is checking it.`
    : `Done${work?.doneAt ? ` on ${displayDate(work.doneAt, { weekday: 'short' })}` : ''}.`;
  return <div className="request-progress">
    <ol className="request-steps" aria-label={`Progress: ${stageLabels[stage]}`}>
      {['Raised', 'Assigned', 'In progress', 'Done'].map((label, index) => <li key={label} className={clsx(index < step && 'is-done', index === step && 'is-current', index === 3 && step === 3 && 'is-done')}>
        <span aria-hidden="true">{index < step || step === 3 ? <Check /> : null}</span><em>{label}</em>
      </li>)}
    </ol>
    <p className="request-progress-line">{line}</p>
  </div>;
}

type CardProps = { data: DashboardData; request: TechRequest; showRequester: boolean; actions?: ReactNode; children?: ReactNode };
function TechRequestCard({ data, request, showRequester, actions, children }: CardProps) {
  const stage = requestStage(data, request);
  const day = today(data.settings.timezone);
  const late = !!request.neededBy && request.neededBy < day && stage !== 'done' && stage !== 'declined';
  const soon = !!request.neededBy && !late && daysBetween(day, request.neededBy) <= 2 && stage === 'waiting';
  return <article className={clsx('request-card', 'tech-request-card', `tech-request-${stage}`)}>
    <header className="request-card-head">
      <span className="item-key">{request.key}</span>
      <TeamTag data={data} id={request.departmentId} />
      <StageBadge stage={stage} />
    </header>
    <h3 className="request-title">{request.title}</h3>
    <div className="request-facts">
      <span className="request-category">{categoryIcons[request.category]}{categoryLabel(request.category)}</span>
      <PriorityBadge priority={request.priority} />
      {request.neededBy && <span className={clsx((late || soon) && 'due-overdue')}><CalendarDays />Needed by {displayDate(request.neededBy, { weekday: 'short' })}</span>}
    </div>
    <RequestDetails text={request.description} />
    <p className="request-raised">{showRequester && <><Avatar member={requesterOf(data, request)} size="small" /><strong>{request.requesterName}</strong></>}<span>Raised {raised(data, request.createdAt)}</span></p>
    {children}
    {request.reviewNote && <p className="request-review"><MessageSquareText size={14} /><span><strong>{stage === 'declined' ? 'Why it was declined' : 'Note from the tech team'}:</strong> {request.reviewNote}</span></p>}
    {actions && <footer className="request-card-actions">{actions}</footer>}
  </article>;
}

/** First visit: what a request is for, and what happens after it is sent. */
function HowRequestsWork({ onRaise }: { onRaise: () => void }) {
  return <Panel className="how-requests">
    <div className="how-requests-body">
      <div className="how-requests-intro">
        <h2>Need something from the tech team?</h2>
        <p>Raise a request for a new feature, a change, something broken, a report, or access to a tool.</p>
      </div>
      <ol className="how-requests-steps">
        <li><span>1</span><div><strong>Raise a request</strong><p>Say what you need and why. Add links if they help.</p></div></li>
        <li><span>2</span><div><strong>The tech lead reviews it</strong><p>They assign it to a developer, or reply with a reason.</p></div></li>
        <li><span>3</span><div><strong>Follow it here</strong><p>See who works on it, and when it is done.</p></div></li>
      </ol>
      <Button size="lg" onClick={onRaise}><Plus data-icon="inline-start" />Raise a request</Button>
    </div>
  </Panel>;
}

type MyRequestsProps = { data: DashboardData; onRaise: () => void; onEdit: (request: TechRequest) => void; mutate: MutationFn; busy: boolean };

/** A requester's home: their requests, and their team's, with where each one is. */
export function MyRequests({ data, onRaise, onEdit, mutate, busy }: MyRequestsProps) {
  const me = data.currentUser;
  const team = findDepartment(data, me.departmentId);
  const [view, setView] = useState<'mine' | 'team'>('mine');
  const [withdrawing, setWithdrawing] = useState<string | null>(null);
  const mine = data.techRequests.filter(r => r.requesterId === me.id);
  const teamRequests = team ? data.techRequests.filter(r => r.departmentId === team.id) : [];
  const shown = view === 'team' && team ? teamRequests : mine;
  const stageOf = (request: TechRequest) => requestStage(data, request);
  const open = shown.filter(r => OPEN_STAGES.includes(stageOf(r))).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const closed = shown.filter(r => !OPEN_STAGES.includes(stageOf(r))).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const count = (stages: RequestStage[]) => mine.filter(r => stages.includes(stageOf(r))).length;

  const card = (request: TechRequest) => {
    const own = request.requesterId === me.id;
    const editable = own && request.status === 'new';
    const stage = stageOf(request);
    return <TechRequestCard key={request.id} data={data} request={request} showRequester={!own}
      actions={editable ? withdrawing === request.id
        ? <span className="confirm-inline"><span>Withdraw this request?</span><Button size="sm" variant="destructive" disabled={busy} onClick={async () => { if (await mutate({ action: 'withdrawTechRequest', id: request.id }, 'Request withdrawn')) setWithdrawing(null); }}>Withdraw</Button><Button size="sm" variant="ghost" onClick={() => setWithdrawing(null)}>Keep</Button></span>
        : <><Button variant="ghost" size="sm" onClick={() => setWithdrawing(request.id)}>Withdraw</Button><Button variant="outline" size="sm" onClick={() => onEdit(request)}><Pencil data-icon="inline-start" />Edit</Button></>
        : undefined}>
      {stage !== 'declined' && <RequestProgress data={data} request={request} />}
    </TechRequestCard>;
  };

  return <>
    {mine.length === 0 && <HowRequestsWork onRaise={onRaise} />}
    {mine.length > 0 && <div className="team-overview-strip request-strip">
      <div><span className="mini-metric-icon"><Hourglass /></span><strong>{count(['waiting'])}</strong><span>waiting for review</span></div>
      <div><span className="mini-metric-icon"><Clock3 /></span><strong>{count(['assigned', 'in_progress', 'checking'])}</strong><span>with a developer</span></div>
      <div><span className="mini-metric-icon"><CheckCheck /></span><strong>{count(['done'])}</strong><span>done</span></div>
    </div>}
    {(mine.length > 0 || teamRequests.length > 0) && <>
      {team && <ToggleGroup type="single" variant="outline" size="sm" value={view} onValueChange={value => { if (value) setView(value as 'mine' | 'team'); }} className="request-view-toggle" aria-label="Whose requests to show">
        <ToggleGroupItem value="mine">My requests<span className="tab-count">{mine.length}</span></ToggleGroupItem>
        <ToggleGroupItem value="team">{team.name} team<span className="tab-count">{teamRequests.length}</span></ToggleGroupItem>
      </ToggleGroup>}
      <Panel title="Open" count={open.length}>
        {open.length
          ? <div className="request-list">{open.map(card)}</div>
          : <EmptyState compact title="Nothing open" description={view === 'team' ? 'Your team has no open requests.' : 'Every request you raised is done or closed.'} action={<Button variant="outline" onClick={onRaise}><Plus data-icon="inline-start" />Raise a request</Button>} />}
      </Panel>
      {closed.length > 0 && <Panel title="Done and declined" count={closed.length}>
        <div className="request-list">{closed.map(card)}</div>
      </Panel>}
    </>}
  </>;
}

type InboxTab = 'new' | 'active' | 'done' | 'declined' | 'all';
const INBOX_TABS: { id: InboxTab; label: string; stages: RequestStage[] }[] = [
  { id: 'new', label: 'New', stages: ['waiting'] },
  { id: 'active', label: 'In progress', stages: ['assigned', 'in_progress', 'checking'] },
  { id: 'done', label: 'Done', stages: ['done'] },
  { id: 'declined', label: 'Declined', stages: ['declined'] },
  { id: 'all', label: 'All', stages: ['waiting', 'assigned', 'in_progress', 'checking', 'done', 'declined'] },
];
type InboxProps = { data: DashboardData; onOpenItem: (id: string) => void; mutate: MutationFn; busy: boolean };

/** The admin's inbox for other teams. New requests come first: the most urgent, then the soonest needed, then the oldest. */
export function RequestInbox({ data, onOpenItem, mutate, busy }: InboxProps) {
  const query = useSearchParams();
  const [tab, setTab] = useState<InboxTab>(() => INBOX_TABS.find(t => t.id === query.get('status'))?.id ?? (query.get('q') ? 'all' : 'new'));
  const [teamId, setTeamId] = useState(query.get('team') ?? 'all');
  const [search, setSearch] = useState(query.get('q') ?? '');
  const [assigning, setAssigning] = useState<TechRequest | null>(null);
  const [declining, setDeclining] = useState<TechRequest | null>(null);
  const stages = useMemo(() => new Map(data.techRequests.map(r => [r.id, requestStage(data, r)])), [data]);
  const stageOf = (request: TechRequest) => stages.get(request.id) ?? 'waiting';
  const needle = search.trim().toLowerCase();
  const base = data.techRequests.filter(r => (teamId === 'all' || r.departmentId === teamId)
    && (!needle || `${r.key} ${r.title} ${r.description} ${r.requesterName}`.toLowerCase().includes(needle)));
  const inTab = (request: TechRequest, id: InboxTab) => INBOX_TABS.find(t => t.id === id)!.stages.includes(stageOf(request));
  const urgency = (request: TechRequest) => priorities.indexOf(request.priority);
  const shown = base.filter(r => inTab(r, tab)).sort((a, b) => tab === 'new'
    ? urgency(b) - urgency(a) || (a.neededBy ?? '9999').localeCompare(b.neededBy ?? '9999') || a.createdAt.localeCompare(b.createdAt)
    : (b.reviewedAt ?? b.createdAt).localeCompare(a.reviewedAt ?? a.createdAt));
  const waiting = data.techRequests.filter(r => stageOf(r) === 'waiting');
  const oldest = [...waiting].sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0];
  const oldestDays = oldest ? daysBetween(dateKey(oldest.createdAt, data.settings.timezone), today(data.settings.timezone)) : 0;
  const teams = data.departments.filter(d => !d.isArchived || data.techRequests.some(r => r.departmentId === d.id));
  const filtering = teamId !== 'all' || !!needle;

  const workLine = (request: TechRequest) => {
    const work = requestWork(data, request);
    if (!work) return null;
    const owner = findMember(data, work.assigneeId);
    return <div className="request-work">
      <span className="request-work-kind" aria-hidden="true">{work.type === 'task' ? <ListTodo /> : <Bug />}</span>
      <span className="item-key">{work.key}</span>
      <span className="request-work-owner"><Avatar member={owner} size="small" />{owner?.name ?? work.assigneeName}</span>
      {work.type === 'task' && work.dueDate && stageOf(request) !== 'done' && <span className="request-work-date"><CalendarDays />{displayDate(work.dueDate)}</span>}
      {request.itemId && data.items.some(i => i.id === request.itemId) && <Button variant="ghost" size="sm" className="request-work-open" onClick={() => onOpenItem(request.itemId!)}>Open {work.type === 'task' ? 'ticket' : 'bug'}<ArrowUpRight data-icon="inline-end" /></Button>}
    </div>;
  };

  return <>
    <div className="team-overview-strip approvals-strip">
      <div><span className="mini-metric-icon"><Inbox /></span><strong>{waiting.length}</strong><span>new {waiting.length === 1 ? 'request waits' : 'requests wait'} for you</span></div>
      <div><span className="mini-metric-icon"><Clock3 /></span><strong>{data.techRequests.filter(r => inTab(r, 'active')).length}</strong><span>with a developer</span></div>
      <div><span className="mini-metric-icon"><CheckCheck /></span><strong>{data.techRequests.filter(r => stageOf(r) === 'done').length}</strong><span>done</span></div>
      <div><span className="mini-metric-icon"><Hourglass /></span><strong>{oldest ? oldestDays <= 0 ? 'Today' : plural(oldestDays, 'day') : '—'}</strong><span>{oldest ? 'oldest new request has waited' : 'no request is waiting'}</span></div>
    </div>
    <Card className="work-list-panel">
      <div className="work-list-tabs">
        <ToggleGroup type="single" value={tab} onValueChange={value => { if (value) setTab(value as InboxTab); }} className="status-tabs" aria-label="Filter by stage">
          {INBOX_TABS.map(t => <ToggleGroupItem key={t.id} value={t.id}>{t.label}<span className="tab-count">{base.filter(r => inTab(r, t.id)).length}</span></ToggleGroupItem>)}
        </ToggleGroup>
      </div>
      <div className="list-toolbar">
        <InputGroup className="search-control">
          <InputGroupAddon><Search /></InputGroupAddon>
          <InputGroupInput data-page-search aria-label="Search requests" placeholder="Search by title, key, or person…" value={search} onChange={event => setSearch(event.target.value)} onKeyDown={event => { if (event.key === 'Escape' && search) { event.stopPropagation(); setSearch(''); } }} />
          {search && <InputGroupAddon align="inline-end"><Button variant="ghost" size="icon-xs" aria-label="Clear search" onClick={() => setSearch('')}><X /></Button></InputGroupAddon>}
        </InputGroup>
        <div className="filter-controls">
          <FormSelect aria-label="Filter by team" value={teamId} onValueChange={setTeamId}><option value="all">All teams</option>{teams.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}</FormSelect>
          {filtering && <Button variant="ghost" size="sm" onClick={() => { setTeamId('all'); setSearch(''); }}>Clear filters</Button>}
        </div>
      </div>
      {shown.length
        ? <div className="request-list inbox-list">{shown.map(request => {
            const stage = stageOf(request);
            return <TechRequestCard key={request.id} data={data} request={request} showRequester
              actions={stage === 'waiting' ? <>
                <Button variant="outline" size="sm" disabled={busy} onClick={() => setDeclining(request)}><X data-icon="inline-start" />Decline</Button>
                <Button size="sm" disabled={busy} onClick={() => setAssigning(request)}><Check data-icon="inline-start" />Assign</Button>
              </> : undefined}>
              {stage !== 'waiting' && stage !== 'declined' && workLine(request)}
            </TechRequestCard>;
          })}</div>
        : <EmptyState title={filtering ? 'No matches' : tab === 'new' ? 'No new requests' : 'Nothing here yet'}
            description={filtering ? 'Try another search or team.' : tab === 'new' ? 'When someone from Sales, E-commerce, or another team raises a request, it lands here.' : 'Requests move here as the team works on them.'} />}
    </Card>
    <p className="inbox-footnote"><Briefcase size={13} aria-hidden="true" />Create teams, add their members, and choose who can sign in on <Link href={routeFor(data, 'other-teams')}>Other teams</Link>.</p>
    {assigning && <AssignRequestForm data={data} request={assigning} mutate={mutate} busy={busy} onClose={() => setAssigning(null)} />}
    {declining && <DeclineTechRequestForm data={data} request={declining} mutate={mutate} busy={busy} onClose={() => setDeclining(null)} />}
  </>;
}

/** Assigning makes a ticket or a bug for a developer. A ticket needs an estimate; a broken thing is usually a bug with a fix-by time. */
function AssignRequestForm({ data, request, mutate, busy, onClose }: { data: DashboardData; request: TechRequest; mutate: MutationFn; busy: boolean; onClose: () => void }) {
  const [type, setType] = useState<WorkItem['type']>(request.category === 'problem' ? 'bug' : 'task');
  const [classification, setClassification] = useState<WorkClassification>({ projectId: ADHOC_PROJECT_ID, phaseId: null, assigneeId: '' });
  const [severity, setSeverity] = useState<WorkItem['severity']>(request.priority === 'urgent' ? 'critical' : 'normal');
  const day = today(data.settings.timezone);
  const owner = findMember(data, classification.assigneeId);
  const requester = request.requesterName.split(' ')[0];
  const team = findDepartment(data, request.departmentId)?.name ?? 'their team';
  const target = severity === 'critical' ? data.settings.criticalTargetHours : data.settings.normalTargetHours;
  const fixBy = type === 'bug' ? addWorkingHours(new Date(), target, getWorkCalendar(data, classification.assigneeId || undefined)) : null;
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const fields = new FormData(event.currentTarget);
    const note = String(fields.get('note') ?? '').trim();
    const ok = await mutate({
      action: 'assignTechRequest', id: request.id, type, title: String(fields.get('title')).trim(), ...classification,
      priority: String(fields.get('priority')) as WorkItem['priority'],
      ...(type === 'task' ? { estimateHours: Number(fields.get('estimateHours')), dueDate: String(fields.get('dueDate')) || null } : { severity }),
      ...(note ? { note } : {}),
    }, `Assigned to ${owner ? firstName(owner) : 'the developer'}. ${requester} can follow it now.`);
    if (ok) onClose();
  }
  return <Modal title="Assign request" subtitle={`${request.key} · from ${request.requesterName}, ${team}`} onClose={onClose}>
    <form onSubmit={submit} className="item-form">
      <FieldGroup className="modal-form-body">
        <div className="request-context">
          <p><strong>{categoryLabel(request.category)}</strong><LinkedText text={request.description} /></p>
          {request.neededBy && <p><strong>Needed by</strong>{displayDate(request.neededBy, { weekday: 'short', year: 'numeric' })}</p>}
        </div>
        <FormField>Create as<FormChoice value={type} onValueChange={value => setType(value as WorkItem['type'])} options={[{ value: 'task', label: 'Ticket' }, { value: 'bug', label: 'Bug' }]} />
          <span className="field-help">{type === 'task' ? 'A ticket has an estimate. Its hours count when you approve it.' : 'A bug has a fix-by time from its severity. It earns bug points.'}</span></FormField>
        <FormField>Title<Input name="title" required minLength={3} maxLength={200} defaultValue={request.title} /></FormField>
        <ClassificationFields data={data} value={classification} onChange={setClassification} />
        <FieldGroup className="form-grid">
          {type === 'task'
            ? <><EstimateField defaultValue={4} />
                <FormField>Date<FormDate key="dueDate" name="dueDate" required defaultValue={request.neededBy && request.neededBy >= day ? request.neededBy : day} /><span className="field-help">{request.neededBy ? `${requester} needs it by ${displayDate(request.neededBy)}.` : 'The day this work is for.'}</span></FormField></>
            : <><FormField>Severity<FormChoice value={severity} onValueChange={value => setSeverity(value as WorkItem['severity'])} options={[{ value: 'normal', label: 'Normal' }, { value: 'critical', label: 'Critical' }]} /><span className="field-help">Target: {target} working hours.</span></FormField>
                <Alert className="bug-report-note"><Clock3 /><AlertTitle>Fix by {fixBy ? displayDateTime(fixBy) : '—'}</AlertTitle><AlertDescription>The clock starts when you assign it.</AlertDescription></Alert></>}
          <FormField>Priority<FormChoice name="priority" defaultValue={request.priority} options={PRIORITY_OPTIONS} /></FormField>
        </FieldGroup>
        <FormField>Note for {requester} <span className="optional">optional</span><Textarea name="note" rows={2} maxLength={2000} placeholder="For example, when to expect it, or what you need from them." /></FormField>
      </FieldGroup>
      <FormFooter busy={busy} disabled={!classification.assigneeId} onClose={onClose} label={owner ? `Assign to ${firstName(owner)}` : 'Choose an owner'} />
    </form>
  </Modal>;
}

function DeclineTechRequestForm({ data, request, mutate, busy, onClose }: { data: DashboardData; request: TechRequest; mutate: MutationFn; busy: boolean; onClose: () => void }) {
  const requester = request.requesterName.split(' ')[0];
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const reason = String(new FormData(event.currentTarget).get('reason')).trim();
    if (await mutate({ action: 'declineTechRequest', id: request.id, reason }, `Request declined. ${requester} sees your reason.`)) onClose();
  }
  return <Modal title="Decline request" subtitle={`${request.key} · “${request.title}” from ${request.requesterName}, ${findDepartment(data, request.departmentId)?.name ?? 'their team'}`} onClose={onClose}>
    <form onSubmit={submit}>
      <FieldGroup className="modal-form-body">
        <FormField>Why are you declining it?<Textarea name="reason" required minLength={3} maxLength={2000} rows={3} placeholder="For example, this already exists, here is how to use it. Or, it is not planned this quarter." /><span className="field-help">{requester} sees this reason. Say what they can do instead, if anything.</span></FormField>
      </FieldGroup>
      <FormFooter busy={busy} onClose={onClose} label="Decline request" />
    </form>
  </Modal>;
}

/** A requester raises a request, or changes it until the tech team reviews it. Only changed values are sent. */
export function TechRequestForm({ data, editing, mutate, onClose, busy }: { data: DashboardData; editing?: TechRequest; mutate: MutationFn; onClose: () => void; busy: boolean }) {
  const teams = activeDepartments(data);
  const ownTeam = teams.find(t => t.id === data.currentUser.departmentId)?.id;
  const [category, setCategory] = useState<RequestCategory>(editing?.category ?? 'feature');
  const [departmentId, setDepartmentId] = useState(editing?.departmentId ?? ownTeam ?? '');
  const [neededBy, setNeededBy] = useState(editing?.neededBy ?? '');
  const day = today(data.settings.timezone);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const fields = new FormData(event.currentTarget);
    const values: TechRequestInput = {
      title: String(fields.get('title')).trim(), description: String(fields.get('description')).trim(), category,
      priority: String(fields.get('priority')) as TechRequest['priority'], neededBy: neededBy || null, departmentId,
    };
    if (!editing) {
      if (await mutate({ action: 'createTechRequest', ...values }, 'Request sent. You can follow it here.')) onClose();
      return;
    }
    const patch = Object.fromEntries(Object.entries(values).filter(([key, value]) => editing[key as keyof TechRequestInput] !== value)) as Partial<TechRequestInput>;
    if (!Object.keys(patch).length) { onClose(); return; }
    if (await mutate({ action: 'updateTechRequest', id: editing.id, patch }, 'Request updated')) onClose();
  }
  return <Modal title={editing ? 'Edit request' : 'Raise a request'} subtitle={editing ? `${editing.key} · You can change it until the tech team reviews it.` : 'Tell the tech team what your team needs. The tech lead assigns it to a developer, and you follow it here.'} onClose={onClose}>
    <form onSubmit={submit} className="item-form">
      <FieldGroup className="modal-form-body">
        <FormField className="title-label">What do you need?<Input className="task-title-input" name="title" required minLength={3} maxLength={200} defaultValue={editing?.title} placeholder="e.g. Add a size chart to product pages" autoComplete="off" /></FormField>
        <FormField>What kind of request is it?
          <ToggleGroup type="single" variant="outline" value={category} onValueChange={value => { if (value) setCategory(value as RequestCategory); }} className="category-choice" aria-label="Kind of request">
            {requestCategories.map(c => <ToggleGroupItem key={c.value} value={c.value}>{categoryIcons[c.value]}{c.label}</ToggleGroupItem>)}
          </ToggleGroup>
          <span className="field-help">{requestCategories.find(c => c.value === category)?.hint}</span></FormField>
        <FormField>Details<Textarea name="description" required minLength={10} maxLength={20000} rows={5} defaultValue={editing?.description} placeholder={category === 'problem' ? 'What went wrong, where, and since when? Add the page link and a screenshot link if you have one.' : 'What should happen, and why does your team need it? Add links to examples, sheets, or designs.'} /></FormField>
        <FieldGroup className="form-grid">
          <FormField>Team<FormSelect required value={departmentId} onValueChange={setDepartmentId}><option value="" disabled>Choose your team</option>{teams.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}</FormSelect>
            {!ownTeam && !editing && <span className="field-help">We remember it for next time.</span>}</FormField>
          <FormField>Needed by <span className="optional">optional</span><FormDate value={neededBy} min={day} onValueChange={setNeededBy} placeholder="No date" /></FormField>
        </FieldGroup>
        <FormField>How urgent is it?<FormChoice name="priority" defaultValue={editing?.priority ?? 'medium'} options={PRIORITY_OPTIONS} /><span className="field-help">Choose Urgent only when work is stopped today.</span></FormField>
      </FieldGroup>
      <FormFooter busy={busy} disabled={!departmentId} onClose={onClose} label={editing ? 'Save changes' : 'Send request'} />
    </form>
  </Modal>;
}
