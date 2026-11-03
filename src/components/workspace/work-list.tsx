"use client";

import { useMemo, useState, type CSSProperties, type MouseEvent, type ReactNode } from 'react';
import clsx from 'clsx';
import { useSearchParams } from 'next/navigation';
import { ArrowDownUp, CalendarDays, ChevronDown, CircleHelp, Columns3, List, Plus, Rows3, Search, X } from 'lucide-react';
import type { DashboardData, WorkItem } from '@/lib/types';
import { dateKey, getBugKpi, getWeekStart } from '@/lib/kpi';
import { Avatar, EmptyState, FormCheckbox, FormDateRange, FormField, FormSelect, Kbd, PriorityMark, StatusBadge, StatusIcon } from '@/components/ui';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/components/ui/input-group';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { attentionReason, bugStatuses, displayDate, displayDateTime, findMember, findProject, firstName, hours, isAdhocProject, isDone, kindLabels, priorities, statusLabels, ticketStatuses, today, type OnAction } from './lib';
import { FixBy, isCarriedOver, ItemActions, ItemFlags, ItemMenu, PhaseTag, ProjectTag, SeverityBadge, TicketCard } from './parts';
import { useSearchShortcut, useStoredChoice } from './use-choice';

/** Rows shown per group before "Show all", so a long month stays quick to scroll. */
const GROUP_LIMIT = 40;

type DatePreset = 'today' | 'week' | 'month';
function presetRange(preset: DatePreset, day: string, timezone: string): [string, string] {
  if (preset === 'week') return [getWeekStart(day, timezone), day];
  if (preset === 'month') return [`${day.slice(0, 7)}-01`, day];
  return [day, day];
}

/** The day a ticket's work is for. Tickets made before tickets had a date use the day they were added. */
function plannedDay(item: WorkItem, timezone: string) {
  return item.dueDate ?? dateKey(item.createdAt, timezone);
}

/** The day a done ticket earned its hours, or null while it is open. */
function doneDay(item: WorkItem, timezone: string) {
  return isDone(item) && item.completedAt ? dateKey(item.completedAt, timezone) : null;
}

const VIEWS = ['list', 'board'] as const;
const GROUPINGS = ['status', 'owner', 'project', 'none'] as const;
type Grouping = (typeof GROUPINGS)[number];
type Group = { id: string; label: string; icon?: ReactNode; items: WorkItem[] };

type WorkListProps = { data: DashboardData; kind: 'task' | 'bug'; onOpen: (id: string) => void; onAction: OnAction; onExtend: (item: WorkItem) => void; onAddHours: (item: WorkItem) => void; onAdd: (kind: 'task' | 'bug') => void; busy: boolean };

export function WorkList({ data, kind, onOpen, onAction, onExtend, onAddHours, onAdd, busy }: WorkListProps) {
  const query = useSearchParams();
  const tickets = kind === 'task';
  const statuses: WorkItem['status'][] = tickets ? ticketStatuses : bugStatuses;
  const admin = data.currentUser.role === 'admin';
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState(() => { const value = query.get('status'); return value && (statuses as string[]).includes(value) ? value : 'all'; });
  const [assignee, setAssignee] = useState(query.get('assignee') ?? 'all');
  const [projectId, setProjectId] = useState(query.get('project') ?? 'all');
  const [phaseFilter, setPhaseFilter] = useState(query.get('phase') ?? 'all');
  const [attentionOnly, setAttentionOnly] = useState(query.get('attention') === '1');
  const [view, setView] = useStoredChoice(`${kind}-view`, 'list', VIEWS);
  const [grouping, setGrouping] = useStoredChoice<Grouping>(`${kind}-group`, 'status', admin ? GROUPINGS : GROUPINGS.filter(g => g !== 'owner'));
  const sorts = tickets ? ['date', 'recent', 'priority'] as const : ['due', 'recent', 'priority'] as const;
  const [sort, setSort] = useStoredChoice<string>(`${kind}-sort`, sorts[0], sorts);
  const [collapsed, setCollapsed] = useState<string[]>([]);
  const [showAll, setShowAll] = useState<string[]>([]);
  const timezone = data.settings.timezone;
  const day = today(timezone);
  const [[dateStart, dateEnd], setDates] = useState<[string, string]>([day, day]);
  const noun = kindLabels[kind].toLowerCase();
  const canAdd = tickets || admin;
  const searchKey = useSearchShortcut();

  // A ticket belongs to the picked dates from the day it was added until the day it is done. Open work carries over.
  const inDates = (item: WorkItem) => {
    const done = doneDay(item, timezone);
    return dateKey(item.createdAt, timezone) <= dateEnd && (!done || done >= dateStart);
  };
  const ofKind = data.items.filter(item => item.type === kind && (!tickets || inDates(item)));
  const needle = search.trim().toLowerCase();
  // Every filter except status, so each status tab can show its own count.
  const base = ofKind.filter(item =>
    (assignee === 'all' || item.assigneeId === assignee)
    && (projectId === 'all' || item.projectId === projectId)
    && (phaseFilter === 'all' || (phaseFilter === 'adhoc' ? item.phaseId === null : item.phaseId === phaseFilter))
    && (!attentionOnly || attentionReason(item, data, day) !== null)
    && (!needle || `${item.title} ${item.key} ${item.description}`.toLowerCase().includes(needle)));
  const fixBy = useMemo(() => new Map(tickets ? [] : data.items.filter(item => item.type === 'bug').map(item => [item.id, getBugKpi(item, data).deadline1.toISOString()])), [data, tickets]);
  const rank = (item: WorkItem) => priorities.indexOf(item.priority);
  const filtered = base.filter(item => status === 'all' || item.status === status).sort((a, b) =>
    sort === 'priority' ? rank(b) - rank(a) || plannedDay(a, timezone).localeCompare(plannedDay(b, timezone))
    : sort === 'date' ? plannedDay(a, timezone).localeCompare(plannedDay(b, timezone)) || rank(b) - rank(a)
    : sort === 'due' ? (fixBy.get(a.id) ?? '').localeCompare(fixBy.get(b.id) ?? '')
    : b.createdAt.localeCompare(a.createdAt));
  const activePreset = (['today', 'week', 'month'] as const).find(preset => presetRange(preset, day, timezone).join() === `${dateStart},${dateEnd}`) ?? '';
  // Performance for the picked dates. A ticket earns its hours on the day it is done.
  const done = filtered.filter(item => { const finished = tickets && doneDay(item, timezone); return !!finished && finished >= dateStart && finished <= dateEnd; });
  const earnedHours = done.reduce((sum, item) => sum + item.estimateHours, 0);
  const filtering = (tickets && (dateStart !== day || dateEnd !== day)) || search || status !== 'all' || assignee !== 'all' || projectId !== 'all' || phaseFilter !== 'all' || attentionOnly;
  function clearFilters() { setSearch(''); setStatus('all'); setAssignee('all'); setProjectId('all'); setPhaseFilter('all'); setAttentionOnly(false); setDates([day, day]); }
  const toggle = (list: string[], id: string) => list.includes(id) ? list.filter(existing => existing !== id) : [...list, id];

  const groups: Group[] = grouping === 'status'
    ? statuses.map(s => ({ id: s, label: statusLabels[s], icon: <StatusIcon status={s} />, items: filtered.filter(item => item.status === s) })).filter(group => group.items.length > 0)
    : grouping === 'owner'
    ? [...new Set(filtered.map(item => item.assigneeId))].map(id => ({ id, member: findMember(data, id) }))
        .sort((a, b) => (a.member?.name ?? '').localeCompare(b.member?.name ?? ''))
        .map(({ id, member }) => ({ id, label: member?.name ?? 'Former team member', icon: <Avatar member={member} size="small" />, items: filtered.filter(item => item.assigneeId === id) }))
    : grouping === 'project'
    ? [...new Set(filtered.map(item => item.projectId))].map(id => ({ id, project: findProject(data, id) }))
        .sort((a, b) => Number(isAdhocProject(a.project)) - Number(isAdhocProject(b.project)) || (a.project?.name ?? '').localeCompare(b.project?.name ?? ''))
        .map(({ id, project }) => ({ id, label: project?.name ?? 'Unknown project', icon: <i className="group-project-dot" style={{ background: project?.color }} aria-hidden="true" />, items: filtered.filter(item => item.projectId === id) }))
    : [{ id: 'all', label: '', items: filtered }];
  // A column that repeats the group heading adds nothing, so it hides while that grouping is on.
  const showStatus = grouping !== 'status';
  const showOwner = admin && grouping !== 'owner';
  const columnCount = 7 + Number(showStatus) + Number(showOwner);

  const empty = <EmptyState
    bug={kind === 'bug'}
    title={ofKind.length ? 'No matches' : tickets ? 'No tickets yet' : 'No bugs. Nice.'}
    description={ofKind.length ? 'Try another search or clear your filters.' : tickets ? admin ? 'Add a ticket with a title, project, owner, and estimate.' : 'Request a ticket for new work. Your admin approves it, or assigns tickets to you.' : admin ? 'Log a bug when you find one. Its fix-by time starts at once.' : 'Bugs assigned to you will appear here.'}
    action={canAdd && !ofKind.length ? <Button onClick={() => onAdd(kind)}><Plus data-icon="inline-start" size={15} />{tickets ? admin ? 'New ticket' : 'Request ticket' : 'Log bug'}</Button> : undefined}
  />;

  return <>
    <Card className="work-list-panel">
      <div className="work-list-tabs">
        <ToggleGroup type="single" value={status} onValueChange={value => setStatus(value || 'all')} className="status-tabs" aria-label="Filter by status">
          <ToggleGroupItem value="all">All<span className="tab-count">{base.length}</span></ToggleGroupItem>
          {statuses.map(s => <ToggleGroupItem key={s} value={s}><StatusIcon status={s} />{statusLabels[s]}<span className="tab-count">{base.filter(item => item.status === s).length}</span></ToggleGroupItem>)}
        </ToggleGroup>
        <ToggleGroup type="single" variant="outline" spacing={0} size="sm" value={view} onValueChange={value => { if (value) setView(value as 'list' | 'board'); }} aria-label="Choose view" className="view-toggle">
          <ToggleGroupItem value="list" aria-label="List view"><List /><span className="view-toggle-label">List</span></ToggleGroupItem>
          <ToggleGroupItem value="board" aria-label="Board view"><Columns3 /><span className="view-toggle-label">Board</span></ToggleGroupItem>
        </ToggleGroup>
      </div>
      <div className="list-toolbar">
        <InputGroup className="search-control">
          <InputGroupAddon><Search /></InputGroupAddon>
          <InputGroupInput data-page-search aria-label={`Search ${noun}s`} placeholder={`Search ${noun}s by title or key…`} value={search} onChange={event => setSearch(event.target.value)} onKeyDown={event => { if (event.key === 'Escape' && search) { event.stopPropagation(); setSearch(''); } }} />
          {search ? <InputGroupAddon align="inline-end"><Button variant="ghost" size="icon-xs" aria-label="Clear search" onClick={() => setSearch('')}><X /></Button></InputGroupAddon> : <InputGroupAddon align="inline-end" className="search-shortcut"><Kbd>/</Kbd></InputGroupAddon>}
        </InputGroup>
        <div className="filter-controls">
          {admin && <FormSelect aria-label="Filter by owner" value={assignee} onValueChange={setAssignee}><option value="all">Everyone</option>{data.members.filter(m => m.role === 'developer' && (m.isActive || data.items.some(item => item.assigneeId === m.id))).map(m => <option key={m.id} value={m.id}>{m.name}</option>)}</FormSelect>}
          <FormSelect aria-label="Filter by project" value={projectId} onValueChange={value => { setProjectId(value); setPhaseFilter('all'); }}><option value="all">All projects</option>{data.projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</FormSelect>
          <FormSelect aria-label="Filter by phase" value={phaseFilter} onValueChange={setPhaseFilter}><option value="all">All phases</option><option value="adhoc">Ad hoc</option>{data.phases.filter(phase => projectId === 'all' || phase.projectId === projectId).map(phase => <option key={phase.id} value={phase.id}>{projectId === 'all' ? `${findProject(data, phase.projectId)?.name} · ` : ''}{phase.name}</option>)}</FormSelect>
        </div>
        <div className="arrange-controls">
          {view === 'list' && <span className="labelled-select" title="Group rows"><Rows3 aria-hidden="true" /><FormSelect aria-label={`Group ${noun}s`} value={grouping} onValueChange={value => setGrouping(value as Grouping)}><option value="status">Status</option>{admin && <option value="owner">Owner</option>}<option value="project">Project</option><option value="none">No groups</option></FormSelect></span>}
          <span className="labelled-select" title="Sort rows"><ArrowDownUp aria-hidden="true" /><FormSelect aria-label={`Sort ${noun}s`} value={sort} onValueChange={setSort}>{tickets ? <option value="date">Date</option> : <option value="due">Fix-by time</option>}<option value="recent">Newest first</option><option value="priority">Priority</option></FormSelect></span>
        </div>
      </div>
      <div className="filter-meta">
        {tickets && <div className="period-controls">
          <ToggleGroup type="single" variant="outline" spacing={0} size="sm" value={activePreset} onValueChange={value => { if (value) setDates(presetRange(value as DatePreset, day, timezone)); }} aria-label="Pick a period">
            <ToggleGroupItem value="today">Today</ToggleGroupItem><ToggleGroupItem value="week">This week</ToggleGroupItem><ToggleGroupItem value="month">This month</ToggleGroupItem>
          </ToggleGroup>
          <FormDateRange aria-label="Filter by date" start={dateStart} end={dateEnd} max={day} onValueChange={(start, end) => setDates([start, end])} className="period-range" />
        </div>}
        <span className="filter-summary"><strong>{filtered.length}</strong> {noun}{filtered.length === 1 ? '' : 's'}{tickets && <> · <strong>{done.length}</strong> done · <strong>{hours(earnedHours)} h</strong> earned {dateStart === dateEnd ? `on ${displayDate(dateStart, { weekday: 'short' })}` : `from ${displayDate(dateStart)} to ${displayDate(dateEnd)}`}</>}</span>
        <FormField className="checkbox-label"><FormCheckbox checked={attentionOnly} onCheckedChange={setAttentionOnly} />Needs attention only</FormField>
        {filtering && <Button variant="ghost" size="sm" className="clear-filters" onClick={clearFilters}>Clear filters<X data-icon="inline-end" size={12} /></Button>}
      </div>
      <div className="work-list-content">
        {filtered.length === 0 ? empty
          : view === 'board'
            ? <div className="kanban-board" style={{ '--columns': status === 'all' ? statuses.length : 1 } as CSSProperties}>{statuses.filter(s => status === 'all' || status === s).map(s => {
                const column = filtered.filter(item => item.status === s);
                return <section className="kanban-column" key={s} aria-label={`${statusLabels[s]}: ${column.length}`}>
                  <header className={`kanban-heading kanban-${s}`}><span><StatusIcon status={s} />{statusLabels[s]}</span><span className="kanban-count">{column.length}</span></header>
                  <div className="kanban-items">{column.map(item => <TicketCard key={item.id} item={item} data={data} onOpen={onOpen} onAction={onAction} onExtend={onExtend} onAddHours={onAddHours} busy={busy} />)}{column.length === 0 && <div className="kanban-empty">Nothing here</div>}</div>
                </section>;
              })}</div>
            : <div className="table-scroll"><Table className={clsx('data-table work-table', `work-table-${kind}`)}>
                <TableHeader><TableRow>
                  <TableHead className="col-main">{kindLabels[kind]}</TableHead>
                  {showStatus && <TableHead className="col-status">Status</TableHead>}
                  <TableHead className="col-project">Project · phase</TableHead>
                  {showOwner && <TableHead className="col-owner">Owner</TableHead>}
                  <TableHead className="col-estimate">{tickets ? 'Estimate' : 'Severity'}</TableHead>
                  <TableHead className="col-date">{tickets ? 'Date' : 'Fix by'}</TableHead>
                  <TableHead className="col-priority"><span className="sr-only">Priority</span></TableHead>
                  <TableHead className="col-action">Next step</TableHead>
                  <TableHead className="col-menu"><span className="sr-only">More actions</span></TableHead>
                </TableRow></TableHeader>
                {groups.map(group => {
                  const closed = collapsed.includes(group.id);
                  const rows = showAll.includes(group.id) ? group.items : group.items.slice(0, GROUP_LIMIT);
                  return <TableBody key={group.id} className="work-group">
                    {grouping !== 'none' && <TableRow className="work-group-row">
                      <TableHead scope="rowgroup" colSpan={columnCount}>
                        <button type="button" className="work-group-toggle" aria-expanded={!closed} onClick={() => setCollapsed(previous => toggle(previous, group.id))}>
                          <ChevronDown className={clsx('work-group-chevron', closed && 'is-collapsed')} aria-hidden="true" />{group.icon}<span className="work-group-label">{group.label}</span><span className="work-group-count">{group.items.length}</span>
                          {tickets && <span className="work-group-hours">{hours(group.items.reduce((sum, item) => sum + item.estimateHours, 0))} h</span>}
                        </button>
                      </TableHead>
                    </TableRow>}
                    {!closed && rows.map(item => <WorkRow key={item.id} item={item} data={data} day={day} admin={admin} showStatus={showStatus} showOwner={showOwner} onOpen={onOpen} onAction={onAction} onExtend={onExtend} onAddHours={onAddHours} busy={busy} />)}
                    {!closed && group.items.length > rows.length && <TableRow className="work-more-row"><TableCell colSpan={columnCount}><Button variant="ghost" size="sm" onClick={() => setShowAll(previous => [...previous, group.id])}>Show all {group.items.length}</Button></TableCell></TableRow>}
                  </TableBody>;
                })}
              </Table></div>}
      </div>
    </Card>
    <p className="list-hint"><CircleHelp size={14} aria-hidden="true" /><span>{tickets
      ? 'Pick a day, week, or month to see the tickets worked on then and the hours earned. A ticket earns its estimated hours when the admin approves it.'
      : `Bug points: fixed by the fix-by time earns 100, up to twice the target earns 50, later earns 0. Bug points are ${data.settings.bugWeight}% of the score.`}
      {' '}Press <Kbd>/</Kbd> to search{canAdd ? <>, <Kbd>C</Kbd> to add a {tickets ? 'ticket' : 'ticket or bug'}</> : ''}, and <Kbd>{searchKey}</Kbd> to find anything.</span></p>
  </>;
}

type RowProps = { item: WorkItem; data: DashboardData; day: string; admin: boolean; showStatus: boolean; showOwner: boolean; onOpen: (id: string) => void; onAction: OnAction; onExtend: (item: WorkItem) => void; onAddHours: (item: WorkItem) => void; busy: boolean };

/** One line per item: what it is, where it belongs, who owns it, when it is for, and its next step. */
function WorkRow({ item, data, day, admin, showStatus, showOwner, onOpen, onAction, onExtend, onAddHours, busy }: RowProps) {
  const owner = findMember(data, item.assigneeId);
  const project = findProject(data, item.projectId);
  const ticket = item.type === 'task';
  const late = ticket ? isCarriedOver(item, data) : getBugKpi(item, data).overdueHours > 0 && !isDone(item) && item.status !== 'fixed';
  // A click anywhere on the row opens it. Buttons and menus inside the row keep their own action.
  function openRow(event: MouseEvent<HTMLTableRowElement>) {
    if ((event.target as HTMLElement).closest('button, a, input, [role="menuitem"], [role="menu"]')) return;
    if (window.getSelection()?.toString()) return;
    onOpen(item.id);
  }
  return <TableRow className={clsx('work-row', isDone(item) && 'is-done', late && 'is-late')} onClick={openRow}>
    <TableCell className="col-main">
      <div className="work-main">
        <StatusIcon status={item.status} label />
        <span className="item-key">{item.key}</span>
        <Button variant="ghost" className="item-name" onClick={() => onOpen(item.id)}>{item.title}</Button>
        <ItemFlags item={item} data={data} />
      </div>
      {item.status === 'blocked' && item.blocker && <p className="work-blocker">{item.blocker}</p>}
      <p className="work-row-meta" aria-hidden="true">{[project?.name, admin ? firstName(owner) : null, ticket ? (item.dueDate ? displayDate(item.dueDate) : null) : `Fix by ${displayDateTime(getBugKpi(item, data).deadline1)}`, ticket ? `${item.estimateHours} h` : null].filter(Boolean).join(' · ')}</p>
    </TableCell>
    {showStatus && <TableCell className="col-status"><StatusBadge status={item.status} /></TableCell>}
    <TableCell className="col-project"><div className="project-phase-cell"><ProjectTag data={data} id={item.projectId} /><PhaseTag data={data} id={item.phaseId} /></div></TableCell>
    {showOwner && <TableCell className="col-owner"><span className="owner-cell"><Avatar member={owner} size="small" /><span>{firstName(owner)}</span></span></TableCell>}
    <TableCell className="col-estimate">{ticket ? <span className="estimate-cell">{item.estimateHours} h</span> : <SeverityBadge item={item} />}</TableCell>
    <TableCell className="col-date">{ticket ? <TicketDate item={item} day={day} timezone={data.settings.timezone} /> : <FixBy item={item} data={data} />}</TableCell>
    <TableCell className="col-priority"><PriorityMark priority={item.priority} /></TableCell>
    <TableCell className="col-action"><ItemActions item={item} admin={admin} onAction={onAction} busy={busy} /></TableCell>
    <TableCell className="col-menu"><ItemMenu item={item} data={data} onOpen={onOpen} onAction={onAction} onExtend={onExtend} onAddHours={onAddHours} busy={busy} /></TableCell>
  </TableRow>;
}

/** A done ticket shows the day it was done. Open work from an earlier day shows in red, because it carried over. */
function TicketDate({ item, day, timezone }: { item: WorkItem; day: string; timezone: string }) {
  const [planned, done] = [plannedDay(item, timezone), doneDay(item, timezone)];
  const late = !done && planned < day;
  const label = done ? `Done ${displayDate(done)}` : planned === day ? 'Today' : displayDate(planned);
  return <span className={clsx('due-date', late && 'due-overdue', !done && planned === day && 'due-today')} title={displayDate(planned, { weekday: 'long', day: 'numeric', month: 'long' })}><CalendarDays size={12} aria-hidden="true" />{label}{late && <span className="sr-only"> Not done yet</span>}</span>;
}
