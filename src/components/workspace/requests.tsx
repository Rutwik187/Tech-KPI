"use client";

import { Fragment, useMemo, useState, type CSSProperties, type FormEvent, type ReactNode } from 'react';
import Link from 'next/link';
import clsx from 'clsx';
import { toast } from 'sonner';
import { useSearchParams } from 'next/navigation';
import { ArrowUpRight, Briefcase, Bug, CalendarDays, ChartColumn, Check, CheckCheck, CircleHelp, Clock3, Forward, Hourglass, Inbox, KeyRound, Link2, ListChecks, ListTodo, Lock, MessageSquareText, Paperclip, Pencil, PencilLine, Plus, Search, Send, Sparkles, Trash2, TriangleAlert, Undo2, Wrench, X } from 'lucide-react';
import type { DashboardData, Member, RequestCategory, RequestComment, RequestEvent, RequestPlan, TechRequest, WorkItem } from '@/lib/types';
import { isOrgAdmin, leadsWork } from '@/lib/permissions';
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
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { activeDepartments, requesterCategories, categoryLabel, displayDate, displayDateTime, findDepartment, findMember, firstName, OPEN_STAGES, priorities, REQUEST_PARAM, requestCategories, requestPermissions, requestStage, requestWork, roleNames, routeFor, stageLabels, today, type MutationFn, type RequestActionKind, type RequestStage, type TechRequestInput, type WorkClassification } from './lib';
import { ClassificationFields, EstimateField, FormChoice, FormFooter } from './forms';
import { AttachmentPanel, FilePicker, uploadFiles } from './attachments';
import { PlanSection, PlanView } from './plan';
import { plural } from './timeline';

const PRIORITY_OPTIONS = [{ value: 'low', label: 'Low' }, { value: 'medium', label: 'Medium' }, { value: 'high', label: 'High' }, { value: 'urgent', label: 'Urgent' }];
const categoryIcons: Record<RequestCategory, ReactNode> = {
  tool: <Wrench aria-hidden="true" />, feature: <Sparkles aria-hidden="true" />, change: <PencilLine aria-hidden="true" />, problem: <TriangleAlert aria-hidden="true" />,
  data: <ChartColumn aria-hidden="true" />, access: <KeyRound aria-hidden="true" />, other: <CircleHelp aria-hidden="true" />,
};

/** Opens a request's details by putting its key in the address, so the link can be shared and survives a reload. */
export type OpenRequest = (request: TechRequest | null) => void;
/** Starts one of a request's forms: forward, assign, decline, send back, or edit. */
export type ActOnRequest = (kind: RequestActionKind, request: TechRequest) => void;

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
/** Someone named on a request appears with their avatar, even when this person sees no one else's profile. */
function personOf(data: DashboardData, id: string, name: string, role: Member['role'] = 'requester'): Member {
  return findMember(data, id) ?? { id, name, email: '', role, image: null, capacity: 0, isActive: true };
}
function requesterOf(data: DashboardData, request: TechRequest): Member {
  return personOf(data, request.requesterId, request.requesterName);
}
/** "today at 11:15", "yesterday", "3 days ago", then the date. */
function when(data: DashboardData, iso: string) {
  const timezone = data.settings.timezone;
  const days = daysBetween(dateKey(iso, timezone), today(timezone));
  const time = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: timezone }).format(new Date(iso));
  return days <= 0 ? `today at ${time}` : days === 1 ? `yesterday at ${time}` : days < 7 ? `${days} days ago` : displayDate(iso);
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

const STEPS = ['Raised', 'Project manager', 'Tech lead', 'In progress', 'Done'];
/** Raised, project manager, tech lead, in progress, done. Each step says who does what next, in plain words. */
function RequestProgress({ data, request }: { data: DashboardData; request: TechRequest }) {
  const stage = requestStage(data, request);
  const work = requestWork(data, request);
  // With no project manager, a request goes from raised straight to the tech lead, so that step is left out.
  const steps = data.noProjectManager ? STEPS.filter(label => label !== 'Project manager') : STEPS;
  const step = (stage === 'with_pm' ? 1 : stage === 'with_lead' ? 2 : stage === 'done' ? 4 : 3) - (data.noProjectManager && stage !== 'with_pm' ? 1 : 0);
  const last = steps.length - 1;
  const who = work ? work.assigneeName.split(' ')[0] : 'A developer';
  const planned = work?.type === 'task' && work.dueDate && stage !== 'done' ? ` It is planned for ${displayDate(work.dueDate, { weekday: 'short' })}.` : '';
  const line = stage === 'with_pm' ? `A project manager is reviewing it.${data.currentUser.role === 'requester' ? ' They may ask you a question in the comments.' : ''}`
    : stage === 'with_lead' ? 'The tech lead is choosing who works on it.'
    : stage === 'assigned' ? `${who} will work on it.${planned}`
    : stage === 'in_progress' ? `${who} is working on it.${planned}`
    : stage === 'checking' ? `${who} finished it. The tech lead is checking it.`
    : `Done${work?.doneAt ? ` on ${displayDate(work.doneAt, { weekday: 'short' })}` : ''}.`;
  return <div className="request-progress">
    <ol className="request-steps" aria-label={`Progress: ${stageLabels[stage]}`}>
      {steps.map((label, index) => <li key={label} className={clsx(index < step && 'is-done', index === step && 'is-current', step === last && 'is-done')}>
        <span aria-hidden="true">{index < step || step === last ? <Check /> : null}</span><em>{label}</em>
      </li>)}
    </ol>
    <p className="request-progress-line">{line}</p>
  </div>;
}

/** The ticket or bug a request became: its key, owner, and date. The tech lead and its developer can open it. */
function WorkLine({ data, request, onOpenItem }: { data: DashboardData; request: TechRequest; onOpenItem?: (id: string) => void }) {
  const work = requestWork(data, request);
  if (!work) return null;
  const owner = personOf(data, work.assigneeId, work.assigneeName, 'developer');
  const stage = requestStage(data, request);
  return <div className="request-work">
    <span className="request-work-kind" aria-hidden="true">{work.type === 'task' ? <ListTodo /> : <Bug />}</span>
    <span className="item-key">{work.key}</span>
    <span className="request-work-owner"><Avatar member={owner} size="small" />{owner.name}</span>
    {work.type === 'task' && work.dueDate && stage !== 'done' && <span className="request-work-date"><CalendarDays />{displayDate(work.dueDate)}</span>}
    {onOpenItem && request.itemId && data.items.some(i => i.id === request.itemId) && <Button variant="ghost" size="sm" className="request-work-open" onClick={() => onOpenItem(request.itemId!)}>Open {work.type === 'task' ? 'ticket' : 'bug'}<ArrowUpRight data-icon="inline-end" /></Button>}
  </div>;
}

type CardProps = { data: DashboardData; request: TechRequest; showRequester: boolean; onOpen: OpenRequest; actions?: ReactNode; children?: ReactNode };
function TechRequestCard({ data, request, showRequester, onOpen, actions, children }: CardProps) {
  const stage = requestStage(data, request);
  const day = today(data.settings.timezone);
  const late = !!request.neededBy && request.neededBy < day && stage !== 'done' && stage !== 'declined';
  const soon = !!request.neededBy && !late && daysBetween(day, request.neededBy) <= 2 && (stage === 'with_pm' || stage === 'with_lead');
  return <article className={clsx('request-card', 'tech-request-card', `tech-request-${stage}`)}>
    <header className="request-card-head">
      <span className="item-key">{request.key}</span>
      <TeamTag data={data} id={request.departmentId} />
      <StageBadge stage={stage} />
    </header>
    <Button variant="ghost" className="request-title-link" onClick={() => onOpen(request)}>{request.title}</Button>
    <div className="request-facts">
      <span className="request-category">{categoryIcons[request.category]}{categoryLabel(request.category)}</span>
      {request.tool && <span className="request-tool">{request.tool}</span>}
      <PriorityBadge priority={request.priority} />
      {request.neededBy && <span className={clsx((late || soon) && 'due-overdue')}><CalendarDays />Needed by {displayDate(request.neededBy, { weekday: 'short' })}</span>}
    </div>
    <RequestDetails text={request.description} />
    <p className="request-raised">{showRequester && <><Avatar member={requesterOf(data, request)} size="small" /><strong>{request.requesterName}</strong></>}<span>Raised {when(data, request.createdAt)}</span>
      <span className="request-counts">
        {request.comments.length > 0 && <button type="button" onClick={() => onOpen(request)} aria-label={`${plural(request.comments.length, 'comment')} on ${request.key}`}><MessageSquareText aria-hidden="true" />{request.comments.length}</button>}
        {request.attachmentCount > 0 && <button type="button" onClick={() => onOpen(request)} aria-label={`${plural(request.attachmentCount, 'file')} on ${request.key}`}><Paperclip aria-hidden="true" />{request.attachmentCount}</button>}
      </span>
    </p>
    {children}
    {request.reviewNote && <p className="request-review"><MessageSquareText size={14} /><span><strong>{stage === 'declined' ? 'Why it was declined' : 'Note from the tech team'}:</strong> {request.reviewNote}</span></p>}
    <footer className="request-card-actions">
      <Button variant="ghost" size="sm" onClick={() => onOpen(request)}>Details</Button>
      {actions}
    </footer>
  </article>;
}

/** First visit: what a request is for, and what happens after it is sent. */
function HowRequestsWork({ onRaise }: { onRaise: () => void }) {
  return <Panel className="how-requests">
    <div className="how-requests-body">
      <div className="how-requests-intro">
        <h2>Need something from the tech team?</h2>
        <p>Ask for a new tool, a change to a tool you use, a fix, a report, or access. Attach screenshots or documents if they help.</p>
      </div>
      <ol className="how-requests-steps">
        <li><span>1</span><div><strong>Raise a request</strong><p>Say what you need and why. Add files and links.</p></div></li>
        <li><span>2</span><div><strong>A project manager reviews it</strong><p>They may ask a question, then send it to the tech lead.</p></div></li>
        <li><span>3</span><div><strong>The tech lead assigns it</strong><p>A developer works on it. Follow every step here.</p></div></li>
      </ol>
      <Button size="lg" onClick={onRaise}><Plus data-icon="inline-start" />Raise a request</Button>
    </div>
  </Panel>;
}

type MyRequestsProps = { data: DashboardData; onRaise: () => void; onOpen: OpenRequest; onEdit: (request: TechRequest) => void; mutate: MutationFn; busy: boolean };

/**
 * A requester's home: their team's requests, their own among them, with where each one is. Everyone raises requests for their
 * own team only, so one list serves the whole team. A teammate's request names who raised it; your own does not.
 */
export function MyRequests({ data, onRaise, onOpen, onEdit, mutate, busy }: MyRequestsProps) {
  const me = data.currentUser;
  const team = findDepartment(data, me.departmentId);
  const [withdrawing, setWithdrawing] = useState<string | null>(null);
  // The server sends a requester their own and their team's requests, and nothing else.
  const shown = data.techRequests;
  const stageOf = (request: TechRequest) => requestStage(data, request);
  const open = shown.filter(r => OPEN_STAGES.includes(stageOf(r))).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const closed = shown.filter(r => !OPEN_STAGES.includes(stageOf(r))).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const count = (stages: RequestStage[]) => shown.filter(r => stages.includes(stageOf(r))).length;

  const card = (request: TechRequest) => {
    const own = request.requesterId === me.id;
    const editable = requestPermissions(data, request).change;
    const stage = stageOf(request);
    return <TechRequestCard key={request.id} data={data} request={request} showRequester={!own} onOpen={onOpen}
      actions={editable ? withdrawing === request.id
        ? <span className="confirm-inline"><span>Withdraw this request?</span><Button size="sm" variant="destructive" disabled={busy} onClick={async () => { if (await mutate({ action: 'withdrawTechRequest', id: request.id }, 'Request withdrawn')) setWithdrawing(null); }}>Withdraw</Button><Button size="sm" variant="ghost" onClick={() => setWithdrawing(null)}>Keep</Button></span>
        : <><Button variant="ghost" size="sm" onClick={() => setWithdrawing(request.id)}>Withdraw</Button><Button variant="outline" size="sm" onClick={() => onEdit(request)}><Pencil data-icon="inline-start" />Edit</Button></>
        : undefined}>
      {stage !== 'declined' && <RequestProgress data={data} request={request} />}
    </TechRequestCard>;
  };

  return <>
    {shown.length === 0 && <HowRequestsWork onRaise={onRaise} />}
    {shown.length > 0 && <div className="team-overview-strip request-strip">
      <div><span className="mini-metric-icon"><Hourglass /></span><strong>{count(['with_pm', 'with_lead'])}</strong><span>being reviewed</span></div>
      <div><span className="mini-metric-icon"><Clock3 /></span><strong>{count(['assigned', 'in_progress', 'checking'])}</strong><span>with a developer</span></div>
      <div><span className="mini-metric-icon"><CheckCheck /></span><strong>{count(['done'])}</strong><span>done</span></div>
    </div>}
    {shown.length > 0 && <>
      <Panel title={team ? `Open in ${team.name}` : 'Open'} count={open.length}>
        {open.length
          ? <div className="request-list">{open.map(card)}</div>
          : <EmptyState compact title="Nothing open" description={team ? `${team.name} has no open requests.` : 'Every request you raised is done or closed.'} action={<Button variant="outline" onClick={onRaise}><Plus data-icon="inline-start" />Raise a request</Button>} />}
      </Panel>
      {closed.length > 0 && <Panel title="Done and declined" count={closed.length}>
        <div className="request-list">{closed.map(card)}</div>
      </Panel>}
    </>}
  </>;
}

type InboxTab = 'with_pm' | 'with_lead' | 'active' | 'done' | 'declined' | 'all';
const ALL_STAGES: RequestStage[] = ['with_pm', 'with_lead', 'assigned', 'in_progress', 'checking', 'done', 'declined'];
/** The tabs in the order each person works: a project manager starts with new requests, the tech lead with forwarded ones. */
function inboxTabs(lead: boolean, noManager = false): { id: InboxTab; label: string; stages: RequestStage[] }[] {
  const pm = { id: 'with_pm' as const, label: lead ? 'With project manager' : 'New', stages: ['with_pm'] as RequestStage[] };
  const tl = { id: 'with_lead' as const, label: lead ? 'To assign' : 'With tech lead', stages: ['with_lead'] as RequestStage[] };
  // With no project manager, new requests wait for the tech lead, so the project manager tab would always be empty.
  return [...(lead ? noManager ? [tl] : [tl, pm] : [pm, tl]),
    { id: 'active', label: 'In progress', stages: ['assigned', 'in_progress', 'checking'] },
    { id: 'done', label: 'Done', stages: ['done'] },
    { id: 'declined', label: 'Declined', stages: ['declined'] },
    { id: 'all', label: 'All', stages: ALL_STAGES }];
}
type InboxProps = { data: DashboardData; onOpen: OpenRequest; onAct: ActOnRequest; onOpenItem: (id: string) => void; busy: boolean };

/**
 * The inbox for requests from other teams. A project manager reviews new requests and forwards them. The tech lead assigns
 * forwarded ones, and can act on new ones too. Requests to review come first: the most urgent, then the soonest needed, then the oldest.
 */
export function RequestInbox({ data, onOpen, onAct, onOpenItem, busy }: InboxProps) {
  const query = useSearchParams();
  const lead = leadsWork(data.currentUser);
  const noManager = !!data.noProjectManager;
  const tabs = inboxTabs(lead, noManager);
  // Older links say status=new. They mean the first tab: what waits for this person.
  const asked = query.get('status');
  const [tab, setTab] = useState<InboxTab>(() => tabs.find(t => t.id === asked)?.id ?? (asked === 'new' ? tabs[0].id : query.get('q') ? 'all' : tabs[0].id));
  const [teamId, setTeamId] = useState(query.get('team') ?? 'all');
  const [search, setSearch] = useState(query.get('q') ?? '');
  const stages = useMemo(() => new Map(data.techRequests.map(r => [r.id, requestStage(data, r)])), [data]);
  const stageOf = (request: TechRequest) => stages.get(request.id) ?? 'with_pm';
  const needle = search.trim().toLowerCase();
  const base = data.techRequests.filter(r => (teamId === 'all' || r.departmentId === teamId)
    && (!needle || `${r.key} ${r.title} ${r.description} ${r.requesterName} ${r.tool}`.toLowerCase().includes(needle)));
  const inTab = (request: TechRequest, id: InboxTab) => tabs.find(t => t.id === id)!.stages.includes(stageOf(request));
  const urgency = (request: TechRequest) => priorities.indexOf(request.priority);
  const reviewing = tab === 'with_pm' || tab === 'with_lead';
  const shown = base.filter(r => inTab(r, tab)).sort((a, b) => reviewing
    ? urgency(b) - urgency(a) || (a.neededBy ?? '9999').localeCompare(b.neededBy ?? '9999') || (a.forwardedAt ?? a.createdAt).localeCompare(b.forwardedAt ?? b.createdAt)
    : b.updatedAt.localeCompare(a.updatedAt));
  const mineStage: RequestStage = lead ? 'with_lead' : 'with_pm';
  const waiting = data.techRequests.filter(r => stageOf(r) === mineStage);
  const otherStage = data.techRequests.filter(r => stageOf(r) === (lead ? 'with_pm' : 'with_lead')).length;
  const oldest = [...waiting].sort((a, b) => (a.forwardedAt ?? a.createdAt).localeCompare(b.forwardedAt ?? b.createdAt))[0];
  const oldestDays = oldest ? daysBetween(dateKey(oldest.forwardedAt ?? oldest.createdAt, data.settings.timezone), today(data.settings.timezone)) : 0;
  const teams = data.departments.filter(d => !d.isArchived || data.techRequests.some(r => r.departmentId === d.id));
  const filtering = teamId !== 'all' || !!needle;

  const actions = (request: TechRequest) => {
    const can = requestPermissions(data, request);
    if (!can.decline && !can.forward && !can.assign) return undefined;
    return <>
      {can.decline && <Button variant="outline" size="sm" disabled={busy} onClick={() => onAct('decline', request)}><X data-icon="inline-start" />Decline</Button>}
      {lead ? can.assign && <Button size="sm" disabled={busy} onClick={() => onAct('assign', request)}><Check data-icon="inline-start" />Assign</Button>
        : can.forward && <Button size="sm" disabled={busy} onClick={() => onAct('forward', request)}><Forward data-icon="inline-start" />Forward</Button>}
    </>;
  };

  return <>
    <div className="team-overview-strip approvals-strip">
      <div><span className="mini-metric-icon"><Inbox /></span><strong>{waiting.length}</strong><span>{lead ? noManager ? waiting.length === 1 ? 'request waits' : 'requests wait' : waiting.length === 1 ? 'forwarded request waits' : 'forwarded requests wait' : waiting.length === 1 ? 'new request waits' : 'new requests wait'} for you</span></div>
      {lead && noManager
        ? <div><span className="mini-metric-icon"><Forward /></span><strong>—</strong><span>no project manager yet, so new requests come straight to you</span></div>
        : <div><span className="mini-metric-icon"><Forward /></span><strong>{otherStage}</strong><span>{lead ? 'with project managers' : 'with the tech lead'}</span></div>}
      <div><span className="mini-metric-icon"><Clock3 /></span><strong>{data.techRequests.filter(r => inTab(r, 'active')).length}</strong><span>with a developer</span></div>
      <div><span className="mini-metric-icon"><Hourglass /></span><strong>{oldest ? oldestDays <= 0 ? 'Today' : plural(oldestDays, 'day') : '—'}</strong><span>{oldest ? 'the oldest one has waited' : 'nothing waits for you'}</span></div>
    </div>
    <Card className="work-list-panel">
      <div className="work-list-tabs">
        <ToggleGroup type="single" value={tab} onValueChange={value => { if (value) setTab(value as InboxTab); }} className="status-tabs" aria-label="Filter by stage">
          {tabs.map(t => <ToggleGroupItem key={t.id} value={t.id}>{t.label}<span className="tab-count">{base.filter(r => inTab(r, t.id)).length}</span></ToggleGroupItem>)}
        </ToggleGroup>
      </div>
      <div className="list-toolbar">
        <InputGroup className="search-control">
          <InputGroupAddon><Search /></InputGroupAddon>
          <InputGroupInput data-page-search aria-label="Search requests" placeholder="Search by title, key, tool, or person…" value={search} onChange={event => setSearch(event.target.value)} onKeyDown={event => { if (event.key === 'Escape' && search) { event.stopPropagation(); setSearch(''); } }} />
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
            return <TechRequestCard key={request.id} data={data} request={request} showRequester onOpen={onOpen} actions={actions(request)}>
              {stage === 'with_lead' && request.forwardedById && <p className="request-forwarded"><Forward aria-hidden="true" />Forwarded {request.forwardedAt ? when(data, request.forwardedAt) : ''}{forwarder(request) ? ` by ${forwarder(request)}` : ''}</p>}
              {!REVIEWING.includes(stage) && stage !== 'declined' && <WorkLine data={data} request={request} onOpenItem={onOpenItem} />}
            </TechRequestCard>;
          })}</div>
        : <EmptyState title={filtering ? 'No matches' : reviewing ? 'Nothing waits here' : 'Nothing here yet'}
            description={filtering ? 'Try another search or team.' : tab === 'with_pm' ? 'When someone from Sales, E-commerce, or another team raises a request, it lands here.' : tab === 'with_lead' ? noManager ? 'New requests from other teams land here.' : 'Requests a project manager forwards land here.' : 'Requests move here as the team works on them.'} />}
    </Card>
    {isOrgAdmin(data.currentUser) && <p className="inbox-footnote"><Briefcase size={13} aria-hidden="true" />Create teams, add their members, and choose who can sign in on <Link href={routeFor(data, 'other-teams')}>Other teams</Link>. Give people the project manager role on <Link href={routeFor(data, 'people')}>People</Link>.</p>}
  </>;
}
const REVIEWING: RequestStage[] = ['with_pm', 'with_lead'];
/** Who forwarded a request, from its history. */
function forwarder(request: TechRequest) {
  return [...request.history].reverse().find(e => e.action === 'tech_request.forwarded')?.actorName ?? null;
}

const FIELD_WORDS: Record<string, string> = { title: 'the title', description: 'the details', category: 'the kind', tool: 'the tool', priority: 'the urgency', neededBy: 'the date needed', departmentId: 'the team' };
/** One history step in plain words, such as "forwarded it to the tech lead". */
function eventText(data: DashboardData, request: TechRequest, event: RequestEvent) {
  const name = typeof event.payload.name === 'string' ? event.payload.name : 'a file';
  switch (event.action) {
    case 'tech_request.created': return 'raised the request';
    case 'tech_request.updated': {
      const fields = Array.isArray(event.payload.changes) ? event.payload.changes.map(key => FIELD_WORDS[String(key)]).filter(Boolean) : [];
      return fields.length ? `changed ${fields.length > 1 ? `${fields.slice(0, -1).join(', ')} and ${fields.at(-1)}` : fields[0]}` : 'changed the request';
    }
    case 'tech_request.forwarded': return `forwarded it to the tech lead${typeof event.payload.priorityTo === 'string' ? ` as ${event.payload.priorityTo}` : ''}`;
    case 'tech_request.returned': return 'sent it back to the project manager';
    case 'tech_request.assigned': {
      const owner = typeof event.payload.assigneeId === 'string' ? findMember(data, event.payload.assigneeId)?.name : undefined;
      return `assigned it to ${owner ?? request.work?.assigneeName ?? 'a developer'}${event.payload.type === 'bug' ? ' as a bug' : ''}`;
    }
    case 'tech_request.declined': return 'declined it';
    case 'tech_request.plan_shared': return `sent version ${event.payload.version ?? ''} of the plan`;
    case 'tech_request.plan_confirmed': return `confirmed version ${event.payload.version ?? ''} of the plan`;
    case 'attachment.added': return `added ${name}`;
    case 'attachment.removed': return `removed ${name}`;
    default: return event.action.replace('tech_request.', '').replaceAll('_', ' ');
  }
}

type DrawerProps = { data: DashboardData; request: TechRequest; mutate: MutationFn; busy: boolean; onClose: () => void; onAct: ActOnRequest; onEdit: (request: TechRequest) => void; onOpenItem?: (id: string) => void; onFilesChanged?: () => void };

/**
 * Everything about one request, for everyone who can see it: details, progress, files, comments, and history.
 * The buttons at the top are the next steps this person can take.
 */
export function RequestDrawer({ data, request, mutate, busy, onClose, onAct, onEdit, onOpenItem, onFilesChanged }: DrawerProps) {
  const [withdrawing, setWithdrawing] = useState(false);
  const stage = requestStage(data, request);
  const can = requestPermissions(data, request);
  const me = data.currentUser;
  const lead = leadsWork(me);
  const requester = requesterOf(data, request);
  const day = today(data.settings.timezone);
  const late = !!request.neededBy && request.neededBy < day && stage !== 'done' && stage !== 'declined';
  const forwardedBy = forwarder(request);
  async function copyLink() {
    try { await navigator.clipboard.writeText(`${window.location.origin}${window.location.pathname}?${REQUEST_PARAM}=${encodeURIComponent(request.key)}`); toast.success('Link copied'); }
    catch { toast.error('Could not copy the link.'); }
  }
  const next = can.edit || can.forward || can.assign || can.decline || can.sendBack || can.change;
  return <Modal title={request.key} subtitle="Request" onClose={onClose} drawer titleIcon={<Inbox className="drawer-kind-icon" aria-hidden="true" />}
    headerActions={<Button variant="ghost" size="icon-sm" onClick={() => void copyLink()} aria-label={`Copy link to ${request.key}`} title="Copy link"><Link2 /></Button>}>
    <div className="item-drawer-body request-drawer-body">
      <div className="detail-title-row"><h2>{request.title}</h2></div>
      <div className="detail-status-row"><StageBadge stage={stage} /><PriorityBadge priority={request.priority} /><span className="request-category">{categoryIcons[request.category]}{categoryLabel(request.category)}</span></div>
      {next && <div className="detail-actions">
        {can.assign && <Button size="sm" disabled={busy} onClick={() => onAct('assign', request)}><Check data-icon="inline-start" />Assign to a developer</Button>}
        {can.forward && !lead && <Button size="sm" disabled={busy} onClick={() => onAct('forward', request)}><Forward data-icon="inline-start" />Forward to the tech lead</Button>}
        {can.edit && <Button variant="outline" size="sm" disabled={busy} onClick={() => onAct('edit', request)}><Pencil data-icon="inline-start" />Edit</Button>}
        {can.sendBack && <Button variant="outline" size="sm" disabled={busy} onClick={() => onAct('sendBack', request)}><Undo2 data-icon="inline-start" />Send back</Button>}
        {can.decline && <Button variant="outline" size="sm" disabled={busy} onClick={() => onAct('decline', request)}><X data-icon="inline-start" />Decline</Button>}
        {can.change && (withdrawing
          ? <span className="confirm-inline"><span>Withdraw this request?</span><Button size="sm" variant="destructive" disabled={busy} onClick={async () => { if (await mutate({ action: 'withdrawTechRequest', id: request.id }, 'Request withdrawn')) onClose(); }}>Withdraw</Button><Button size="sm" variant="ghost" onClick={() => setWithdrawing(false)}>Keep</Button></span>
          : <><Button variant="outline" size="sm" onClick={() => onEdit(request)}><Pencil data-icon="inline-start" />Edit</Button><Button variant="ghost" size="sm" onClick={() => setWithdrawing(true)}>Withdraw</Button></>)}
      </div>}
      {stage === 'declined'
        ? <Alert variant="destructive" className="detail-blocker"><X /><AlertTitle>Declined</AlertTitle><AlertDescription>{request.reviewNote}</AlertDescription></Alert>
        : <RequestProgress data={data} request={request} />}
      {stage !== 'declined' && request.reviewNote && <p className="request-review"><MessageSquareText size={14} /><span><strong>Note from the tech team:</strong> {request.reviewNote}</span></p>}

      <div className="detail-facts">
        <div className="detail-fact"><span className="detail-fact-label">Asked by</span><strong className="detail-fact-value"><span className="detail-person"><Avatar member={requester} size="small" />{request.requesterId === me.id ? 'You' : request.requesterName}</span></strong></div>
        <div className="detail-fact"><span className="detail-fact-label">Team</span><strong className="detail-fact-value"><TeamTag data={data} id={request.departmentId} /></strong></div>
        <div className="detail-fact"><span className="detail-fact-label">Raised</span><strong className="detail-fact-value">{displayDateTime(request.createdAt)}</strong></div>
        <div className={clsx('detail-fact', late && 'detail-fact-late')}><span className="detail-fact-label">Needed by</span><strong className="detail-fact-value">{request.neededBy ? displayDate(request.neededBy, { weekday: 'short', year: 'numeric' }) : 'No date'}</strong></div>
        <div className="detail-fact"><span className="detail-fact-label">Tool or system</span><strong className="detail-fact-value">{request.tool || '—'}</strong></div>
        {request.forwardedAt && <div className="detail-fact"><span className="detail-fact-label">Forwarded</span><strong className="detail-fact-value">{displayDateTime(request.forwardedAt)}{forwardedBy && <small> · by {forwardedBy}</small>}</strong></div>}
      </div>
      {request.itemId && <section className="drawer-section"><h3 className="detail-section-heading">Work</h3><WorkLine data={data} request={request} onOpenItem={onOpenItem} /></section>}
      <section className="drawer-section detail-description"><h3 className="detail-section-heading">Details</h3><p className="request-description"><LinkedText text={request.description} /></p></section>
      <PlanSection data={data} request={request} mutate={mutate} busy={busy} onAskForChanges={() => { const box = document.getElementById(`reply-${request.id}`); box?.scrollIntoView({ behavior: 'smooth', block: 'center' }); box?.focus({ preventScroll: true }); }} />
      <AttachmentPanel data={data} target={{ requestId: request.id }} title="Files" onChange={onFilesChanged}
        empty={me.role === 'requester' ? 'Screenshots, documents, or a short screen recording help the tech team. Up to 10 MB each.' : 'Add designs, specs, or screenshots. Up to 10 MB each.'} />
      <RequestConversation data={data} request={request} mutate={mutate} busy={busy} />
    </div>
    <div className="drawer-footer"><span>Updated {displayDateTime(request.updatedAt)}</span>{lead && request.status === 'new' && !data.noProjectManager && <span>A project manager has not forwarded it yet. You can still assign it.</span>}</div>
  </Modal>;
}

type ConversationEntry = { at: string; comment: RequestComment; event?: never } | { at: string; event: RequestEvent; comment?: never };
/**
 * The whole conversation on a request, oldest first: comments, each version of the plan that was sent, and each step,
 * such as forwarded or assigned. A requester and the tech side talk here, so nothing needs a meeting or an email thread.
 * The tech side can also leave a note only they see.
 */
function RequestConversation({ data, request, mutate, busy }: { data: DashboardData; request: TechRequest; mutate: MutationFn; busy: boolean }) {
  const me = data.currentUser;
  const can = requestPermissions(data, request);
  const [body, setBody] = useState('');
  const [internal, setInternal] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);
  const who = firstName(personOf(data, request.requesterId, request.requesterName));
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = body.trim();
    if (!text) return;
    if (await mutate({ action: 'addRequestComment', requestId: request.id, body: text, ...(internal ? { internal: true } : {}) }, internal ? 'Note added for the tech team' : 'Message sent')) { setBody(''); setInternal(false); }
  }
  const canRemove = (comment: RequestComment) => comment.authorId === me.id || leadsWork(me);
  const entries: ConversationEntry[] = [
    ...request.comments.map(comment => ({ at: comment.createdAt, comment })),
    ...request.history.map(event => ({ at: event.createdAt, event })),
  ].sort((a, b) => a.at.localeCompare(b.at));
  const latestVersion = request.sharedPlan?.version;
  return <section className="drawer-section request-conversation">
    <h3 className="detail-section-heading">Conversation <span>{request.comments.length}</span></h3>
    <ol className="conversation">{entries.map(entry => {
      if (entry.comment) {
        const comment = entry.comment;
        const author = personOf(data, comment.authorId, comment.authorName, comment.authorRole);
        return <li key={comment.id} className={clsx('comment', comment.internal && 'is-internal', comment.authorId === me.id && 'is-mine')}>
          <Avatar member={author} size="small" />
          <div className="comment-body">
            <p className="comment-meta"><strong>{comment.authorId === me.id ? 'You' : comment.authorName}</strong><span>{comment.authorRole === 'requester' ? findDepartment(data, request.departmentId)?.name ?? 'Other team' : roleNames[comment.authorRole]}</span><time dateTime={comment.createdAt}>{when(data, comment.createdAt)}</time>
              {comment.internal && <Badge variant="outline" className="internal-tag"><Lock aria-hidden="true" />Tech team only</Badge>}</p>
            <p className="comment-text"><LinkedText text={comment.body} /></p>
            {canRemove(comment) && (removing === comment.id
              ? <span className="confirm-inline"><span>Remove this message?</span><Button size="sm" variant="destructive" disabled={busy} onClick={async () => { if (await mutate({ action: 'deleteRequestComment', id: comment.id }, 'Message removed')) setRemoving(null); }}>Remove</Button><Button size="sm" variant="ghost" onClick={() => setRemoving(null)}>Keep</Button></span>
              : <Button variant="link" size="sm" className="comment-remove" onClick={() => setRemoving(comment.id)}><Trash2 data-icon="inline-start" />Remove</Button>)}
          </div>
        </li>;
      }
      const event = entry.event;
      const actor = event.actorId === me.id ? 'You' : event.actorName;
      if (event.action === 'tech_request.plan_shared') {
        const plan = event.payload.plan as RequestPlan | undefined;
        const version = Number(event.payload.version);
        return <li key={event.id} className="conversation-plan">
          <p className="conversation-plan-head"><ListChecks aria-hidden="true" /><span><strong>{actor}</strong> sent version {version} of the plan{version === latestVersion ? <Badge variant="outline" className="plan-latest">Latest</Badge> : null}</span><time dateTime={event.createdAt}>{when(data, event.createdAt)}</time></p>
          {event.note && <p className="comment-text"><LinkedText text={event.note} /></p>}
          {/* The latest version is open in the Plan section above, so every version here starts folded. */}
          {plan && <details><summary>Show version {version}</summary><PlanView plan={plan} compact /></details>}
        </li>;
      }
      return <li key={event.id} className="conversation-step">
        <span aria-hidden="true" />
        <p><strong>{actor}</strong> {eventText(data, request, event)}<time dateTime={event.createdAt}> · {when(data, event.createdAt)}</time></p>
        {event.note && event.action !== 'tech_request.created' && <blockquote>{event.note}</blockquote>}
      </li>;
    })}</ol>
    <form className="comment-form" onSubmit={submit}>
      <Textarea id={`reply-${request.id}`} aria-label="Write a message" value={body} onChange={event => setBody(event.target.value)} rows={2} maxLength={5000} placeholder={internal ? 'A note only the tech team sees…' : me.role === 'requester' ? 'Ask a question, add details, or ask for changes to the plan…' : `Write to ${who}…`}
        onKeyDown={event => { if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) { event.preventDefault(); event.currentTarget.form?.requestSubmit(); } }} />
      <div className="comment-form-actions">
        {can.internalComments && <label className="internal-toggle"><Switch checked={internal} onCheckedChange={setInternal} aria-label="Only the tech team sees this message" />Tech team only</label>}
        <span className="comment-form-hint">{internal ? `${who} will not see this.` : me.role === 'requester' ? 'The tech team sees this and gets an email.' : `${who} sees this and gets an email.`}</span>
        <Button type="submit" size="sm" disabled={busy || !body.trim()}><Send data-icon="inline-start" />Send</Button>
      </div>
    </form>
  </section>;
}

/** Opens the form for a request's next step. Each form closes on success, and the details panel opens again. */
export function RequestActionForm({ data, kind, request, mutate, busy, onClose }: { data: DashboardData; kind: RequestActionKind; request: TechRequest; mutate: MutationFn; busy: boolean; onClose: () => void }) {
  switch (kind) {
    case 'assign': return <AssignRequestForm data={data} request={request} mutate={mutate} busy={busy} onClose={onClose} />;
    case 'decline': return <DeclineTechRequestForm data={data} request={request} mutate={mutate} busy={busy} onClose={onClose} />;
    case 'forward': return <ForwardRequestForm data={data} request={request} mutate={mutate} busy={busy} onClose={onClose} />;
    case 'sendBack': return <SendBackForm data={data} request={request} mutate={mutate} busy={busy} onClose={onClose} />;
    case 'edit': return <TechRequestForm data={data} editing={request} staff mutate={mutate} busy={busy} onClose={onClose} />;
  }
}

/** A short summary of the request at the top of each decision form. */
function RequestContext({ data, request }: { data: DashboardData; request: TechRequest }) {
  return <div className="request-context">
    <p><strong>{categoryLabel(request.category)}{request.tool ? ` · ${request.tool}` : ''}</strong><LinkedText text={request.description} /></p>
    {request.neededBy && <p><strong>Needed by</strong>{displayDate(request.neededBy, { weekday: 'short', year: 'numeric' })}</p>}
    {(request.comments.length > 0 || request.attachmentCount > 0) && <p className="request-context-counts">{[request.comments.length && plural(request.comments.length, 'comment'), request.attachmentCount && plural(request.attachmentCount, 'file')].filter(Boolean).join(' · ')}. Open the request to read them.</p>}
    <p className="sr-only">From {request.requesterName}, {findDepartment(data, request.departmentId)?.name ?? 'their team'}</p>
  </div>;
}

/** A project manager sends a reviewed request to the tech lead. They can set how urgent it is, and leave a note for the tech lead. */
function ForwardRequestForm({ data, request, mutate, busy, onClose }: { data: DashboardData; request: TechRequest; mutate: MutationFn; busy: boolean; onClose: () => void }) {
  const requester = request.requesterName.split(' ')[0];
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const fields = new FormData(event.currentTarget);
    const note = String(fields.get('note') ?? '').trim();
    const priority = String(fields.get('priority')) as TechRequest['priority'];
    const ok = await mutate({ action: 'forwardTechRequest', id: request.id, ...(priority !== request.priority ? { priority } : {}), ...(note ? { note } : {}) }, `Forwarded to the tech lead. ${requester} sees the new step.`);
    if (ok) onClose();
  }
  return <Modal title="Forward to the tech lead" subtitle={`${request.key} · “${request.title}” from ${request.requesterName}, ${findDepartment(data, request.departmentId)?.name ?? 'their team'}`} onClose={onClose}>
    <form onSubmit={submit} className="item-form">
      <FieldGroup className="modal-form-body">
        <RequestContext data={data} request={request} />
        <FormField>How urgent is it?<FormChoice name="priority" defaultValue={request.priority} options={PRIORITY_OPTIONS} /><span className="field-help">{requester} chose {request.priority}. Change it if the business need is different.</span></FormField>
        <FormField>Note for the tech lead <span className="optional">optional</span><Textarea name="note" rows={3} maxLength={5000} placeholder="For example, what you agreed with the team, who to ask, or what matters most." /><span className="field-help">Only the tech team sees this note.</span></FormField>
      </FieldGroup>
      <FormFooter busy={busy} onClose={onClose} label="Forward request" />
    </form>
  </Modal>;
}

/** The tech lead returns a forwarded request to the project managers, for example when it needs more detail first. */
function SendBackForm({ data, request, mutate, busy, onClose }: { data: DashboardData; request: TechRequest; mutate: MutationFn; busy: boolean; onClose: () => void }) {
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const reason = String(new FormData(event.currentTarget).get('reason')).trim();
    if (await mutate({ action: 'returnTechRequest', id: request.id, reason }, 'Sent back to the project managers.')) onClose();
  }
  return <Modal title="Send back to the project manager" subtitle={`${request.key} · “${request.title}”`} onClose={onClose}>
    <form onSubmit={submit}>
      <FieldGroup className="modal-form-body">
        <RequestContext data={data} request={request} />
        <FormField>What should the project manager check?<Textarea name="reason" required minLength={3} maxLength={5000} rows={3} placeholder="For example, which pages this covers, or whether finance agreed to the cost." /><span className="field-help">This becomes a comment only the tech team sees. The request goes back to the project managers.</span></FormField>
      </FieldGroup>
      <FormFooter busy={busy} onClose={onClose} label="Send back" />
    </form>
  </Modal>;
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
        <RequestContext data={data} request={request} />
        {request.status === 'new' && !data.noProjectManager && <Alert><Inbox /><AlertDescription>A project manager has not reviewed this request yet. Assigning it now skips that step.</AlertDescription></Alert>}
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
        <FormField>Note for {requester} <span className="optional">optional</span><Textarea name="note" rows={2} maxLength={2000} placeholder="For example, when to expect it, or what you need from them." /><span className="field-help">The developer sees the request, its files, and its comments from the ticket.</span></FormField>
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
        <FormField>Why are you declining it?<Textarea name="reason" required minLength={3} maxLength={2000} rows={3} placeholder="For example, this already exists, here is how to use it. Or, it is not planned this quarter." /><span className="field-help">{requester} sees this reason. Say what they can do instead, if anything. To ask a question instead, add a comment.</span></FormField>
      </FieldGroup>
      <FormFooter busy={busy} onClose={onClose} label="Decline request" />
    </form>
  </Modal>;
}

type RequestFormProps = { data: DashboardData; editing?: TechRequest; staff?: boolean; mutate: MutationFn; onClose: () => void; busy: boolean; onFilesChanged?: () => void; onOpenRaised?: (id: string) => void };

/**
 * A requester raises a request, or changes it while a project manager has it. A project manager or the tech lead corrects it
 * (`staff`) until it is assigned. Only changed values are sent. Files chosen here upload once the request exists.
 */
export function TechRequestForm({ data, editing, staff = false, mutate, onClose, busy, onFilesChanged, onOpenRaised }: RequestFormProps) {
  const teams = activeDepartments(data);
  // Someone from another team raises requests for their own team only. The tech side may move a request to the right team.
  const ownTeam = teams.find(t => t.id === data.currentUser.departmentId);
  const pickTeam = staff;
  const noTeam = !pickTeam && !editing && !ownTeam;
  // People in other teams ask for a new tool or a new feature. A project manager can file a request under any kind.
  // An older request keeps its kind as a choice, so editing it never changes the kind by surprise.
  const kinds = staff ? requestCategories : requestCategories.filter(c => requesterCategories.includes(c) || c.value === editing?.category);
  const [category, setCategory] = useState<RequestCategory>(editing?.category ?? 'tool');
  const [departmentId, setDepartmentId] = useState(editing?.departmentId ?? ownTeam?.id ?? '');
  const [neededBy, setNeededBy] = useState(editing?.neededBy ?? '');
  const [files, setFiles] = useState<File[]>([]);
  const [uploading, setUploading] = useState(false);
  const day = today(data.settings.timezone);
  const live = data.mode === 'live';
  // A team that is archived now still shows for a request filed under it.
  const teamChoices = editing && !teams.some(t => t.id === editing.departmentId) ? [...teams, ...data.departments.filter(d => d.id === editing.departmentId)] : teams;
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const fields = new FormData(event.currentTarget);
    const values: TechRequestInput = {
      title: String(fields.get('title')).trim(), description: String(fields.get('description')).trim(), category, tool: String(fields.get('tool') ?? '').trim(),
      priority: String(fields.get('priority')) as TechRequest['priority'], neededBy: neededBy || null, departmentId,
    };
    if (!editing) {
      const id = crypto.randomUUID();
      if (!await mutate({ action: 'createTechRequest', id, ...values }, files.length && live ? 'Request sent. Uploading your files…' : 'Request sent. You can follow it here.')) return;
      if (files.length && live) {
        setUploading(true);
        const attached = await uploadFiles({ requestId: id }, files);
        setUploading(false);
        if (attached) toast.success(attached === 1 ? 'File attached to your request' : `${attached} files attached to your request`);
        onFilesChanged?.();
        // The request is sent either way. Open it, so the files that did not attach can be added again from Files.
        if (attached < files.length) {
          toast.error(`Your request was sent, but ${plural(files.length - attached, 'file')} did not attach. Add ${files.length - attached === 1 ? 'it' : 'them'} again under Files.`, { duration: 10_000 });
          onClose();
          onOpenRaised?.(id);
          return;
        }
      }
      onClose();
      return;
    }
    const patch = Object.fromEntries(Object.entries(values).filter(([key, value]) => editing[key as keyof TechRequestInput] !== value)) as Partial<TechRequestInput>;
    if (!Object.keys(patch).length) { onClose(); return; }
    const requester = editing.requesterName.split(' ')[0];
    if (await mutate(staff ? { action: 'editTechRequest', id: editing.id, patch } : { action: 'updateTechRequest', id: editing.id, patch }, staff ? `Request updated. ${requester} sees the change in its history.` : 'Request updated')) onClose();
  }
  const subtitle = staff ? `${editing!.key} · from ${editing!.requesterName}. Correct it before it goes to a developer. The change shows in its history.`
    : editing ? `${editing.key} · You can change it until a project manager forwards it. After that, add a comment.`
    : 'Tell the tech team what your team needs. A project manager reviews it, the tech lead assigns it, and you follow it here.';
  return <Modal title={editing ? 'Edit request' : 'Raise a request'} subtitle={subtitle} onClose={onClose}>
    <form onSubmit={submit} className="item-form">
      <FieldGroup className="modal-form-body">
        {noTeam && <Alert variant="destructive"><Briefcase /><AlertTitle>You are not in a team yet</AlertTitle><AlertDescription>An admin adds you to your team, such as Sales. Then you can raise requests for it here.</AlertDescription></Alert>}
        <FormField className="title-label">What do you need?<Input className="task-title-input" name="title" required minLength={3} maxLength={200} defaultValue={editing?.title} placeholder="e.g. A shared inbox for customer WhatsApp messages" autoComplete="off" /></FormField>
        <FormField>What kind of request is it?
          <ToggleGroup type="single" variant="outline" value={category} onValueChange={value => { if (value) setCategory(value as RequestCategory); }} className="category-choice" aria-label="Kind of request">
            {kinds.map(c => <ToggleGroupItem key={c.value} value={c.value}>{categoryIcons[c.value]}{c.label}</ToggleGroupItem>)}
          </ToggleGroup>
          <span className="field-help">{kinds.find(c => c.value === category)?.hint}</span></FormField>
        <FormField>Which tool or system is it about? <span className="optional">optional</span><Input name="tool" maxLength={120} defaultValue={editing?.tool} placeholder="e.g. Shopify, the CRM, the website, Google Sheets" autoComplete="off" /></FormField>
        <FormField>Details<Textarea name="description" required minLength={10} maxLength={20000} rows={5} defaultValue={editing?.description} placeholder={category === 'problem' ? 'What went wrong, where, and since when? Attach a screenshot or a short screen recording.' : category === 'tool' ? 'What should the tool do, who will use it, and how do you work today? Name any tool you already like.' : 'What should happen, and why does your team need it? Add links to examples, sheets, or designs.'} /></FormField>
        <FieldGroup className="form-grid">
          {pickTeam
            ? <FormField>Team<FormSelect required value={departmentId} onValueChange={setDepartmentId}><option value="" disabled>Choose the team</option>{teamChoices.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}</FormSelect></FormField>
            : <div className="request-team-fact"><span>For</span>{departmentId ? <TeamTag data={data} id={departmentId} /> : <em>No team yet</em>}</div>}
          <FormField>Needed by <span className="optional">optional</span><FormDate value={neededBy} min={day} onValueChange={setNeededBy} placeholder="No date" /></FormField>
        </FieldGroup>
        <FormField>How urgent is it?<FormChoice name="priority" defaultValue={editing?.priority ?? 'medium'} options={PRIORITY_OPTIONS} /><span className="field-help">Choose Urgent only when work is stopped today.</span></FormField>
        {!editing && <FormField>Files <span className="optional">optional</span>
          {live ? <FilePicker files={files} onChange={setFiles} disabled={busy || uploading} /> : <span className="field-help">Attach files in your live workspace.</span>}</FormField>}
        {editing && <p className="form-help">To add or remove files, open the request and use Files.</p>}
      </FieldGroup>
      <FormFooter busy={busy || uploading} disabled={!departmentId || noTeam} onClose={onClose} label={uploading ? 'Uploading files…' : editing ? 'Save changes' : files.length ? `Send request with ${plural(files.length, 'file')}` : 'Send request'} />
    </form>
  </Modal>;
}
