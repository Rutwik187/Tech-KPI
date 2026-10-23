"use client";

import { useState, type CSSProperties } from 'react';
import { useSearchParams } from 'next/navigation';
import { ChevronLeft, ChevronRight, CircleHelp, Clock3, Columns3, List, Plus, Search, X } from 'lucide-react';
import type { DashboardData, WorkItem } from '@/lib/types';
import { getBugKpi } from '@/lib/kpi';
import { Avatar, EmptyState, FormCheckbox, FormField, FormSelect, PriorityBadge, StatusBadge } from '@/components/ui';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardFooter, CardHeader } from '@/components/ui/card';
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/components/ui/input-group';
import { Pagination, PaginationContent, PaginationItem } from '@/components/ui/pagination';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { attentionReason, bugStatuses, findMember, findProject, firstName, kindLabels, priorities, statusLabels, ticketStatuses, today, type OnAction } from './lib';
import { DueDate, FixBy, ItemActions, PhaseTag, ProjectTag, SeverityBadge, TicketCard } from './parts';

const PAGE_SIZE = 12;

export function WorkList({ data, kind, onOpen, onAction, onExtend, onAdd, busy }: { data: DashboardData; kind: 'task' | 'bug'; onOpen: (id: string) => void; onAction: OnAction; onExtend: (item: WorkItem) => void; onAdd: (kind: 'task' | 'bug') => void; busy: boolean }) {
  const query = useSearchParams();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('all');
  const [assignee, setAssignee] = useState(query.get('assignee') ?? 'all');
  const [projectId, setProjectId] = useState(query.get('project') ?? 'all');
  const [phaseFilter, setPhaseFilter] = useState(query.get('phase') ?? 'all');
  const [attentionOnly, setAttentionOnly] = useState(query.get('attention') === '1');
  const [view, setView] = useState<'list' | 'board'>('list');
  const [sort, setSort] = useState('recent');
  const [page, setPage] = useState(1);
  const admin = data.currentUser.role === 'admin';
  const canAdd = kind === 'task' || admin;
  const noun = kindLabels[kind].toLowerCase();
  const statuses = kind === 'task' ? ticketStatuses : bugStatuses;
  const day = today(data.settings.timezone);
  const ofKind = data.items.filter(item => item.type === kind);
  const deadline = (item: WorkItem) => item.type === 'bug' ? getBugKpi(item, data).deadline1.toISOString() : item.dueDate ?? '9999';

  const filtered = ofKind.filter(item =>
    (status === 'all' || item.status === status)
    && (assignee === 'all' || item.assigneeId === assignee)
    && (projectId === 'all' || item.projectId === projectId)
    && (phaseFilter === 'all' || (phaseFilter === 'adhoc' ? item.phaseId === null : item.phaseId === phaseFilter))
    && (!attentionOnly || attentionReason(item, data, day) !== null)
    && `${item.title} ${item.key} ${item.description}`.toLowerCase().includes(search.trim().toLowerCase()),
  ).sort((a, b) => sort === 'due' ? deadline(a).localeCompare(deadline(b))
    : sort === 'priority' ? priorities.indexOf(b.priority) - priorities.indexOf(a.priority)
    : b.createdAt.localeCompare(a.createdAt));
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount);
  const shown = filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);
  const filtering = search || status !== 'all' || assignee !== 'all' || projectId !== 'all' || phaseFilter !== 'all' || attentionOnly;
  function changeFilter(change: () => void) { change(); setPage(1); }
  function clearFilters() { setSearch(''); setStatus('all'); setAssignee('all'); setProjectId('all'); setPhaseFilter('all'); setAttentionOnly(false); setPage(1); }

  const empty = <EmptyState
    bug={kind === 'bug'}
    title={ofKind.length ? 'No matches' : kind === 'task' ? 'No tickets yet' : 'No bugs. Nice.'}
    description={ofKind.length ? 'Try another search or clear your filters.' : kind === 'task' ? admin ? 'Add a ticket with a title, project, owner, and estimate.' : 'Request a ticket for new work. Your admin approves it, or assigns tickets to you.' : admin ? 'Log a bug when you find one. Its fix-by time starts at once.' : 'Bugs assigned to you will appear here.'}
    action={canAdd && !ofKind.length ? <Button onClick={() => onAdd(kind)}><Plus data-icon="inline-start" size={15} />{kind === 'task' ? admin ? 'New ticket' : 'Request ticket' : 'Log bug'}</Button> : undefined}
  />;

  return <>
    <ToggleGroup type="single" variant="outline" value={status === 'all' ? '' : status} onValueChange={value => changeFilter(() => setStatus(value || 'all'))} className="list-summary" aria-label="Filter by status">
      {statuses.map(s => <ToggleGroupItem key={s} value={s}><span className={`summary-dot dot-${s}`} />{statusLabels[s]}<Badge variant="secondary">{ofKind.filter(item => item.status === s).length}</Badge></ToggleGroupItem>)}
    </ToggleGroup>
    <Card className="work-list-panel">
      <CardHeader className="work-list-heading p-0">
        <div className="list-toolbar">
          <InputGroup className="search-control"><InputGroupAddon><Search /></InputGroupAddon><InputGroupInput aria-label={`Search ${noun}s`} placeholder={`Search ${noun}s by title or key…`} value={search} onChange={event => changeFilter(() => setSearch(event.target.value))} /></InputGroup>
          <div className="filter-controls">
            {admin && <FormSelect aria-label="Filter by owner" value={assignee} onValueChange={value => changeFilter(() => setAssignee(value))}><option value="all">Everyone</option>{data.members.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}</FormSelect>}
            <FormSelect aria-label="Filter by project" value={projectId} onValueChange={value => changeFilter(() => { setProjectId(value); setPhaseFilter('all'); })}><option value="all">All projects</option>{data.projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</FormSelect>
            <FormSelect aria-label="Filter by phase" value={phaseFilter} onValueChange={value => changeFilter(() => setPhaseFilter(value))}><option value="all">All phases</option><option value="adhoc">Ad hoc</option>{data.phases.filter(phase => projectId === 'all' || phase.projectId === projectId).map(phase => <option key={phase.id} value={phase.id}>{projectId === 'all' ? `${findProject(data, phase.projectId)?.name} · ` : ''}{phase.name}</option>)}</FormSelect>
            <FormSelect aria-label={`Sort ${noun}s`} value={sort} onValueChange={setSort}><option value="recent">Newest first</option><option value="due">{kind === 'task' ? 'Due date' : 'Fix-by time'}</option><option value="priority">Priority</option></FormSelect>
            <ToggleGroup type="single" variant="outline" spacing={0} value={view} onValueChange={value => { if (value) setView(value as 'list' | 'board'); }} aria-label="Choose view"><ToggleGroupItem value="list" aria-label="List view"><List /></ToggleGroupItem><ToggleGroupItem value="board" aria-label="Board view"><Columns3 /></ToggleGroupItem></ToggleGroup>
          </div>
        </div>
        <div className="filter-meta">
          <span><strong>{filtered.length}</strong> {noun}{filtered.length === 1 ? '' : 's'}{status !== 'all' && ` · ${statusLabels[status as WorkItem['status']]}`}</span>
          <FormField className="checkbox-label"><FormCheckbox checked={attentionOnly} onCheckedChange={checked => changeFilter(() => setAttentionOnly(checked))} />Needs attention only</FormField>
          {filtering && <Button variant="link" size="sm" onClick={clearFilters}>Clear filters<X data-icon="inline-end" size={12} /></Button>}
        </div>
      </CardHeader>
      <CardContent className="work-list-content p-0">
        {filtered.length === 0 ? empty
          : view === 'board'
            ? <div className="kanban-board" style={{ '--columns': status === 'all' ? statuses.length : 1 } as CSSProperties}>{statuses.filter(s => status === 'all' || status === s).map(s => {
                const column = filtered.filter(item => item.status === s);
                return <div className="kanban-column" key={s}>
                  <div className={`kanban-heading kanban-${s}`}><span><i className={`dot-${s}`} />{statusLabels[s]}</span><Badge variant="secondary">{column.length}</Badge></div>
                  <div className="kanban-items">{column.map(item => <TicketCard key={item.id} item={item} data={data} onOpen={onOpen} onAction={onAction} onExtend={onExtend} busy={busy} />)}{column.length === 0 && <div className="kanban-empty">Nothing here</div>}</div>
                </div>;
              })}</div>
            : <div className="table-scroll"><Table className="data-table work-table">
                <TableHeader><TableRow>
                  <TableHead>{kindLabels[kind]}</TableHead><TableHead>Status</TableHead>{admin && <TableHead>Owner</TableHead>}<TableHead>Project · phase</TableHead>
                  <TableHead>{kind === 'task' ? 'Estimate' : 'Severity'}</TableHead><TableHead>{kind === 'task' ? 'Due date' : 'Fix by'}</TableHead><TableHead>Next step</TableHead>
                </TableRow></TableHeader>
                <TableBody>{shown.map(item => <TableRow key={item.id}>
                  <TableCell><div className="work-name-cell"><span className="item-key">{item.key}</span><Button variant="ghost" className="item-name" onClick={() => onOpen(item.id)}>{item.title}</Button><PriorityBadge priority={item.priority} /></div></TableCell>
                  <TableCell><StatusBadge status={item.status} /></TableCell>
                  {admin && <TableCell><div className="owner-cell"><Avatar member={findMember(data, item.assigneeId)} size="small" /><span>{firstName(findMember(data, item.assigneeId))}</span></div></TableCell>}
                  <TableCell><div className="project-phase-cell"><ProjectTag data={data} id={item.projectId} /><PhaseTag data={data} id={item.phaseId} /></div></TableCell>
                  <TableCell>{kind === 'task' ? <span className="estimate-cell"><Clock3 size={12} />{item.estimateHours} h</span> : <SeverityBadge item={item} />}</TableCell>
                  <TableCell>{kind === 'task' ? <DueDate item={item} data={data} onExtend={onExtend} /> : <FixBy item={item} data={data} />}</TableCell>
                  <TableCell><ItemActions item={item} admin={admin} onAction={onAction} busy={busy} /></TableCell>
                </TableRow>)}</TableBody>
              </Table></div>}
      </CardContent>
      {view === 'list' && filtered.length > PAGE_SIZE && <CardFooter className="pagination">
        <span>Showing {(currentPage - 1) * PAGE_SIZE + 1}–{Math.min(currentPage * PAGE_SIZE, filtered.length)} of {filtered.length}</span>
        <Pagination className="mx-0 w-auto"><PaginationContent>
          <PaginationItem><Button variant="ghost" size="icon" aria-label="Previous page" disabled={currentPage <= 1} onClick={() => setPage(currentPage - 1)}><ChevronLeft /></Button></PaginationItem>
          <PaginationItem><span className="px-2">Page {currentPage} of {pageCount}</span></PaginationItem>
          <PaginationItem><Button variant="ghost" size="icon" aria-label="Next page" disabled={currentPage >= pageCount} onClick={() => setPage(currentPage + 1)}><ChevronRight /></Button></PaginationItem>
        </PaginationContent></Pagination>
      </CardFooter>}
    </Card>
    <div className="list-hint"><CircleHelp size={14} />{kind === 'task'
      ? 'Open a ticket to see its history, extend its due date with a reason, or mark it blocked. A ticket earns its estimated hours when the admin approves it.'
      : `Bug points: fixed by the fix-by time earns 100, up to twice the target earns 50, later earns 0. Bug points are ${data.settings.bugWeight}% of the score. Bugs add no ticket hours.`}</div>
  </>;
}
