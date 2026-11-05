"use client";

import type { CSSProperties, ReactNode } from 'react';
import clsx from 'clsx';
import { toast } from 'sonner';
import { AlertTriangle, ArrowDown, CalendarClock, CalendarDays, Check, CheckCheck, CircleDot, Clock3, Flag, Link2, MoreHorizontal, PanelRightOpen, Plus, RotateCcw } from 'lucide-react';
import type { DashboardData, WorkItem } from '@/lib/types';
import { getBugKpi, type MemberKpi } from '@/lib/kpi';
import { Avatar, PriorityMark } from '@/components/ui';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { bands, displayDate, displayDateTime, findDepartment, findMember, findProject, firstName, hours, isDone, itemLink, pendingExtension, percent, phaseName, requestForItem, today, type OnAction } from './lib';
import { TicketExtendedBadge } from './timeline';

export function ProjectTag({ data, id }: { data: DashboardData; id: string }) {
  const project = findProject(data, id);
  return <span className="project-tag" title={project?.name}><i style={{ background: project?.color ?? 'var(--muted-foreground)' }} aria-hidden="true" /><span>{project?.name ?? 'Unknown project'}</span></span>;
}
export function PhaseTag({ data, id }: { data: DashboardData; id: string | null }) {
  const description = id ? data.phases.find(phase => phase.id === id)?.description : '';
  return <span className={clsx('phase-tag', !id && 'phase-tag-adhoc')} title={description || undefined}>{phaseName(data, id)}</span>;
}
export function ScoreBadge({ score, band }: { score: number | null; band: keyof typeof bands }) {
  const variant = band === 'on_target' ? 'success' : band === 'below_target' ? 'warning' : band === 'needs_attention' ? 'destructive' : 'secondary';
  return <Badge variant={variant} className="score-badge">{score === null ? 'No hours at work' : percent(score)}{score !== null && <span>{bands[band]}</span>}</Badge>;
}
export function SeverityBadge({ item }: { item: WorkItem }) {
  const critical = item.severity === 'critical';
  return <Badge variant={critical ? 'destructive' : 'outline'} className={clsx('severity-badge', critical && 'severity-critical')}>{critical && <AlertTriangle aria-hidden="true" />}{critical ? 'Critical' : 'Normal'}</Badge>;
}
export function MetricCard({ label, value, detail, icon, primary, children }: { label: string; value: ReactNode; detail: ReactNode; icon: ReactNode; primary?: boolean; children?: ReactNode }) {
  return <Card className={clsx('metric-card', primary && 'metric-primary')}>
    <CardHeader><CardDescription className="metric-label">{label}<span className="metric-icon">{icon}</span></CardDescription><CardTitle className="metric-number">{value}</CardTitle></CardHeader>
    <CardContent><div className="metric-detail">{detail}</div>{children}</CardContent>
  </Card>;
}

/** The one button that moves an item to its next state. Approvals and verification belong to the admin. */
export function ItemActions({ item, admin, onAction, busy }: { item: WorkItem; admin: boolean; onAction: OnAction; busy: boolean }) {
  let status: WorkItem['status'] | null = null;
  let label = '';
  let Icon = Check;
  if (item.type === 'task') {
    // One step to finish. A developer's ticket then waits for review; an admin approves as they complete.
    if (['todo', 'in_progress', 'blocked'].includes(item.status)) { status = admin ? 'done' : 'in_review'; label = 'Complete'; }
    else if (item.status === 'in_review' && admin) { status = 'done'; label = 'Approve'; }
  } else {
    if (item.status === 'open' || item.status === 'in_progress') { status = 'fixed'; label = 'Mark fixed'; }
    else if (item.status === 'fixed' && admin) { status = 'verified'; label = 'Verify'; Icon = CheckCheck; }
  }
  if (!status) {
    const waiting = item.status === 'in_review' ? 'Waiting for review' : item.status === 'fixed' ? 'Waiting for verification' : 'Completed';
    return <span className={clsx('cell-muted next-step-note', isDone(item) && 'next-step-done')}>{waiting}</span>;
  }
  const next = status;
  // An admin's decision on someone's finished work stands out. Everything else is a quiet step.
  const decision = next === 'done' && item.status === 'in_review' || next === 'verified';
  return <Button variant={decision ? 'default' : 'outline'} size="sm" type="button" className={clsx('next-step', decision && 'next-step-decision')} disabled={busy} onClick={() => onAction(item, next)}>{label}<Icon data-icon="inline-end" size={13} /></Button>;
}

/**
 * The owner or an admin may change an open ticket's date. Setting the first one is planning.
 * An admin extends directly with a reason; a developer asks, and may not ask again while one request waits.
 */
export function canMoveDueDate(item: WorkItem, data: DashboardData) {
  if (item.type !== 'task' || !['todo', 'in_progress', 'blocked'].includes(item.status)) return false;
  if (data.currentUser.role === 'admin') return true;
  return item.assigneeId === data.currentUser.id && !(item.dueDate && pendingExtension(data, item.id));
}

/** Who may add hours to an open ticket. An admin adds them directly; the owner asks, one ask at a time. */
export function canAddHours(item: WorkItem, data: DashboardData) {
  if (item.type !== 'task' || !['todo', 'in_progress', 'blocked'].includes(item.status)) return false;
  if (data.currentUser.role === 'admin') return true;
  return item.assigneeId === data.currentUser.id && !pendingExtension(data, item.id);
}

/** Shows that an extension waits for the admin, with the extra hours that were asked for. */
export function PendingExtensionBadge({ data, item }: { data: DashboardData; item: WorkItem }) {
  const request = pendingExtension(data, item.id);
  if (!request) return null;
  return <Badge variant="outline" className="extension-pending" title={`${request.hours} more ${request.hours === 1 ? 'hour waits' : 'hours wait'} for approval`}><CalendarClock size={11} />Asked +{request.hours} h</Badge>;
}

function DueDateButton({ item, data, onExtend }: { item: WorkItem; data: DashboardData; onExtend: (item: WorkItem) => void }) {
  // A developer's extension is a request, so the button says so.
  const label = !item.dueDate ? 'Set date' : data.currentUser.role === 'admin' ? 'Extend' : 'Ask to extend';
  return <Button variant="ghost" size="sm" type="button" className="due-action" aria-label={`${item.dueDate ? 'Extend the date of' : 'Set a date for'} ${item.key}`} onClick={() => onExtend(item)}>
    <CalendarClock data-icon="inline-start" />{label}
  </Button>;
}

/** A bug earns full points when fixed by its fix-by time, half within twice the target, none after that. */
export function FixBy({ item, data, label = false }: { item: WorkItem; data: DashboardData; label?: boolean }) {
  const kpi = getBugKpi(item, data);
  const closed = item.status === 'fixed' || item.status === 'verified';
  if (closed) {
    const label = kpi.score === 100 ? 'On time' : kpi.score === 50 ? 'Late' : 'Very late';
    return <span className="fix-by"><Badge variant={kpi.score === 100 ? 'success' : kpi.score === 50 ? 'warning' : 'destructive'}>{label} · {kpi.score ?? 0} pts</Badge><small>{hours(kpi.resolutionWorkingHours)} working h to fix</small></span>;
  }
  const late = kpi.overdueHours > 0;
  return <span className={clsx('fix-by', late && 'fix-by-late')}><span className="bug-clock"><Clock3 size={12} />{label && 'Fix by '}{displayDateTime(kpi.deadline1)}</span><small>{late ? `${hours(kpi.overdueHours)} working h late` : `${hours(kpi.hoursRemaining)} working h left`}</small></span>;
}

/** A ticket from an earlier day that is still open. It carried over, so it shows in red. */
export function isCarriedOver(item: WorkItem, data: DashboardData) {
  return item.type === 'task' && !!item.dueDate && item.dueDate < today(data.settings.timezone) && !isDone(item);
}

/** Small signals next to a title: the team that asked for it, extensions, more time asked, and, where no column shows it, a critical bug. */
export function ItemFlags({ item, data, severity = false }: { item: WorkItem; data: DashboardData; severity?: boolean }) {
  const request = requestForItem(data, item.id);
  const team = request ? findDepartment(data, request.departmentId)?.name ?? 'Another team' : null;
  return <span className="item-flags">
    {request && <span className="flag flag-request" title={`Requested by ${request.requesterName} (${team}) · ${request.key}`}>{team}</span>}
    {item.type === 'task' && <TicketExtendedBadge data={data} item={item} />}
    {item.type === 'task' && <PendingExtensionBadge data={data} item={item} />}
    {severity && item.type === 'bug' && item.severity === 'critical' && !isDone(item) && item.status !== 'fixed' && <span className="flag flag-critical"><AlertTriangle aria-hidden="true" />Critical</span>}
  </span>;
}

export async function copyItemLink(data: DashboardData, item: WorkItem) {
  try { await navigator.clipboard.writeText(itemLink(data, item)); toast.success(`Link to ${item.key} copied`); }
  catch { toast.error('Could not copy the link.'); }
}

/** Every other step for an item, in one menu. The same rules as the details panel decide what shows. */
export function ItemMenu({ item, data, onOpen, onAction, onExtend, onAddHours, busy, align = 'end' }: { item: WorkItem; data: DashboardData; onOpen?: (id: string) => void; onAction: OnAction; onExtend?: (item: WorkItem) => void; onAddHours?: (item: WorkItem) => void; busy: boolean; align?: 'start' | 'end' }) {
  const admin = data.currentUser.role === 'admin';
  const ticket = item.type === 'task';
  const canBlock = ticket && ['todo', 'in_progress'].includes(item.status);
  const canUnblock = ticket && item.status === 'blocked';
  const moveDate = !!onExtend && canMoveDueDate(item, data);
  const addHours = !!onAddHours && canAddHours(item, data);
  const sendBack = admin && item.status === 'in_review';
  const reopen = admin && (item.status === 'done' || item.status === 'fixed' || item.status === 'verified');
  const steps = canBlock || canUnblock || moveDate || addHours || sendBack || reopen;
  // Not modal, so a dialog opened from the menu gets focus and clicks straight away.
  return <DropdownMenu modal={false}>
    <DropdownMenuTrigger asChild><Button variant="ghost" size="icon-sm" type="button" className="item-menu-trigger" aria-label={`More actions for ${item.key}`}><MoreHorizontal /></Button></DropdownMenuTrigger>
    <DropdownMenuContent align={align} className="item-menu">
      {onOpen && <DropdownMenuItem onSelect={() => onOpen(item.id)}><PanelRightOpen />Open details</DropdownMenuItem>}
      <DropdownMenuItem onSelect={() => void copyItemLink(data, item)}><Link2 />Copy link</DropdownMenuItem>
      {steps && <DropdownMenuSeparator />}
      {canBlock && <DropdownMenuItem disabled={busy} onSelect={() => onAction(item, 'blocked')}><Flag />Mark blocked</DropdownMenuItem>}
      {canUnblock && <DropdownMenuItem disabled={busy} onSelect={() => onAction(item, 'in_progress')}><CircleDot />Unblock</DropdownMenuItem>}
      {moveDate && <DropdownMenuItem onSelect={() => onExtend!(item)}>{item.dueDate ? <CalendarClock /> : <CalendarDays />}{!item.dueDate ? 'Set date' : admin ? 'Extend date' : 'Ask to extend'}</DropdownMenuItem>}
      {addHours && <DropdownMenuItem onSelect={() => onAddHours!(item)}><Plus />{admin ? 'Add hours' : 'Ask for hours'}</DropdownMenuItem>}
      {sendBack && <DropdownMenuItem disabled={busy} onSelect={() => onAction(item, 'in_progress')}><ArrowDown />Send back</DropdownMenuItem>}
      {reopen && <DropdownMenuItem disabled={busy} onSelect={() => onAction(item, ticket ? 'in_progress' : 'open')}><RotateCcw />Reopen</DropdownMenuItem>}
    </DropdownMenuContent>
  </DropdownMenu>;
}

/** Shared ticket card for the board. Identity, title, context, facts, then one clear next step. */
export function TicketCard({ item, data, onOpen, onAction, onExtend, onAddHours, busy }: { item: WorkItem; data: DashboardData; onOpen: (id: string) => void; onAction: OnAction; onExtend?: (item: WorkItem) => void; onAddHours?: (item: WorkItem) => void; busy: boolean }) {
  const project = findProject(data, item.projectId);
  const owner = findMember(data, item.assigneeId);
  const phase = item.phaseId ? phaseName(data, item.phaseId) : null;
  const overdue = isCarriedOver(item, data);
  const admin = data.currentUser.role === 'admin';
  return <Card className={clsx('task-card', overdue && 'task-card-overdue', isDone(item) && 'task-card-done')} size="sm" style={{ '--project-color': project?.color ?? 'var(--border)' } as CSSProperties}>
    <div className="task-card-top">
      <span className="item-key">{item.key}</span>
      <PriorityMark priority={item.priority} />
      <ItemMenu item={item} data={data} onOpen={onOpen} onAction={onAction} onExtend={onExtend} onAddHours={onAddHours} busy={busy} />
    </div>
    <Button variant="ghost" className="task-card-title" onClick={() => onOpen(item.id)}>{item.title}</Button>
    <div className="task-card-context"><span className="task-card-project" title={project?.name}><i aria-hidden="true" /><span>{project?.name ?? 'Unknown project'}</span></span>{phase && <span className="task-card-phase" title={phase}>{phase}</span>}</div>
    {item.status === 'blocked' && item.blocker && <p className="task-card-blocker"><AlertTriangle size={12} aria-hidden="true" />{item.blocker}</p>}
    {item.type === 'bug' && <div className="task-card-meta"><SeverityBadge item={item} /><FixBy item={item} data={data} label /></div>}
    {item.type === 'task' && <span className="task-card-facts">
      <span title="Estimate"><Clock3 size={12} aria-hidden="true" />{item.estimateHours} h</span>
      {item.dueDate && <span className={clsx(overdue && 'due-overdue')} title={overdue ? 'Carried over: not done on its date' : 'Date'}><CalendarDays size={12} aria-hidden="true" />{displayDate(item.dueDate)}{overdue && <span className="sr-only"> carried over</span>}</span>}
      <TicketExtendedBadge data={data} item={item} /><PendingExtensionBadge data={data} item={item} />
      {/* Late work shows its date action on the card. Every other card keeps it in the menu. */}
      {onExtend && overdue && canMoveDueDate(item, data) && <DueDateButton item={item} data={data} onExtend={onExtend} />}
    </span>}
    <div className="task-card-bottom">
      {admin ? <span className="task-card-owner" title={owner?.name}><Avatar member={owner} size="small" /><span>{firstName(owner)}</span></span> : <span className="task-card-owner" />}
      <span className="task-card-action"><ItemActions item={item} admin={admin} onAction={onAction} busy={busy} /></span>
    </div>
  </Card>;
}

/** Shows the score formula with this person's own numbers, so nobody has to guess how it works. */
export function ScoreExplainer({ kpi, data, current }: { kpi: MemberKpi; data: DashboardData; current: boolean }) {
  const { deliveryWeight, bugWeight, normalTargetHours, criticalTargetHours } = data.settings;
  return <div className="score-explainer-body">
    <div className="formula-display">
      <div><strong>{percent(kpi.deliveryScore)}</strong><span>Ticket hours × {deliveryWeight}%</span></div><span>+</span>
      <div><strong>{percent(kpi.bugScore)}</strong><span>Bug points × {bugWeight}%</span></div><span>=</span>
      <div className="formula-total"><strong>{percent(kpi.efficiency)}</strong><span>Efficiency</span></div>
    </div>
    <ul className="score-rules">
      <li><strong>Ticket hours.</strong> {hours(kpi.creditedHours)} h of approved tickets ÷ {hours(kpi.capacityHours)} h at work{current ? ' so far this week' : ''}. A ticket earns its estimate when the admin approves it. This part caps at 100%.</li>
      <li><strong>Bug points.</strong> Fixed by the fix-by time: 100. Up to twice the target: 50. Later: 0. Targets are {normalTargetHours} working hours, or {criticalTargetHours} for critical bugs. {kpi.bugsScored ? `${kpi.bugsScored} bug${kpi.bugsScored === 1 ? '' : 's'} scored this week.` : 'No bugs scored this week, so you keep full bug points.'}</li>
      <li><strong>Hours at work.</strong> Weekly hours minus leave and holidays. Time off lowers the hours, never the score.</li>
    </ul>
  </div>;
}
