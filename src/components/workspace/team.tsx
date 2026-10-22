"use client";

import { useState } from 'react';
import clsx from 'clsx';
import { ArrowUpRight, CalendarDays, CalendarPlus, Clock3, Coffee, Pencil, Search, ShieldCheck, UserRound, Users, X } from 'lucide-react';
import type { DashboardData, Member } from '@/lib/types';
import { calculateMemberKpi, getWeekStart, shiftDate } from '@/lib/kpi';
import { Avatar, EmptyState, FormCheckbox, FormField, Modal, Panel, StatusBadge } from '@/components/ui';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/components/ui/input-group';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { displayDate, displayRange, findMember, groupLeaves, hours, isDone, percent, today, type LeaveGroup, type MutationFn } from './lib';
import { ScoreBadge } from './parts';

type TeamProps = { data: DashboardData; week: string; onEdit: (member: Member) => void; onLeave: (userId?: string) => void; mutate: MutationFn; onOpen: (id: string) => void };

export function Team({ data, week, onEdit, onLeave, mutate, onOpen }: TeamProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [showPast, setShowPast] = useState(false);
  const day = today(data.settings.timezone);
  const weekEnd = shiftDate(week, 6, data.settings.timezone);
  const current = week === getWeekStart(new Date(), data.settings.timezone);
  const shown = data.members.filter(m => `${m.name} ${m.email}`.toLowerCase().includes(search.trim().toLowerCase()))
    .sort((a, b) => Number(b.isActive) - Number(a.isActive) || Number(b.role === 'admin') - Number(a.role === 'admin') || a.name.localeCompare(b.name));
  const developers = data.members.filter(m => m.isActive && m.role === 'developer');
  // Only admins receive Microsoft IDs, and the demo has none, so only a live admin can tell who has not signed in.
  const invited = (m: Member) => data.mode === 'live' && data.currentUser.role === 'admin' && !m.microsoftObjectId;
  const awayThisWeek = new Set(data.leaves.filter(l => l.date >= week && l.date <= weekEnd).map(l => l.userId));
  const groups = groupLeaves(data, data.leaves);
  const upcoming = groups.filter(g => g.end >= day).sort((a, b) => a.start.localeCompare(b.start));
  const past = groups.filter(g => g.end < day).sort((a, b) => b.start.localeCompare(a.start)).slice(0, 20);
  const focused = data.members.find(m => m.id === selectedId);

  return <>
    <div className="team-overview-strip">
      <div><span className="mini-metric-icon"><Users size={18} /></span><strong>{developers.length}</strong><span>active developers</span></div>
      <div><span className="mini-metric-icon"><Clock3 size={18} /></span><strong>{hours(developers.reduce((sum, m) => sum + calculateMemberKpi(m, data, week).weekCapacityHours, 0))} h</strong><span>developer hours at work this week</span></div>
      <div><span className="mini-metric-icon"><Coffee size={18} /></span><strong>{awayThisWeek.size}</strong><span>{awayThisWeek.size === 1 ? 'person' : 'people'} on leave this week</span></div>
    </div>

    <Card className="panel">
      <div className="list-toolbar">
        <InputGroup className="search-control"><InputGroupAddon><Search /></InputGroupAddon><InputGroupInput placeholder="Find a team member…" aria-label="Find a team member" value={search} onChange={event => setSearch(event.target.value)} /></InputGroup>
      </div>
      <div className="table-scroll"><Table className="data-table member-table">
        <TableHeader><TableRow><TableHead>Team member</TableHead><TableHead>Role</TableHead><TableHead>Hours at work</TableHead><TableHead>Open work</TableHead><TableHead>Efficiency</TableHead><TableHead><span className="sr-only">Actions</span></TableHead></TableRow></TableHeader>
        <TableBody>{shown.map(m => {
          const score = calculateMemberKpi(m, data, week);
          const leaveDays = data.leaves.filter(l => l.userId === m.id && l.date >= week && l.date <= weekEnd).reduce((sum, l) => sum + (l.type === 'half_day' ? .5 : 1), 0);
          return <TableRow key={m.id} className={m.isActive ? '' : 'inactive-row'}>
            <TableCell><Button variant="ghost" className="person-cell person-button" onClick={() => setSelectedId(m.id)}><Avatar member={m} /><span className="person-text"><strong>{m.name}</strong><span>{m.email}</span></span></Button></TableCell>
            <TableCell><div className="role-cell"><Badge variant="outline" className={clsx('role-tag', m.role === 'admin' && 'role-admin')}>{m.role === 'admin' ? <ShieldCheck size={12} /> : <UserRound size={12} />}{m.role === 'admin' ? 'Admin' : 'Developer'}</Badge>{!m.isActive && <Badge variant="outline" className="access-tag access-inactive"><i />Inactive</Badge>}{m.isActive && invited(m) && <Badge variant="outline" className="access-tag access-invited" title="Added by email. Their Microsoft account links on first sign-in."><i />Not signed in yet</Badge>}</div></TableCell>
            <TableCell><strong className="number-cell">{hours(score.weekCapacityHours)} of {m.capacity} h</strong><span className="cell-subtext">{leaveDays ? `${leaveDays} day${leaveDays === 1 ? '' : 's'} leave this week` : 'No leave this week'}</span></TableCell>
            <TableCell><span className="number-cell">{score.openTasks} tickets · {score.openBugs} bugs</span></TableCell>
            <TableCell><ScoreBadge score={score.efficiency} band={score.band} /></TableCell>
            <TableCell><div className="row-actions">
              {m.isActive && <Button variant="ghost" size="icon" aria-label={`Add leave for ${m.name}`} title="Add leave" onClick={() => onLeave(m.id)}><CalendarPlus size={15} /></Button>}
              <Button variant="ghost" size="icon" aria-label={`Edit ${m.name}`} title="Edit member" onClick={() => onEdit(m)}><Pencil size={15} /></Button>
            </div></TableCell>
          </TableRow>;
        })}</TableBody>
      </Table></div>
      {shown.length === 0 && <EmptyState title="No matching team members" description="Try searching by name or email." />}
    </Card>

    <Panel title="Leave" action={<Button variant="link" size="sm" onClick={() => onLeave()}><CalendarPlus data-icon="inline-start" size={13} />Add leave</Button>}>
      <p className="panel-intro">Leave lowers a person’s hours at work for that week, so it never lowers their score. Weekends and holidays inside a range are skipped.</p>
      {upcoming.length === 0
        ? <div className="inline-empty"><CalendarDays size={21} /><div><strong>No upcoming leave</strong><p>Add full days, half days, or a range of days.</p></div></div>
        : <LeaveList data={data} groups={upcoming} mutate={mutate} />}
      {past.length > 0 && <div className="leave-past">
        <FormField className="checkbox-label"><FormCheckbox checked={showPast} onCheckedChange={setShowPast} />Show past leave ({past.length})</FormField>
        {showPast && <LeaveList data={data} groups={past} mutate={mutate} />}
      </div>}
    </Panel>

    {focused && <MemberDrawer data={data} member={focused} week={week} current={current} onClose={() => setSelectedId(null)}
      onEdit={() => { setSelectedId(null); onEdit(focused); }} onLeave={() => onLeave(focused.id)} onOpen={id => { setSelectedId(null); onOpen(id); }} mutate={mutate} />}
  </>;
}

function LeaveList({ data, groups, mutate, showName = true }: { data: DashboardData; groups: LeaveGroup[]; mutate: MutationFn; showName?: boolean }) {
  const [confirming, setConfirming] = useState<string | null>(null);
  return <div className="availability-list">{groups.map(group => {
    const person = findMember(data, group.userId);
    const key = group.ids.join('-');
    const label = group.type === 'half_day' ? 'Half day' : `${group.days} day${group.days === 1 ? '' : 's'}`;
    return <div className="availability-row" key={key}>
      {showName && <Avatar member={person} size="small" />}
      <div>{showName && <strong>{person?.name ?? 'Team member'}</strong>}<span>{group.note || (group.type === 'half_day' ? 'Half day leave' : 'Leave')}</span></div>
      <Badge variant="outline" className="subtle-tag">{label}</Badge>
      <span className="leave-dates">{displayRange(group.start, group.end)}</span>
      {confirming === key
        ? <span className="confirm-inline"><Button size="sm" variant="destructive" onClick={async () => { if (await mutate({ action: 'deleteLeave', ids: group.ids }, 'Leave removed')) setConfirming(null); }}>Remove</Button><Button size="sm" variant="ghost" onClick={() => setConfirming(null)}>Keep</Button></span>
        : <Button variant="ghost" size="icon" aria-label={`Remove ${person?.name ?? 'this'} leave on ${displayRange(group.start, group.end)}`} onClick={() => setConfirming(key)}><X size={14} /></Button>}
    </div>;
  })}</div>;
}

function MemberDrawer({ data, member, week, current, onClose, onEdit, onLeave, onOpen, mutate }: { data: DashboardData; member: Member; week: string; current: boolean; onClose: () => void; onEdit: () => void; onLeave: () => void; onOpen: (id: string) => void; mutate: MutationFn }) {
  const score = calculateMemberKpi(member, data, week);
  const day = today(data.settings.timezone);
  const leave = groupLeaves(data, data.leaves.filter(l => l.userId === member.id));
  const upcoming = leave.filter(g => g.end >= day).sort((a, b) => a.start.localeCompare(b.start));
  const recent = leave.filter(g => g.end < day).sort((a, b) => b.start.localeCompare(a.start)).slice(0, 5);
  const openWork = data.items.filter(item => item.assigneeId === member.id && !isDone(item));
  return <Modal title={member.name} subtitle={`${member.role === 'admin' ? 'Admin' : 'Developer'} · ${member.email}`} onClose={onClose} drawer>
    <div className="member-detail-body">
      <div className="member-detail-top">
        <Avatar member={member} size="large" />
        <div><h3>{member.name}</h3><p>{member.capacity} h per week</p></div>
        <Button variant="outline" onClick={onEdit}>Edit<Pencil data-icon="inline-end" size={13} /></Button>
      </div>
      <div className="detail-score-grid">
        <div><span>Efficiency</span><strong>{percent(score.efficiency)}</strong></div>
        <div><span>Ticket hours done</span><strong>{hours(score.creditedHours)} h</strong></div>
        <div><span>Hours at work{current ? ' so far' : ''}</span><strong>{hours(score.capacityHours)} h</strong></div>
      </div>
      <h3 className="detail-section-heading">Leave{member.isActive && <Button variant="outline" size="sm" onClick={onLeave}><CalendarPlus data-icon="inline-start" />Add leave</Button>}</h3>
      {upcoming.length === 0 && recent.length === 0 ? <p className="form-help">No leave recorded.</p> : <>
        {upcoming.length > 0 && <><p className="leave-group-label">Upcoming</p><LeaveList data={data} groups={upcoming} mutate={mutate} showName={false} /></>}
        {recent.length > 0 && <><p className="leave-group-label">Recent</p><LeaveList data={data} groups={recent} mutate={mutate} showName={false} /></>}
      </>}
      <h3 className="detail-section-heading">Open work</h3>
      <div className="member-open-items">
        {openWork.map(item => <Button variant="outline" key={item.id} onClick={() => onOpen(item.id)}><span className="item-key">{item.key}</span><strong>{item.title}</strong><StatusBadge status={item.status} /><ArrowUpRight data-icon="inline-end" size={15} /></Button>)}
        {openWork.length === 0 && <p className="form-help">No open work.</p>}
      </div>
      <h3 className="detail-section-heading">Weekly scores</h3>
      <div className="table-scroll"><Table className="data-table history-table">
        <TableHeader><TableRow><TableHead>Week of</TableHead><TableHead>Ticket hours</TableHead><TableHead>Hours at work</TableHead><TableHead>Efficiency</TableHead></TableRow></TableHeader>
        <TableBody>{Array.from({ length: 8 }, (_, index) => {
          const start = shiftDate(week, -7 * index, data.settings.timezone);
          const s = calculateMemberKpi(member, data, start);
          return <TableRow key={start}><TableCell>{displayDate(start)}</TableCell><TableCell>{hours(s.creditedHours)} h</TableCell><TableCell>{hours(s.capacityHours)} h</TableCell><TableCell><ScoreBadge score={s.efficiency} band={s.band} /></TableCell></TableRow>;
        })}</TableBody>
      </Table></div>
    </div>
  </Modal>;
}
