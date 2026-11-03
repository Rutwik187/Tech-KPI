"use client";

import type { ReactNode } from 'react';
import Link from 'next/link';
import clsx from 'clsx';
import { Activity as ActivityIcon, ArrowRight, ArrowUpRight, Bug, CalendarClock, CalendarDays, Check, CheckCheck, ChevronDown, CircleCheck, Clock3, Hourglass, ListTodo, Plus, ShieldCheck, Sun, TriangleAlert, WandSparkles } from 'lucide-react';
import type { DashboardData, WorkItem } from '@/lib/types';
import { calculateMemberKpi, dateKey, getBugKpi, getMemberTrend, getTeamTrend, getWeekStart, shiftDate, type calculateTeamKpi } from '@/lib/kpi';
import { Avatar, EmptyState, Panel, ProgressBar, StatusIcon } from '@/components/ui';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { attentionItems, attentionReason, bands, displayDate, displayDateTime, firstName, findMember, findProject, hours, isAdhocProject, isDone, percent, routeFor, statusLabels, ticketStatuses, today, type OnAction } from './lib';
import { ItemFlags, ItemMenu, MetricCard, ScoreBadge, ScoreExplainer, ItemActions } from './parts';
import { TrendChart } from './charts';
import { Highlights, onTargetStreak, StreakBadge } from './engagement';
import { plural, ProjectTimelines } from './timeline';

type TeamScores = ReturnType<typeof calculateTeamKpi>;
type DashboardProps = { data: DashboardData; week: string; scores: TeamScores; onOpen: (id: string) => void; onOpenProject: (id: string) => void; onAction: OnAction; onExtend: (item: WorkItem) => void; onAddHours: (item: WorkItem) => void; onAdd: (kind: 'task' | 'bug') => void; busy: boolean };

export function Dashboard({ data, week, scores, onOpen, onOpenProject, onAction, onExtend, onAddHours, onAdd, busy }: DashboardProps) {
  const isAdmin = data.currentUser.role === 'admin';
  const own = calculateMemberKpi(data.currentUser, data, week);
  const currentWeek = getWeekStart(new Date(), data.settings.timezone);
  const current = week === currentWeek;
  const open = data.items.filter(item => !isDone(item));
  const openTickets = open.filter(item => item.type === 'task');
  const openBugs = open.filter(item => item.type === 'bug' && (item.status === 'open' || item.status === 'in_progress'));
  const criticalBugs = openBugs.filter(item => item.severity === 'critical').length;
  const attention = attentionItems(data);
  const done = isAdmin ? scores.creditedHours : own.creditedHours;
  const atWork = isAdmin ? scores.capacityHours : own.capacityHours;
  const fullWeek = isAdmin ? scores.weekCapacityHours : own.weekCapacityHours;
  const efficiency = isAdmin ? scores.teamEfficiency : own.efficiency;
  const band = isAdmin ? scores.band : own.band;
  const trend = isAdmin ? getTeamTrend(data, week, 8) : getMemberTrend(data.currentUser, data, week, 8);
  const count = (status: WorkItem['status']) => openTickets.filter(item => item.status === status).length;
  const hasTimelines = data.projects.some(p => !p.isArchived && !isAdhocProject(p));
  const ticketsLink = (query: string) => routeFor(data, `tickets?${query}`);

  const metrics = <div className="metrics-grid">
    <MetricCard label={isAdmin ? 'Team efficiency' : 'Your efficiency'} value={percent(efficiency)} primary icon={<ActivityIcon size={16} />} detail={<span className={`metric-band metric-band-${band}`}><i />{bands[band]} · target {data.settings.bandOnTarget}%</span>}>
      <div className="metric-sparkline" aria-hidden="true">{trend.map((point, index) => <i key={point.weekStart} title={point.efficiency === null ? 'No data' : percent(point.efficiency)} style={{ height: `${point.efficiency === null ? 6 : Math.max(12, point.efficiency)}%`, opacity: index === trend.length - 1 ? 1 : .25 + index * .08 }} />)}</div>
    </MetricCard>
    <MetricCard label="Ticket hours done" value={<>{hours(done)}<span className="metric-unit"> h</span></>} icon={<Clock3 size={16} />} detail={<>of {hours(atWork)} h at work{current ? ' so far' : ''}{current && fullWeek !== atWork && <span className="metric-subtle">{hours(fullWeek)} h in the full week</span>}</>}>
      <ProgressBar value={atWork ? done / atWork * 100 : 0} label="Ticket hours done compared with hours at work" />
    </MetricCard>
    <MetricCard label="Open tickets" value={openTickets.length} icon={<ListTodo size={16} />} detail={<span className="metric-links">
      <Link href={ticketsLink('status=in_progress')}><span className="muted-number">{count('in_progress')}</span> in progress</Link> · <Link href={ticketsLink('status=in_review')}><span className="muted-number">{count('in_review')}</span> in review</Link> · <Link href={ticketsLink('status=blocked')} className={clsx(count('blocked') > 0 && 'critical-text')}><span className="muted-number">{count('blocked')}</span> blocked</Link>
    </span>}>
      <div className="metric-task-dots" aria-hidden="true">{ticketStatuses.slice(0, -1).map(status => <span key={status} className={`dot-${status}`} style={{ flex: Math.max(1, count(status)) }} />)}</div>
    </MetricCard>
    <MetricCard label="Open bugs" value={openBugs.length} icon={<Bug size={16} />} detail={criticalBugs > 0 ? <Link className="critical-text" href={routeFor(data, 'bugs')}>{criticalBugs} critical</Link> : `${open.filter(item => item.status === 'fixed').length} fixed, waiting for verification`}>
      <div className="bug-metric-meta"><ShieldCheck size={13} />{percent(isAdmin ? scores.bugScore : own.bugScore)} bug points this week</div>
    </MetricCard>
  </div>;

  if (!isAdmin) return <>
    {metrics}
    <div className="dashboard-split">
      <MyWork data={data} onOpen={onOpen} onAction={onAction} onExtend={onExtend} onAddHours={onAddHours} onAdd={onAdd} busy={busy} />
      <div className="dashboard-side">
        <MyRequests data={data} />
        <Panel title="Your efficiency by week" className="trend-panel"><TrendChart trend={trend} target={data.settings.bandOnTarget} currentWeek={currentWeek} /></Panel>
        <Collapsible className="panel score-explainer">
          <CollapsibleTrigger asChild><button type="button" className="collapsible-heading"><span>How your score works</span><ChevronDown aria-hidden="true" /></button></CollapsibleTrigger>
          <CollapsibleContent><ScoreExplainer kpi={own} data={data} current={current} /></CollapsibleContent>
        </Collapsible>
      </div>
    </div>
    {hasTimelines && <Panel title="Project timelines" action={<Button variant="link" size="sm" asChild><Link href={routeFor(data, 'projects')}>All projects<ArrowUpRight data-icon="inline-end" size={14} /></Link></Button>} className="timelines-panel">
      <ProjectTimelines data={data} onOpen={onOpenProject} />
    </Panel>}
  </>;

  return <>
    {metrics}
    <Highlights data={data} week={week} scores={scores.developers} />
    <div className="dashboard-middle">
      <Panel title="Needs attention" count={attention.length} className="attention-panel" action={attention.length > 0 && <Button variant="link" size="sm" asChild><Link href={ticketsLink('attention=1')}>See all<ArrowUpRight data-icon="inline-end" size={14} /></Link></Button>}>
        {attention.length === 0
          ? <EmptyState compact title="Nothing needs attention" description="No reviews, blocked tickets, late work, or late bugs." />
          : <div className="attention-list">{attention.slice(0, 6).map(({ item, reason }) => <AttentionRow key={item.id} data={data} item={item} reason={reason} onOpen={onOpen} onAction={onAction} onExtend={onExtend} busy={busy} />)}</div>}
        {attention.length > 6 && <Link className="panel-bottom-link" href={ticketsLink('attention=1')}>See all {attention.length}<ArrowRight size={14} /></Link>}
      </Panel>
      <Panel title="Team efficiency by week" action={<Badge variant="outline" className="subtle-tag">Since scores started</Badge>} className="trend-panel">
        <TrendChart trend={trend} target={data.settings.bandOnTarget} currentWeek={currentWeek} />
      </Panel>
    </div>

    <Panel title="Team this week" count={scores.developers.length} action={<Button variant="link" size="sm" asChild><Link href={routeFor(data, 'team')}>Manage team<ArrowUpRight data-icon="inline-end" size={14} /></Link></Button>} className="team-pulse-panel">
      <TeamTable data={data} scores={scores} current={current} />
    </Panel>

    {hasTimelines && <Panel title="Project timelines" action={<Button variant="link" size="sm" asChild><Link href={routeFor(data, 'projects')}>All projects<ArrowUpRight data-icon="inline-end" size={14} /></Link></Button>} className="timelines-panel">
      <ProjectTimelines data={data} onOpen={onOpenProject} />
    </Panel>}

    {data.items.length === 0 && <Card className="getting-started">
      <span className="empty-icon"><WandSparkles size={23} /></span>
      <div><h3>Set up your workspace</h3><p>Add your developers, create a project with phases, then add the first ticket.</p></div>
      <Button variant="outline" asChild><Link href={routeFor(data, 'team')}>Add team<ArrowRight data-icon="inline-end" size={14} /></Link></Button>
      <Button onClick={() => onAdd('task')}><Plus data-icon="inline-start" size={15} />New ticket</Button>
    </Card>}
  </>;
}

type WorkGroup = { id: string; label: string; icon: ReactNode; items: WorkItem[] };

/** A developer's day in one list: what needs attention, what is for today, what is next, and what waits for review. */
function MyWork({ data, onOpen, onAction, onExtend, onAddHours, onAdd, busy }: Pick<DashboardProps, 'data' | 'onOpen' | 'onAction' | 'onExtend' | 'onAddHours' | 'onAdd' | 'busy'>) {
  const day = today(data.settings.timezone);
  const mine = data.items.filter(item => item.assigneeId === data.currentUser.id && !isDone(item));
  const reasons = new Map(mine.map(item => [item.id, attentionReason(item, data, day)]));
  const waiting = (item: WorkItem) => item.status === 'in_review' || item.status === 'fixed';
  const urgent = (item: WorkItem) => !waiting(item) && !!reasons.get(item.id) && reasons.get(item.id) !== 'For today';
  const forToday = (item: WorkItem) => !waiting(item) && !urgent(item) && (item.type === 'task' ? item.dueDate === day : dateKey(getBugKpi(item, data).deadline1, data.settings.timezone) <= day);
  const when = (item: WorkItem) => item.type === 'task' ? item.dueDate ?? item.createdAt.slice(0, 10) : getBugKpi(item, data).deadline1.toISOString();
  const byDate = (a: WorkItem, b: WorkItem) => when(a).localeCompare(when(b));
  const groups: WorkGroup[] = [
    { id: 'attention', label: 'Needs attention', icon: <TriangleAlert aria-hidden="true" />, items: mine.filter(urgent) },
    { id: 'today', label: 'Today', icon: <Sun aria-hidden="true" />, items: mine.filter(forToday) },
    { id: 'next', label: 'Up next', icon: <CalendarDays aria-hidden="true" />, items: mine.filter(item => !waiting(item) && !urgent(item) && !forToday(item)) },
    { id: 'waiting', label: 'Waiting for review', icon: <Hourglass aria-hidden="true" />, items: mine.filter(waiting) },
  ].map(group => ({ ...group, items: group.items.sort(byDate) })).filter(group => group.items.length > 0);
  return <Panel title="My work" count={mine.length} className="my-work-panel" action={<Button variant="link" size="sm" asChild><Link href={routeFor(data, 'tickets')}>All my tickets<ArrowUpRight data-icon="inline-end" size={14} /></Link></Button>}>
    {mine.length === 0
      ? <EmptyState title="No open work" description="Request a ticket for new work, or wait for your admin to assign one." action={<Button onClick={() => onAdd('task')}><Plus data-icon="inline-start" />Request ticket</Button>} />
      : groups.map(group => <section key={group.id} className={clsx('my-work-group', `my-work-${group.id}`)} aria-label={group.label}>
          <h3 className="my-work-heading">{group.icon}{group.label}<span>{group.items.length}</span></h3>
          <ul className="my-work-list">{group.items.map(item => <li key={item.id}><MyWorkRow data={data} item={item} reason={group.id === 'attention' ? reasons.get(item.id) ?? null : null} onOpen={onOpen} onAction={onAction} onExtend={onExtend} onAddHours={onAddHours} busy={busy} /></li>)}</ul>
        </section>)}
  </Panel>;
}

function MyWorkRow({ data, item, reason, onOpen, onAction, onExtend, onAddHours, busy }: { data: DashboardData; item: WorkItem; reason: string | null } & Pick<DashboardProps, 'onOpen' | 'onAction' | 'onExtend' | 'onAddHours' | 'busy'>) {
  const project = findProject(data, item.projectId);
  const day = today(data.settings.timezone);
  const late = item.type === 'task' && !!item.dueDate && item.dueDate < day;
  return <div className="my-work-row">
    <StatusIcon status={item.status} label />
    <div className="my-work-main">
      <div className="my-work-title"><span className="item-key">{item.key}</span><Button variant="ghost" className="item-name" onClick={() => onOpen(item.id)}>{item.title}</Button><ItemFlags item={item} data={data} severity /></div>
      <div className="my-work-meta">
        {reason && <span className="my-work-reason">{reason}</span>}
        <span className="project-tag"><i style={{ background: project?.color }} aria-hidden="true" /><span>{project?.name ?? 'Unknown project'}</span></span>
        {item.type === 'task'
          ? <><span className={clsx('due-date', late && 'due-overdue')}><CalendarDays size={12} aria-hidden="true" />{item.dueDate ? item.dueDate === day ? 'Today' : displayDate(item.dueDate) : 'No date'}</span><span className="estimate-cell"><Clock3 size={12} aria-hidden="true" />{item.estimateHours} h</span></>
          : <span className="bug-clock"><Clock3 size={12} aria-hidden="true" />Fix by {displayDateTime(getBugKpi(item, data).deadline1)}</span>}
      </div>
    </div>
    <div className="my-work-actions"><ItemActions item={item} admin={false} onAction={onAction} busy={busy} /><ItemMenu item={item} data={data} onOpen={onOpen} onAction={onAction} onExtend={onExtend} onAddHours={onAddHours} busy={busy} /></div>
  </div>;
}

/** A developer's open asks: ticket requests and more hours that still wait for the admin. */
function MyRequests({ data }: { data: DashboardData }) {
  const requests = data.requests.filter(r => r.status === 'pending').length;
  const extensions = data.dueDateRequests.filter(r => r.status === 'pending').length;
  // Decisions from the last seven days, so a developer sees news without opening Approvals.
  const timezone = data.settings.timezone;
  const weekAgo = shiftDate(today(timezone), -7, timezone);
  const decided = data.requests.filter(r => r.status !== 'pending' && r.reviewedAt && dateKey(r.reviewedAt, timezone) >= weekAgo);
  if (!requests && !extensions && !decided.length) return null;
  return <Panel title="Your requests" className="my-requests" action={<Button variant="link" size="sm" asChild><Link href={routeFor(data, 'approvals')}>Approvals<ArrowUpRight data-icon="inline-end" size={14} /></Link></Button>}>
    <ul className="my-requests-list">
      {requests > 0 && <li><Hourglass aria-hidden="true" /><span><strong>{requests}</strong> ticket {requests === 1 ? 'request waits' : 'requests wait'} for approval</span></li>}
      {extensions > 0 && <li><CalendarClock aria-hidden="true" /><span><strong>{extensions}</strong> {extensions === 1 ? 'ask' : 'asks'} for more hours {extensions === 1 ? 'waits' : 'wait'} for approval</span></li>}
      {decided.slice(0, 3).map(request => <li key={request.id} className={`my-request-${request.status}`}>{request.status === 'approved' ? <CircleCheck aria-hidden="true" /> : <TriangleAlert aria-hidden="true" />}<span>{request.status === 'approved' ? 'Approved' : 'Declined'}: {request.title}</span></li>)}
    </ul>
  </Panel>;
}

function AttentionRow({ data, item, reason, onOpen, onAction, onExtend, busy }: { data: DashboardData; item: WorkItem; reason: string; onOpen: (id: string) => void; onAction: OnAction; onExtend: (item: WorkItem) => void; busy: boolean }) {
  const admin = data.currentUser.role === 'admin';
  const review = item.status === 'in_review';
  const verify = item.status === 'fixed';
  const overdue = item.type === 'task' && !!item.dueDate && item.dueDate < today(data.settings.timezone) && item.status !== 'blocked';
  const canExtend = overdue && (admin || item.assigneeId === data.currentUser.id);
  const tone = review || verify ? 'attention-review' : item.status === 'blocked' ? 'attention-blocked' : 'attention-urgent';
  const owner = findMember(data, item.assigneeId);
  return <div className={clsx('attention-row', tone)}>
    <StatusIcon status={item.status} label />
    <div className="attention-content">
      <div className="attention-title"><span className="item-key">{item.key}</span><Button variant="ghost" className="item-name" onClick={() => onOpen(item.id)}>{item.title}</Button></div>
      <div className="attention-meta"><span className="attention-reason">{reason}</span>{admin && <span className="attention-owner"><Avatar member={owner} size="small" />{firstName(owner)}</span>}</div>
    </div>
    {admin && review ? <Button size="sm" className="next-step-decision" disabled={busy} onClick={() => onAction(item, 'done')}><Check data-icon="inline-start" size={13} />Approve</Button>
      : admin && verify ? <Button size="sm" className="next-step-decision" disabled={busy} onClick={() => onAction(item, 'verified')}><CheckCheck data-icon="inline-start" size={13} />Verify</Button>
      : canExtend ? <Button variant="outline" size="sm" disabled={busy} onClick={() => onExtend(item)}><CalendarClock data-icon="inline-start" size={13} />Extend</Button>
      : <Button variant="ghost" size="icon-sm" aria-label={`Open ${item.title}`} onClick={() => onOpen(item.id)}><ArrowUpRight size={16} /></Button>}
  </div>;
}

export function TeamTable({ data, scores, current }: { data: DashboardData; scores: TeamScores; current: boolean }) {
  const rows = scores.developers;
  if (rows.length === 0) return <EmptyState title="No developers yet" description="Add developers to see their tickets, hours, and scores." action={<Button variant="outline" asChild><Link href={routeFor(data, 'team')}>Add your team<ArrowRight data-icon="inline-end" size={14} /></Link></Button>} />;
  return <div className="table-scroll"><Table className="data-table team-table">
    <TableHeader><TableRow><TableHead>Developer</TableHead><TableHead>Ticket hours done</TableHead><TableHead>Open tickets</TableHead><TableHead>Bug points</TableHead><TableHead>Efficiency</TableHead><TableHead><span className="sr-only">Open</span></TableHead></TableRow></TableHeader>
    <TableBody>{rows.map(row => {
      const tickets = data.items.filter(item => item.assigneeId === row.memberId && item.type === 'task' && !isDone(item));
      return <TableRow key={row.memberId}>
        <TableCell><div className="person-cell"><Avatar member={row.member} /><div><strong>{row.member.name}<StreakBadge weeks={onTargetStreak(row.member, data)} /></strong><span>{plural(row.openTasks, 'open ticket')} · {plural(row.openBugs, 'open bug')}</span></div></div></TableCell>
        <TableCell><div className="capacity-cell"><div><strong>{hours(row.creditedHours)}<span> / {hours(row.capacityHours)} h{current ? ' so far' : ''}</span></strong><span>{Math.round(row.deliveryRaw)}%</span></div><ProgressBar value={row.deliveryRaw} color={row.deliveryRaw >= data.settings.bandOnTarget ? 'green' : 'neutral'} label={`${row.member.name} ticket hours`} /></div></TableCell>
        <TableCell><div className="work-in-flight">{(['todo', 'in_progress', 'in_review', 'blocked'] as const).map(status => {
          const n = tickets.filter(item => item.status === status).length;
          return n > 0 && <span key={status} title={`${n} ${statusLabels[status]}`} className={`flight-${status}`}><StatusIcon status={status} />{n} {statusLabels[status].toLowerCase()}</span>;
        })}{tickets.length === 0 && <span className="cell-muted">None open</span>}</div></TableCell>
        <TableCell className="number-cell">{percent(row.bugScore)}{row.bugsScored > 0 && <span className="cell-subtext">{row.bugsScored} scored</span>}</TableCell>
        <TableCell><ScoreBadge score={row.efficiency} band={row.band} /></TableCell>
        <TableCell><Button variant="ghost" size="icon-sm" asChild><Link aria-label={`View ${row.member.name}'s tickets`} href={routeFor(data, `tickets?assignee=${row.memberId}`)}><ArrowUpRight size={16} /></Link></Button></TableCell>
      </TableRow>;
    })}</TableBody>
  </Table></div>;
}
