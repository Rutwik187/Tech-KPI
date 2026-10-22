"use client";

import { useState, type FormEvent } from 'react';
import clsx from 'clsx';
import { AlertTriangle, CalendarClock, CalendarRange, CircleCheck, CircleHelp, Flag, Hourglass, TrendingDown } from 'lucide-react';
import type { DashboardData } from '@/lib/types';
import { addDays, daysBetween, extensionHistory, healthLabels, projectTimeline, reasonLabel, ticketExtendedDays, type ProjectTimeline, type TimelineHealth } from '@/lib/timeline';
import { FormField, Modal } from '@/components/ui';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { FieldGroup } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { displayDate, findMember, findProject, isAdhocProject, today, type ExtendTarget, type MutationFn } from './lib';
import { FormChoice, FormFooter } from './forms';

export function plural(count: number, noun: string, many = `${noun}s`) { return `${count} ${count === 1 ? noun : many}`; }
export function dayCount(days: number) { return plural(Math.abs(days), 'day'); }

const healthIcons: Record<TimelineHealth, typeof Flag> = { no_target: CalendarRange, not_started: Hourglass, on_track: Flag, behind: TrendingDown, overdue: AlertTriangle, complete: CircleCheck };
const healthVariants = { no_target: 'outline', not_started: 'secondary', on_track: 'success', behind: 'warning', overdue: 'destructive', complete: 'success' } as const;
export function HealthBadge({ health }: { health: TimelineHealth }) {
  const Icon = healthIcons[health];
  return <Badge variant={healthVariants[health]} className="health-badge"><Icon aria-hidden="true" />{healthLabels[health]}</Badge>;
}
/** "Extended +7 days" with the number of moves. Hidden while the date has never moved. */
export function ExtendedBadge({ days, moves }: { days: number; moves: number }) {
  if (!moves) return null;
  return <Badge variant="warning" className="extension-badge" title="The date was moved. Each move has a reason in the history."><CalendarClock aria-hidden="true" />{days > 0 ? `+${dayCount(days)}` : 'Moved'}{moves > 1 ? ` · ${moves}×` : ''}</Badge>;
}
export function daysLeftText(daysLeft: number | null) {
  if (daysLeft === null) return 'No target date';
  if (daysLeft === 0) return 'Due today';
  return daysLeft > 0 ? `${dayCount(daysLeft)} left` : `${dayCount(daysLeft)} past target`;
}

/** Each move of a date, with its reason. Setting the first date is planning, so it is not listed. */
export function ExtensionHistory({ data, entityId, empty }: { data: DashboardData; entityId: string; empty: string }) {
  const moves = extensionHistory(data, entityId);
  if (!moves.length) return <p className="form-help extension-empty"><CircleCheck size={14} />{empty}</p>;
  return <ol className="extension-history">{moves.map((move, index) => {
    const from = String(move.payload.from), to = String(move.payload.to);
    const shift = daysBetween(from, to);
    const actor = move.actorId === data.currentUser.id ? 'You' : findMember(data, move.actorId)?.name ?? 'Your admin';
    const category = reasonLabel(move.payload.reasonCategory);
    return <li key={move.id}>
      <span className="extension-step" aria-hidden="true">{index + 1}</span>
      <div>
        <p className="extension-move"><strong>{displayDate(from)} → {displayDate(to)}</strong><Badge variant="outline">{shift >= 0 ? '+' : '−'}{dayCount(shift)}</Badge>{category && <Badge variant="secondary">{category}</Badge>}</p>
        {move.reason && <blockquote>{move.reason}</blockquote>}
        <span className="extension-meta">{actor} · {displayDate(move.createdAt, { weekday: 'short' })}</span>
      </div>
    </li>;
  })}</ol>;
}

const QUICK_SHIFTS = [{ days: 1, label: '+1 day' }, { days: 2, label: '+2 days' }, { days: 7, label: '+1 week' }, { days: 14, label: '+2 weeks' }];
const REASONS = [{ value: 'blocked_dependency', label: 'Waiting on someone' }, { value: 'scope_change', label: 'Scope grew' }, { value: 'underestimated', label: 'Took longer' }, { value: 'other', label: 'Other' }];

/** Moves a ticket's due date or a project's target date. The reason goes into the history for everyone to see. */
export function ExtendForm({ target, data, mutate, onClose, busy }: { target: ExtendTarget; data: DashboardData; mutate: MutationFn; onClose: () => void; busy: boolean }) {
  const ticket = target.kind === 'ticket';
  const current = (ticket ? target.item.dueDate : target.project.targetDate) ?? today(data.settings.timezone);
  const original = ticket ? target.item.originalDueDate : target.project.originalTargetDate;
  const [date, setDate] = useState(addDays(current, 7));
  const moves = extensionHistory(data, ticket ? target.item.id : target.project.id).length;
  const shift = date ? daysBetween(current, date) : 0;
  const project = ticket ? findProject(data, target.item.projectId) : target.project;
  const pastProjectTarget = ticket && project && !isAdhocProject(project) && project.targetDate && date > project.targetDate;
  const admin = data.currentUser.role === 'admin';
  const ticketsAfter = !ticket && data.items.filter(item => item.projectId === target.project.id && item.type === 'task' && item.status !== 'done' && item.dueDate && item.dueDate > date).length;
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const fields = new FormData(event.currentTarget);
    const reason = String(fields.get('reason') ?? '').trim();
    const reasonCategory = String(fields.get('reasonCategory') ?? 'other');
    const ok = ticket
      ? await mutate({ action: 'updateItem', id: target.item.id, patch: { dueDate: date }, reason, reasonCategory }, `Due date moved to ${displayDate(date)}. The reason is in the history.`)
      : await mutate({ action: 'updateProject', id: target.project.id, patch: { targetDate: date }, reason, reasonCategory }, `${target.project.name} now targets ${displayDate(date)}. The reason is in the history.`);
    if (ok) onClose();
  }
  return <Modal title={ticket ? 'Extend due date' : 'Extend project timeline'} subtitle={ticket ? `${target.item.key} · ${target.item.title}` : target.project.name} onClose={onClose}>
    <form onSubmit={submit}>
      <FieldGroup className="modal-form-body">
        <div className="extend-current">
          <div><span>{ticket ? 'Due now' : 'Target now'}</span><strong>{displayDate(current, { weekday: 'short', year: 'numeric' })}</strong></div>
          {original && original !== current && <div><span>First {ticket ? 'due date' : 'target'}</span><strong>{displayDate(original, { year: 'numeric' })}</strong></div>}
          <div><span>Moved before</span><strong>{moves ? plural(moves, 'time') : 'Never'}</strong></div>
        </div>
        <div className="extend-date-row">
          <FormField>New {ticket ? 'due date' : 'target date'}<Input type="date" name="date" required value={date} min={addDays(current, 1)} onChange={event => setDate(event.target.value)} /></FormField>
          <div className="extend-quick" role="group" aria-label="Move the date by">{QUICK_SHIFTS.map(option => <Button key={option.days} type="button" size="sm" variant={shift === option.days ? 'secondary' : 'outline'} aria-pressed={shift === option.days} onClick={() => setDate(addDays(current, option.days))}>{option.label}</Button>)}</div>
          <p className="field-help extend-preview" aria-live="polite">{shift > 0 ? <>Moves the date by <strong>{dayCount(shift)}</strong>, from {displayDate(current)} to {displayDate(date, { weekday: 'short' })}.</> : 'Choose a date after the current one.'}</p>
        </div>
        {pastProjectTarget && <Alert className="form-tip extend-warning"><AlertTriangle size={17} /><AlertDescription><p>This is after the <strong>{project!.name}</strong> target date ({displayDate(project!.targetDate)}). {admin ? 'Extend the project too if the whole project slips.' : 'Tell your admin, as the project may need more time too.'}</p></AlertDescription></Alert>}
        {ticketsAfter ? <Alert className="form-tip"><CircleHelp size={17} /><AlertDescription><p>{plural(ticketsAfter, 'open ticket')} {ticketsAfter === 1 ? 'is' : 'are'} still due after this date.</p></AlertDescription></Alert> : null}
        <FormField>Why does it need more time?<FormChoice name="reasonCategory" defaultValue="blocked_dependency" options={REASONS} /></FormField>
        <FormField>Reason<Textarea name="reason" required minLength={3} maxLength={2000} rows={3} placeholder={ticket ? 'e.g. The payment sandbox was down for a day.' : 'e.g. The client added a refunds screen to the scope.'} /><span className="field-help">Everyone on the {ticket ? 'ticket' : 'project'} can read this in its history.</span></FormField>
      </FieldGroup>
      <FormFooter busy={busy} disabled={shift <= 0} onClose={onClose} label={shift > 0 ? `Extend to ${displayDate(date)}` : 'Choose a later date'} />
    </form>
  </Modal>;
}

/** Work done against time used, on one track. The tick is today; a fill behind the tick means behind plan. */
export function TimelineStrip({ timeline, color }: { timeline: ProjectTimeline; color: string }) {
  const { startDate, targetDate, timePercent, workPercent, health } = timeline;
  if (!targetDate) return <div className="timeline-strip timeline-strip-empty"><CalendarRange size={14} />No target date yet</div>;
  return <div className="timeline-strip">
    <div className="timeline-strip-dates"><span>{startDate ? displayDate(startDate) : 'No start date'}</span><span>Target {displayDate(targetDate, { weekday: 'short' })} · {health === 'complete' ? 'done' : daysLeftText(timeline.daysLeft).toLowerCase()}</span></div>
    <div className={clsx('timeline-track', `timeline-${health}`)} role="img" aria-label={`${Math.round(workPercent)}% of ticket hours done, ${timePercent === null ? 'no start date' : `${Math.round(timePercent)}% of time used`}`}>
      <span className="timeline-fill" style={{ width: `${Math.min(100, workPercent)}%`, background: color }} />
      {timePercent !== null && <span className="timeline-today" style={{ left: `${timePercent}%` }} />}
    </div>
    <div className="timeline-strip-legend"><span><i style={{ background: color }} />{Math.round(workPercent)}% of work done</span>{timePercent !== null && <span><i className="today-key" />{Math.round(timePercent)}% of time used</span>}</div>
  </div>;
}

/** Every active project with dates on one time axis. Bars run start → target; extensions show as a hatched tail. */
export function ProjectTimelines({ data, onOpen }: { data: DashboardData; onOpen: (id: string) => void }) {
  const day = today(data.settings.timezone);
  const rows = data.projects.filter(p => !p.isArchived && !isAdhocProject(p) && p.targetDate)
    .map(project => ({ project, timeline: projectTimeline(data, project, day) }))
    .sort((a, b) => a.project.targetDate!.localeCompare(b.project.targetDate!));
  if (!rows.length) return <p className="form-help timeline-chart-empty"><CalendarRange size={15} />Add a start and target date to a project to see it here.</p>;
  const starts = rows.map(r => r.project.startDate ?? r.project.originalTargetDate ?? r.project.targetDate!);
  const ends = rows.map(r => r.project.targetDate!);
  const first = addDays([...starts, day].sort()[0], -3);
  const last = addDays([...ends, day].sort().at(-1)!, 5);
  const span = daysBetween(first, last);
  const at = (date: string) => `${Math.min(100, Math.max(0, daysBetween(first, date) / span * 100))}%`;
  const months: string[] = [];
  for (let date = `${first.slice(0, 7)}-01`; date <= last; date = addDays(`${date.slice(0, 7)}-01`, 32).slice(0, 7) + '-01') if (date >= first) months.push(date);
  return <div className="gantt">
    <div className="gantt-axis" aria-hidden="true"><span />
      <div className="gantt-scale">{months.map(month => <span key={month} style={{ left: at(month) }}>{displayDate(month, { day: undefined, month: 'short' })}</span>)}<span className="gantt-today-label" style={{ left: at(day) }}>Today</span></div>
    </div>
    {rows.map(({ project, timeline }) => {
      const start = project.startDate ?? project.targetDate!;
      const original = timeline.originalTargetDate && timeline.originalTargetDate < project.targetDate! ? timeline.originalTargetDate : null;
      const barEnd = original ?? project.targetDate!;
      return <button type="button" className="gantt-row" key={project.id} onClick={() => onOpen(project.id)} aria-label={`Open ${project.name}: ${healthLabels[timeline.health]}, ${Math.round(timeline.workPercent)}% done, target ${displayDate(project.targetDate)}`}>
        <span className="gantt-name"><i style={{ background: project.color }} /><strong>{project.name}</strong><HealthBadge health={timeline.health} /></span>
        <span className="gantt-track">
          {months.map(month => <span key={month} className="gantt-gridline" style={{ left: at(month) }} />)}
          <Tooltip><TooltipTrigger asChild>
            <span className="gantt-bar" style={{ left: at(start), width: `calc(${at(project.targetDate!)} - ${at(start)})` }}>
              <span className="gantt-bar-plan" style={{ width: `calc(${daysBetween(start, barEnd) / Math.max(1, daysBetween(start, project.targetDate!)) * 100}%)`, background: `${project.color}29` }} />
              {original && <span className="gantt-bar-extension" style={{ left: `${daysBetween(start, original) / Math.max(1, daysBetween(start, project.targetDate!)) * 100}%` }} />}
              <span className="gantt-bar-done" style={{ width: `${Math.min(100, timeline.workPercent)}%`, background: project.color }} />
            </span>
          </TooltipTrigger><TooltipContent className="gantt-tooltip">
            <strong>{project.name}</strong>
            <span>{displayDate(start)} → {displayDate(project.targetDate)}</span>
            <span>{Math.round(timeline.workPercent)}% of {Math.round(timeline.totalHours)} ticket hours done</span>
            {timeline.extensions.length > 0 && <span>Extended {plural(timeline.extensions.length, 'time')}, +{dayCount(timeline.extendedDays)}</span>}
          </TooltipContent></Tooltip>
          <span className="gantt-today" style={{ left: at(day) }} />
        </span>
        <span className="gantt-meta"><strong>{displayDate(project.targetDate)}</strong><ExtendedBadge days={timeline.extendedDays} moves={timeline.extensions.length} /></span>
      </button>;
    })}
    <div className="chart-legend gantt-legend"><span><i className="legend-swatch legend-done" />Work done</span><span><i className="legend-swatch legend-plan" />Planned time</span><span><i className="legend-swatch legend-extension" />Extension</span><span><i className="legend-swatch legend-today" />Today</span></div>
    <table className="sr-only"><caption>Project timelines</caption><thead><tr><th>Project</th><th>Start</th><th>Target</th><th>First target</th><th>Work done</th><th>Status</th></tr></thead>
      <tbody>{rows.map(({ project, timeline }) => <tr key={project.id}><td>{project.name}</td><td>{displayDate(project.startDate)}</td><td>{displayDate(project.targetDate)}</td><td>{displayDate(timeline.originalTargetDate)}</td><td>{Math.round(timeline.workPercent)}%</td><td>{healthLabels[timeline.health]}</td></tr>)}</tbody></table>
  </div>;
}

/** The ticket's own extension summary for lists and cards. */
export function TicketExtendedBadge({ data, item }: { data: DashboardData; item: { id: string; dueDate: string | null; originalDueDate: string | null } }) {
  return <ExtendedBadge days={ticketExtendedDays(item)} moves={extensionHistory(data, item.id).length} />;
}
