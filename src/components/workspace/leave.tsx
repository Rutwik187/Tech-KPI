"use client";

import { useState } from 'react';
import clsx from 'clsx';
import { CalendarCheck, CalendarClock, CalendarDays, ChevronLeft, ChevronRight, Hourglass, Plus, UserRound, Users } from 'lucide-react';
import type { DashboardData } from '@/lib/types';
import { leadsWork } from '@/lib/permissions';
import { getWeekStart, getWorkCalendar, isWorkingDay, shiftDate } from '@/lib/kpi';
import { FormCheckbox, FormField, FormSelect, Panel } from '@/components/ui';
import { Button } from '@/components/ui/button';
import { displayDate, findMember, firstName, groupLeaves, today } from './lib';
import { LeaveRequests } from './leave-requests';
import { LeaveList } from './team';
import type { MutationFn } from './lib';

type LeavePageProps = { data: DashboardData; mutate: MutationFn; busy: boolean; onAdd: (start?: { userId?: string; days?: string[] }) => void };
/** One mark on the calendar: recorded leave, or a request that still waits. */
type Mark = { userId: string; half: boolean; waiting: boolean; note: string };

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const SHOWN_PER_DAY = 3;

/** `YYYY-MM-01` of the month that holds `day`, moved by `months`. */
function monthStart(day: string, months = 0) {
  const [year, month] = day.split('-').map(Number);
  const moved = new Date(Date.UTC(year, month - 1 + months, 1));
  return moved.toISOString().slice(0, 10);
}
function monthLabel(month: string) {
  return new Intl.DateTimeFormat('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${month}T12:00:00Z`));
}
function daysLabel(n: number) { return `${n} ${n === 1 ? 'day' : 'days'}`; }

/**
 * Who is away and when. The tech lead sees the whole team and approves requests. A developer sees their own leave and requests.
 * Leave lowers hours at work, so this is also where people check their history.
 */
export function LeavePage({ data, mutate, busy, onAdd }: LeavePageProps) {
  const admin = leadsWork(data.currentUser);
  const tz = data.settings.timezone;
  const day = today(tz);
  const [month, setMonth] = useState(monthStart(day));
  const [personId, setPersonId] = useState(admin ? '' : data.currentUser.id);
  const [showPast, setShowPast] = useState(!admin);
  const calendar = getWorkCalendar(data);
  const developers = data.members.filter(m => m.role === 'developer' && (m.isActive || data.leaves.some(l => l.userId === m.id)))
    .sort((a, b) => Number(b.isActive) - Number(a.isActive) || a.name.localeCompare(b.name));
  const forPerson = (userId: string) => !personId || userId === personId;
  const leaves = data.leaves.filter(l => forPerson(l.userId));
  const waiting = (data.leaveRequests ?? []).filter(r => r.status === 'pending' && (admin || r.requesterId === data.currentUser.id) && forPerson(r.requesterId));

  // Everything on each day, so each calendar cell is one lookup.
  const marks = new Map<string, Mark[]>();
  const add = (date: string, mark: Mark) => marks.set(date, [...(marks.get(date) ?? []), mark]);
  leaves.forEach(l => add(l.date, { userId: l.userId, half: l.type === 'half_day', waiting: false, note: l.note }));
  waiting.forEach(r => r.dates.forEach(date => add(date, { userId: r.requesterId, half: r.type === 'half_day', waiting: true, note: r.note })));
  const holidays = new Map(data.holidays.map(h => [h.date, h]));

  // Whole weeks, Monday to Sunday, that cover the month.
  const nextMonth = monthStart(month, 1);
  const weeks: string[][] = [];
  for (let start = getWeekStart(month, tz); start < nextMonth; start = shiftDate(start, 7, tz)) {
    weeks.push(Array.from({ length: 7 }, (_, i) => shiftDate(start, i, tz)));
  }

  // Summary numbers. A half day counts as half.
  const weight = (l: { type: string }) => l.type === 'half_day' ? .5 : 1;
  const weekStart = getWeekStart(new Date(), tz);
  const weekEnd = shiftDate(weekStart, 6, tz);
  const year = day.slice(0, 4);
  const stats = admin ? [
    { icon: <UserRound size={18} />, value: new Set(data.leaves.filter(l => l.date === day).map(l => l.userId)).size, label: 'on leave today' },
    { icon: <Users size={18} />, value: new Set(data.leaves.filter(l => l.date >= weekStart && l.date <= weekEnd).map(l => l.userId)).size, label: 'on leave this week' },
    { icon: <Hourglass size={18} />, value: (data.leaveRequests ?? []).filter(r => r.status === 'pending').length, label: 'requests wait for you' },
  ] : [
    { icon: <CalendarCheck size={18} />, value: data.leaves.filter(l => l.userId === data.currentUser.id && l.date.startsWith(year) && l.date <= day).reduce((sum, l) => sum + weight(l), 0), label: `days of leave taken in ${year}` },
    { icon: <CalendarClock size={18} />, value: data.leaves.filter(l => l.userId === data.currentUser.id && l.date > day).reduce((sum, l) => sum + weight(l), 0), label: 'upcoming days of leave' },
    { icon: <Hourglass size={18} />, value: waiting.reduce((sum, r) => sum + r.dates.length * weight(r), 0), label: 'days wait for approval' },
  ];

  const groups = groupLeaves(data, leaves);
  const upcoming = groups.filter(g => g.end >= day).sort((a, b) => a.start.localeCompare(b.start));
  const past = groups.filter(g => g.end < day).sort((a, b) => b.start.localeCompare(a.start));
  const canPick = (date: string) => isWorkingDay(date, calendar) && !(marks.get(date) ?? []).some(m => m.userId === (personId || data.currentUser.id));
  const person = personId ? findMember(data, personId) : undefined;

  return <>
    <div className="team-overview-strip">{stats.map(stat => <div key={stat.label}><span className="mini-metric-icon">{stat.icon}</span><strong>{stat.value}</strong><span>{stat.label}</span></div>)}</div>

    <Panel title="Leave calendar" className="leave-calendar-panel" action={<div className="leave-month-nav">
      <Button variant="ghost" size="icon-sm" aria-label="Previous month" onClick={() => setMonth(monthStart(month, -1))}><ChevronLeft size={16} /></Button>
      <strong aria-live="polite">{monthLabel(month)}</strong>
      <Button variant="ghost" size="icon-sm" aria-label="Next month" onClick={() => setMonth(monthStart(month, 1))}><ChevronRight size={16} /></Button>
      {month !== monthStart(day) && <Button variant="link" size="sm" onClick={() => setMonth(monthStart(day))}>This month</Button>}
    </div>}>
      <div className="leave-calendar-toolbar">
        {admin && <FormSelect aria-label="Show leave for" value={personId} onValueChange={setPersonId} className="leave-person-filter">
          <option value="">Everyone</option>{developers.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
        </FormSelect>}
        <div className="leave-legend">
          <span><i className="legend-leave" />Approved leave</span>
          <span><i className="legend-waiting" />Waiting for approval</span>
          <span><i className="legend-holiday" />Holiday</span>
          <span><i className="legend-off" />Weekend</span>
        </div>
      </div>
      <div className="leave-month-scroll"><table className="leave-month">
        <caption className="sr-only">Leave in {monthLabel(month)}{person ? ` for ${person.name}` : ''}</caption>
        <thead><tr>{WEEKDAYS.map(name => <th key={name} scope="col">{name}</th>)}</tr></thead>
        <tbody>{weeks.map(week => <tr key={week[0]}>{week.map(date => {
          const dayMarks = (marks.get(date) ?? []).sort((a, b) => Number(a.waiting) - Number(b.waiting) || (findMember(data, a.userId)?.name ?? '').localeCompare(findMember(data, b.userId)?.name ?? ''));
          const holiday = holidays.get(date);
          const off = !isWorkingDay(date, calendar);
          const outside = date < month || date >= nextMonth;
          const fullDate = displayDate(date, { weekday: 'long', year: 'numeric' });
          const label = (mark: Mark) => {
            if (!admin) return `${mark.waiting ? 'Waiting' : 'Leave'}${mark.half ? ' · half day' : ''}`;
            return `${firstName(findMember(data, mark.userId))}${mark.half ? ' ½' : ''}`;
          };
          const describe = (mark: Mark) => `${admin ? findMember(data, mark.userId)?.name ?? 'Team member' : 'You'}: ${mark.half ? 'half day' : 'full day'}${mark.waiting ? ', waiting for approval' : ''}${mark.note ? ` (${mark.note})` : ''}`;
          return <td key={date} className={clsx('leave-day', off && 'leave-day-off', outside && 'leave-day-outside', date === day && 'leave-day-today', holiday && 'leave-day-holiday')}>
            <div className="leave-day-head">
              {canPick(date) && !outside
                ? <button type="button" className="leave-day-number" title={admin ? 'Add leave on this day' : 'Request leave on this day'} aria-label={`${admin ? 'Add' : 'Request'} leave on ${fullDate}`} onClick={() => onAdd({ userId: personId || undefined, days: [date] })}>{Number(date.slice(8))}<Plus aria-hidden="true" /></button>
                : <span className="leave-day-number"><span className="sr-only">{fullDate}</span><span aria-hidden="true">{Number(date.slice(8))}</span></span>}
              {holiday && <span className="leave-holiday-name" title={holiday.name}>{holiday.name}</span>}
            </div>
            {dayMarks.length > 0 && <ul className="leave-day-marks">
              {dayMarks.slice(0, SHOWN_PER_DAY).map((mark, i) => <li key={`${mark.userId}-${i}`} className={clsx('leave-mark', mark.waiting ? 'leave-mark-waiting' : 'leave-mark-leave')} title={describe(mark)}>
                <span className="sr-only">{describe(mark)}</span><span aria-hidden="true">{label(mark)}</span>
              </li>)}
              {dayMarks.length > SHOWN_PER_DAY && <li className="leave-mark leave-mark-more" title={dayMarks.slice(SHOWN_PER_DAY).map(describe).join('\n')}>+{dayMarks.length - SHOWN_PER_DAY} more</li>}
            </ul>}
          </td>;
        })}</tr>)}</tbody>
      </table></div>
      <p className="panel-intro leave-calendar-help">{admin
        ? 'Select a day number to add leave on that day. Leave lowers that person’s hours at work for the week.'
        : 'Select a day number to request leave from that day. Your tech lead approves it before your hours at work change.'}</p>
    </Panel>

    <LeaveRequests data={data} mutate={mutate} busy={busy} />

    <Panel title={admin ? 'Recorded leave' : 'Your leave'} action={<Button variant="link" size="sm" onClick={() => onAdd({ userId: personId || undefined })}><CalendarDays data-icon="inline-start" size={13} />{admin ? 'Add leave' : 'Request leave'}</Button>}>
      <p className="panel-intro">{admin
        ? `Leave that counts${person ? ` for ${person.name}` : ''}. This includes approved requests and leave you added. Weekends and holidays inside a range are skipped.`
        : 'Leave that counts for you: approved requests and leave your tech lead added. Each day lowers your hours at work for that week.'}</p>
      {upcoming.length === 0
        ? <div className="inline-empty"><CalendarDays size={21} /><div><strong>No upcoming leave</strong><p>{admin ? 'Add full days, half days, or several days at once.' : 'Request leave, and it appears here after approval.'}</p></div></div>
        : <><p className="leave-group-label leave-list-label">Upcoming · {daysLabel(upcoming.reduce((sum, g) => sum + g.days, 0))}</p><LeaveList data={data} groups={upcoming} mutate={mutate} showName={admin && !personId} canRemove={admin} /></>}
      {past.length > 0 && <div className="leave-past">
        <FormField className="checkbox-label"><FormCheckbox checked={showPast} onCheckedChange={setShowPast} />Show past leave ({daysLabel(past.reduce((sum, g) => sum + g.days, 0))})</FormField>
        {showPast && <LeaveList data={data} groups={past} mutate={mutate} showName={admin && !personId} canRemove={admin} />}
      </div>}
    </Panel>
  </>;
}
