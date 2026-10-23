"use client";

import Link from 'next/link';
import clsx from 'clsx';
import { Activity as ActivityIcon, ArrowRight, ArrowUpRight, Bug, CalendarClock, Check, CheckCheck, Clock3, Eye, Flag, ListTodo, Plus, ShieldCheck, WandSparkles } from 'lucide-react';
import type { DashboardData, WorkItem } from '@/lib/types';
import { calculateMemberKpi, getMemberTrend, getTeamTrend, getWeekStart, type calculateTeamKpi } from '@/lib/kpi';
import { Avatar, EmptyState, Panel, ProgressBar } from '@/components/ui';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { attentionItems, bands, firstName, findMember, hours, isAdhocProject, isDone, percent, routeFor, statusLabels, ticketStatuses, today, type OnAction } from './lib';
import { MetricCard, ScoreBadge, ScoreExplainer, TicketCard } from './parts';
import { TrendChart } from './charts';
import { Highlights, onTargetStreak, StreakBadge } from './engagement';
import { plural, ProjectTimelines } from './timeline';

type TeamScores = ReturnType<typeof calculateTeamKpi>;
type DashboardProps = { data: DashboardData; week: string; scores: TeamScores; onOpen: (id: string) => void; onOpenProject: (id: string) => void; onAction: OnAction; onExtend: (item: WorkItem) => void; onAdd: (kind: 'task' | 'bug') => void; busy: boolean };

export function Dashboard({ data, week, scores, onOpen, onOpenProject, onAction, onExtend, onAdd, busy }: DashboardProps) {
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

  return <>
    <div className="metrics-grid">
      <MetricCard label={isAdmin ? 'Team efficiency' : 'Your efficiency'} value={percent(efficiency)} primary icon={<ActivityIcon size={17} />} detail={<span className={`metric-band metric-band-${band}`}><i />{bands[band]} · target {data.settings.bandOnTarget}%</span>}>
        <div className="metric-sparkline" aria-hidden="true">{trend.map((point, index) => <i key={point.weekStart} title={point.efficiency === null ? 'No data' : percent(point.efficiency)} style={{ height: `${point.efficiency === null ? 6 : Math.max(12, point.efficiency)}%`, opacity: index === trend.length - 1 ? 1 : .25 + index * .08 }} />)}</div>
      </MetricCard>
      <MetricCard label="Ticket hours done" value={<>{hours(done)}<span className="metric-unit"> h</span></>} icon={<Clock3 size={17} />} detail={<>of {hours(atWork)} h at work{current ? ' so far' : ''}{current && fullWeek !== atWork && <span className="metric-subtle">{hours(fullWeek)} h in the full week</span>}</>}>
        <ProgressBar value={atWork ? done / atWork * 100 : 0} label="Ticket hours done compared with hours at work" />
      </MetricCard>
      <MetricCard label="Open tickets" value={openTickets.length} icon={<ListTodo size={17} />} detail={<><span className="muted-number">{count('in_progress')}</span> in progress · <span className="muted-number">{count('in_review')}</span> in review · <span className="muted-number">{count('blocked')}</span> blocked</>}>
        <div className="metric-task-dots" aria-hidden="true">{ticketStatuses.slice(0, -1).map(status => <span key={status} className={`dot-${status}`} style={{ flex: Math.max(1, count(status)) }} />)}</div>
      </MetricCard>
      <MetricCard label="Open bugs" value={openBugs.length} icon={<Bug size={17} />} detail={criticalBugs > 0 ? <span className="critical-text">{criticalBugs} critical</span> : `${open.filter(item => item.status === 'fixed').length} fixed, waiting for verification`}>
        <div className="bug-metric-meta"><ShieldCheck size={13} />{percent(isAdmin ? scores.bugScore : own.bugScore)} bug points this week</div>
      </MetricCard>
    </div>

    <Highlights data={data} week={week} scores={isAdmin ? scores.developers : [own]} />

    <div className="dashboard-middle">
      <Panel title="Needs attention" action={<Badge variant="outline" className="count-pill">{attention.length}</Badge>} className="attention-panel">
        {attention.length === 0
          ? <EmptyState title="Nothing needs attention" description={isAdmin ? 'No reviews, blocked tickets, late work, or late bugs.' : 'No blocked, late, or returned work.'} />
          : <div className="attention-list">{attention.slice(0, 5).map(({ item, reason }) => <AttentionRow key={item.id} data={data} item={item} reason={reason} onOpen={onOpen} onAction={onAction} onExtend={onExtend} busy={busy} />)}</div>}
        {attention.length > 5 && <Link className="panel-bottom-link" href={routeFor(data, 'tickets?attention=1')}>See all {attention.length}<ArrowRight size={14} /></Link>}
      </Panel>
      <Panel title={isAdmin ? 'Team efficiency by week' : 'Your efficiency by week'} action={<Badge variant="outline" className="subtle-tag">Since scores started</Badge>} className="trend-panel">
        <TrendChart trend={trend} target={data.settings.bandOnTarget} currentWeek={currentWeek} />
      </Panel>
    </div>

    {hasTimelines && <Panel title="Project timelines" action={<Button variant="link" size="sm" asChild><Link href={routeFor(data, 'projects')}>All projects<ArrowUpRight data-icon="inline-end" size={14} /></Link></Button>} className="timelines-panel">
      <ProjectTimelines data={data} onOpen={onOpenProject} />
    </Panel>}

    {isAdmin
      ? <Panel title="Team this week" action={<Button variant="link" size="sm" asChild><Link href={routeFor(data, 'team')}>Manage team<ArrowUpRight data-icon="inline-end" size={14} /></Link></Button>} className="team-pulse-panel">
          <TeamTable data={data} scores={scores} current={current} />
          <div className="team-table-footer"><span><i />{plural(scores.developers.length, 'developer')}</span></div>
        </Panel>
      : <>
          <Panel title="My open tickets" action={<Button variant="link" size="sm" asChild><Link href={routeFor(data, 'tickets')}>All my tickets<ArrowUpRight data-icon="inline-end" size={14} /></Link></Button>}>
            {openTickets.length === 0
              ? <EmptyState title="No open tickets" description="Request a ticket for new work, or wait for your admin to assign one." action={<Button onClick={() => onAdd('task')}><Plus data-icon="inline-start" />Request ticket</Button>} />
              : <div className="my-task-grid">{openTickets.slice(0, 6).map(item => <TicketCard key={item.id} data={data} item={item} onOpen={onOpen} onAction={onAction} onExtend={onExtend} busy={busy} />)}</div>}
          </Panel>
          <Panel title="How my score works" className="score-explainer"><ScoreExplainer kpi={own} data={data} current={current} /></Panel>
        </>}

    {data.items.length === 0 && isAdmin && <Card className="getting-started">
      <span className="empty-icon"><WandSparkles size={23} /></span>
      <div><h3>Set up your workspace</h3><p>Add your developers, create a project with phases, then add the first ticket.</p></div>
      <Button variant="outline" asChild><Link href={routeFor(data, 'team')}>Add team<ArrowRight data-icon="inline-end" size={14} /></Link></Button>
      <Button onClick={() => onAdd('task')}><Plus data-icon="inline-start" size={15} />New ticket</Button>
    </Card>}
  </>;
}

function AttentionRow({ data, item, reason, onOpen, onAction, onExtend, busy }: { data: DashboardData; item: WorkItem; reason: string; onOpen: (id: string) => void; onAction: OnAction; onExtend: (item: WorkItem) => void; busy: boolean }) {
  const admin = data.currentUser.role === 'admin';
  const review = item.status === 'in_review';
  const verify = item.status === 'fixed';
  const overdue = item.type === 'task' && !!item.dueDate && item.dueDate < today(data.settings.timezone) && item.status !== 'blocked';
  const canExtend = overdue && (admin || item.assigneeId === data.currentUser.id);
  const tone = review || verify ? 'attention-review' : item.status === 'blocked' ? 'attention-blocked' : 'attention-urgent';
  return <div className="attention-row">
    <span className={clsx('attention-icon', tone)}>{review || verify ? <Eye size={17} /> : item.type === 'bug' ? <Bug size={17} /> : <Flag size={17} />}</span>
    <div className="attention-content">
      <Button variant="ghost" className="item-name" onClick={() => onOpen(item.id)}>{item.title}</Button>
      <div><span className="attention-reason">{reason}</span>{admin && <span className="attention-owner">{firstName(findMember(data, item.assigneeId))}</span>}</div>
    </div>
    {admin && review ? <Button variant="secondary" size="sm" disabled={busy} onClick={() => onAction(item, 'done')}><Check data-icon="inline-start" size={13} />Approve</Button>
      : admin && verify ? <Button variant="secondary" size="sm" disabled={busy} onClick={() => onAction(item, 'verified')}><CheckCheck data-icon="inline-start" size={13} />Verify</Button>
      : canExtend ? <Button variant="outline" size="sm" disabled={busy} onClick={() => onExtend(item)}><CalendarClock data-icon="inline-start" size={13} />Extend</Button>
      : <Button variant="ghost" size="icon" aria-label={`Open ${item.title}`} onClick={() => onOpen(item.id)}><ArrowUpRight size={16} /></Button>}
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
          return n > 0 && <span key={status} title={`${n} ${statusLabels[status]}`} className={`flight-${status}`}><i />{n} {statusLabels[status].toLowerCase()}</span>;
        })}{tickets.length === 0 && <span className="cell-muted">None open</span>}</div></TableCell>
        <TableCell className="number-cell">{percent(row.bugScore)}{row.bugsScored > 0 && <span className="cell-subtext">{row.bugsScored} scored</span>}</TableCell>
        <TableCell><ScoreBadge score={row.efficiency} band={row.band} /></TableCell>
        <TableCell><Button variant="ghost" size="icon" asChild><Link aria-label={`View ${row.member.name}'s tickets`} href={routeFor(data, `tickets?assignee=${row.memberId}`)}><ArrowUpRight size={16} /></Link></Button></TableCell>
      </TableRow>;
    })}</TableBody>
  </Table></div>;
}
