import { describe, expect, it } from 'vitest';
import type { DashboardData, Member, WorkItem } from '../../types';
import {
  addWorkingHours, calculateCapacity, calculateMemberKpi, calculateTeamKpi, defaultSettings,
  getBugKpi, getWeekRange, getWeekStart, getWorkCalendar, isWorkingDay, monthWeekStarts,
  workingHoursBetween,
} from '../index';

const week = '2026-10-12';
const instant = (date: string) => new Date(`${date}+05:30`);
const now = instant('2026-10-26T12:00:00');
const developer: Member = { id: 'dev-1', name: 'Developer', email: 'dev@example.com', role: 'developer', image: null, capacity: 33, isActive: true };
const lead: Member = { ...developer, id: 'lead', role: 'admin', capacity: 10 };

function data(items: WorkItem[] = []): DashboardData {
  return {
    currentUser: lead, members: [developer, lead], projects: [], phases: [], items, activities: [], leaves: [], holidays: [],
    settings: { ...defaultSettings, trackingStartDate: '2026-01-01' }, mode: 'demo',
  };
}

function task(hours: number, completedAt = '2026-10-16T18:00:00', assigneeId = developer.id): WorkItem {
  return {
    id: `task-${hours}-${assigneeId}-${completedAt}`, key: 'UG-1', type: 'task', title: 'Deliver a task', description: '',
    projectId: 'project', phaseId: null, assigneeId, status: 'done', priority: 'medium', severity: 'normal', estimateHours: hours,
    dueDate: null, originalDueDate: null, createdAt: instant('2026-10-12T10:00:00').toISOString(), updatedAt: instant(completedAt).toISOString(),
    startedAt: null, completedAt: instant(completedAt).toISOString(), fixedAt: null, reportedAt: instant('2026-10-12T10:00:00').toISOString(),
    blocker: null, taskId: null, reopenCount: 0,
  };
}

function bug(reportedAt: string, fixedAt: string | null, critical = true): WorkItem {
  return {
    ...task(0), id: `bug-${reportedAt}-${fixedAt}`, type: 'bug', status: fixedAt ? 'fixed' : 'open',
    severity: critical ? 'critical' : 'normal', completedAt: null,
    reportedAt: instant(reportedAt).toISOString(), fixedAt: fixedAt ? instant(fixedAt).toISOString() : null,
  };
}

describe('weekly delivery and capacity', () => {
  it('credits 12 + 8 + 10 hours and applies the developer 80/20 formula', () => {
    const score = calculateMemberKpi(developer, data([task(12), task(8), task(10)]), week, now);
    expect(score).toMatchObject({ creditedHours: 30, capacityHours: 33, deliveryScore: 90.91, bugScore: 100, efficiency: 92.73 });
  });

  it('prorates a full day of leave to 26.4 hours', () => {
    const fixture = data([task(24)]);
    fixture.leaves.push({ id: 'leave', userId: developer.id, date: '2026-10-13', type: 'full_day', note: '' });
    expect(calculateMemberKpi(developer, fixture, week, now)).toMatchObject({ capacityHours: 26.4, deliveryScore: 90.91 });
  });

  it('prorates a half day of leave to 29.7 hours', () => {
    const fixture = data();
    fixture.leaves.push({ id: 'leave', userId: developer.id, date: '2026-10-13', type: 'half_day', note: '' });
    expect(calculateCapacity(developer, fixture, week)).toBe(29.7);
  });

  it('caps delivery points at 100 while showing 121.21 percent raw delivery', () => {
    const score = calculateMemberKpi(developer, data([task(40)]), week, now);
    expect(score).toMatchObject({ deliveryRaw: 121.21, deliveryScore: 100, efficiency: 100 });
  });

  it('deducts a Wednesday holiday and pauses bug clocks on that date', () => {
    const fixture = data();
    fixture.holidays.push({ id: 'holiday', date: '2026-10-14', name: 'Holiday' });
    const calendar = getWorkCalendar(fixture);
    expect(calculateCapacity(developer, fixture, week)).toBe(26.4);
    expect(addWorkingHours(instant('2026-10-13T17:00:00'), 4, calendar)).toEqual(instant('2026-10-15T12:00:00'));
  });

  it('counts Wednesday to Friday for a member who joined Wednesday', () => {
    expect(calculateCapacity({ ...developer, joinedOn: '2026-10-14' }, data(), week)).toBe(19.8);
  });

  it('excludes a developer on leave all week from the team average', () => {
    const other = { ...developer, id: 'dev-2' };
    const fixture = data([task(30, '2026-10-16T18:00:00', other.id)]);
    fixture.members.push(other);
    fixture.leaves = [12, 13, 14, 15, 16].map((day) => ({ id: `leave-${day}`, userId: developer.id, date: `2026-10-${day}`, type: 'full_day', note: '' }));
    expect(calculateMemberKpi(developer, fixture, week, now)).toMatchObject({ efficiency: null, band: 'on_leave' });
    expect(calculateTeamKpi(fixture, week, now).teamEfficiency).toBe(92.73);
  });

  it('uses Asia/Kolkata Sunday and Monday boundaries for completed work', () => {
    const fixture = data([task(12, '2026-10-18T23:30:00'), task(8, '2026-10-19T00:30:00')]);
    expect(calculateMemberKpi(developer, fixture, week, now).creditedHours).toBe(12);
    expect(calculateMemberKpi(developer, fixture, '2026-10-19', now).creditedHours).toBe(8);
  });

  it('does not deduct leave a second time when its date is a holiday', () => {
    const fixture = data();
    fixture.holidays = [{ id: 'holiday', date: '2026-10-14', name: 'Holiday' }];
    fixture.leaves = [{ id: 'leave', userId: developer.id, date: '2026-10-14', type: 'full_day', note: '' }];
    expect(calculateCapacity(developer, fixture, week)).toBe(26.4);
  });

  it('does not deduct leave or holidays on the weekend', () => {
    const fixture = data();
    fixture.holidays = [{ id: 'holiday', date: '2026-10-17', name: 'Holiday' }];
    fixture.leaves = [{ id: 'leave', userId: developer.id, date: '2026-10-18', type: 'full_day', note: '' }];
    expect(calculateCapacity(developer, fixture, week)).toBe(33);
  });

  it('respects the tracking start date even for older members', () => {
    const fixture = data();
    fixture.settings.trackingStartDate = '2026-10-15';
    expect(calculateCapacity({ ...developer, joinedOn: '2025-01-01' }, fixture, week)).toBe(13.2);
    expect(calculateCapacity(developer, fixture, '2026-10-05')).toBe(0);
  });

  it('counts only approved tasks, while pending hours include blocked and review tasks', () => {
    const fixture = data([task(5), { ...task(8), status: 'in_review' }, { ...task(12), status: 'blocked' }]);
    expect(calculateMemberKpi(developer, fixture, week, now)).toMatchObject({ creditedHours: 5, pendingHours: 20, openTasks: 2 });
  });

  it('counts hours at work only up to today during the current week', () => {
    const wednesday = instant('2026-10-14T11:00:00');
    const score = calculateMemberKpi(developer, data([task(12, '2026-10-13T18:00:00')]), week, wednesday);
    // Monday to Wednesday is 3 of 5 days: 19.8 of 33 hours.
    expect(score).toMatchObject({ capacityHours: 19.8, weekCapacityHours: 33, creditedHours: 12, deliveryScore: 60.61 });
  });

  it('subtracts leave already taken from hours at work so far', () => {
    const fixture = data();
    fixture.leaves.push({ id: 'leave', userId: developer.id, date: '2026-10-13', type: 'full_day', note: '' });
    fixture.leaves.push({ id: 'later', userId: developer.id, date: '2026-10-16', type: 'full_day', note: '' });
    const score = calculateMemberKpi(developer, fixture, week, instant('2026-10-14T11:00:00'));
    expect(score).toMatchObject({ capacityHours: 13.2, weekCapacityHours: 19.8 });
  });

  it('has no hours at work yet for a future week', () => {
    const score = calculateMemberKpi(developer, data(), '2026-10-19', instant('2026-10-14T11:00:00'));
    expect(score).toMatchObject({ capacityHours: 0, weekCapacityHours: 33, efficiency: null, band: 'on_leave' });
  });

  it('handles duplicate leave rows without negative capacity', () => {
    const fixture = data();
    fixture.leaves = [1, 2].map((id) => ({ id: `${id}`, userId: developer.id, date: '2026-10-13', type: 'full_day', note: '' }));
    expect(calculateCapacity(developer, fixture, week)).toBe(26.4);
  });
});

describe('bug clocks and score attribution', () => {
  it('scores a critical bug fixed in 3.5 working hours at 100', () => {
    expect(getBugKpi(bug('2026-10-12T11:00:00', '2026-10-12T14:30:00'), data(), now)).toMatchObject({ resolutionWorkingHours: 3.5, score: 100 });
  });

  it('scores a critical bug fixed in 7 working hours at 50', () => {
    expect(getBugKpi(bug('2026-10-12T11:00:00', '2026-10-12T18:00:00'), data(), now)).toMatchObject({ resolutionWorkingHours: 7, score: 50 });
  });

  it('skips weekends and counts a Friday-to-Tuesday fix in the Tuesday week', () => {
    const item = bug('2026-10-09T17:00:00', '2026-10-13T12:00:00', false);
    const fixture = data([item]);
    expect(getBugKpi(item, fixture, now)).toMatchObject({ resolutionWorkingHours: 13, score: 100 });
    expect(calculateMemberKpi(developer, fixture, '2026-10-05', now).bugsScored).toBe(0);
    expect(calculateMemberKpi(developer, fixture, week, now).bugsScored).toBe(1);
  });

  it('scores an unresolved normal bug once at Thursday closing after 36 working hours', () => {
    const item = bug('2026-10-12T10:00:00', null, false);
    const fixture = data([item]);
    expect(getBugKpi(item, fixture, now)).toMatchObject({ deadline2: instant('2026-10-15T19:00:00'), scoredAt: instant('2026-10-15T19:00:00'), score: 0 });
    expect(calculateMemberKpi(developer, fixture, week, now).bugsScored).toBe(1);
    expect(calculateMemberKpi(developer, fixture, '2026-10-19', now).bugsScored).toBe(0);
  });

  it('starts the clock on Monday for a Saturday report', () => {
    expect(getBugKpi(bug('2026-10-17T12:00:00', null), data(), now).deadline1).toEqual(instant('2026-10-19T14:00:00'));
  });

  it('pauses on assignee full-day leave', () => {
    const fixture = data();
    fixture.leaves.push({ id: 'leave', userId: developer.id, date: '2026-10-13', type: 'full_day', note: '' });
    expect(getBugKpi(bug('2026-10-12T17:00:00', null), fixture, now).deadline1).toEqual(instant('2026-10-14T12:00:00'));
  });

  it('keeps the normal clock on half-day leave, which only changes capacity', () => {
    const fixture = data();
    fixture.leaves.push({ id: 'leave', userId: developer.id, date: '2026-10-13', type: 'half_day', note: '' });
    expect(getBugKpi(bug('2026-10-12T17:00:00', null), fixture, now).deadline1).toEqual(instant('2026-10-13T12:00:00'));
  });

  it('averages scores of 100, 100, and 50 to 83.33', () => {
    const fixture = data([
      bug('2026-10-12T11:00:00', '2026-10-12T14:30:00'),
      bug('2026-10-13T10:00:00', '2026-10-13T13:00:00'),
      bug('2026-10-14T11:00:00', '2026-10-14T18:00:00'),
    ]);
    expect(calculateMemberKpi(developer, fixture, week, now)).toMatchObject({ bugScore: 83.33, bugsScored: 3 });
  });

  it('includes exactly the target and double-target instant in their respective bands', () => {
    const onTime = bug('2026-10-12T11:00:00', '2026-10-12T15:00:00');
    const atDouble = bug('2026-10-12T11:00:00', '2026-10-12T19:00:00');
    expect(getBugKpi(onTime, data(), now).score).toBe(100);
    expect(getBugKpi(atDouble, data(), now).score).toBe(50);
  });

  it('keeps a late fix in the deadline week and never scores it again in its fix week', () => {
    const item = bug('2026-10-12T10:00:00', '2026-10-20T12:00:00', false);
    const fixture = data([item]);
    expect(getBugKpi(item, fixture, now)).toMatchObject({ score: 0, scoredAt: instant('2026-10-15T19:00:00') });
    expect(calculateMemberKpi(developer, fixture, week, now).bugsScored).toBe(1);
    expect(calculateMemberKpi(developer, fixture, '2026-10-19', now).bugsScored).toBe(0);
  });

  it('keeps the original report clock after reopening', () => {
    const item = { ...bug('2026-10-12T11:00:00', null), reopenCount: 2, updatedAt: instant('2026-10-13T12:00:00').toISOString() };
    expect(getBugKpi(item, data(), now)).toMatchObject({ deadline1: instant('2026-10-12T15:00:00'), score: 0, scoredAt: instant('2026-10-12T19:00:00') });
  });

  it('does not score a still-open bug before twice the target', () => {
    const item = bug('2026-10-12T11:00:00', null);
    expect(getBugKpi(item, data(), instant('2026-10-12T18:59:59')).score).toBeNull();
    expect(getBugKpi(item, data(), instant('2026-10-12T19:00:00')).score).toBe(0);
  });
});

describe('team scores', () => {
  it('scores developers only; an admin is neither scored nor counted', () => {
    const fixture = data([task(31)]);
    fixture.members = [{ ...developer, capacity: 40 }, lead];
    const kpis = calculateTeamKpi(fixture, week, now);
    expect(kpis.members.map((kpi) => kpi.memberId)).toEqual([developer.id]);
    expect(kpis.developers).toHaveLength(1);
    expect(kpis.capacityHours).toBe(kpis.developers[0].capacityHours);
  });

  it('excludes inactive developers', () => {
    const fixture = data([task(33)]);
    fixture.members.push({ ...developer, id: 'inactive', isActive: false });
    expect(calculateTeamKpi(fixture, week, now)).toMatchObject({ teamEfficiency: 100, capacityHours: 33 });
  });

  it('does not produce NaN when there are no active developers or no capacity', () => {
    const fixture = data();
    fixture.members = [{ ...lead, capacity: 0 }];
    expect(calculateTeamKpi(fixture, week, now)).toMatchObject({ teamEfficiency: null, capacityHours: 0, deliveryScore: 0 });
  });
});

describe('working calendar and date helpers', () => {
  it('returns UTC instants for Monday midnight to Sunday last millisecond in India', () => {
    expect(getWeekRange(week)).toEqual({ start: new Date('2026-10-11T18:30:00.000Z'), end: new Date('2026-10-18T18:29:59.999Z') });
    expect(getWeekStart(new Date('2026-10-18T18:29:59Z'))).toBe(week);
    expect(getWeekStart(new Date('2026-10-18T18:30:00Z'))).toBe('2026-10-19');
  });

  it('rolls a before-hours or after-hours report to the office window', () => {
    const calendar = getWorkCalendar(data());
    expect(addWorkingHours(instant('2026-10-12T08:00:00'), 4, calendar)).toEqual(instant('2026-10-12T14:00:00'));
    expect(addWorkingHours(instant('2026-10-12T20:00:00'), 4, calendar)).toEqual(instant('2026-10-13T14:00:00'));
  });

  it('counts no time when the range is reversed or outside office hours', () => {
    const calendar = getWorkCalendar(data());
    expect(workingHoursBetween(now, instant('2026-10-12T08:00:00'), calendar)).toBe(0);
    expect(workingHoursBetween(instant('2026-10-12T19:00:00'), instant('2026-10-13T10:00:00'), calendar)).toBe(0);
  });

  it('preserves exact office-closing deadlines', () => {
    expect(addWorkingHours(instant('2026-10-12T10:00:00'), 9, getWorkCalendar(data()))).toEqual(instant('2026-10-12T19:00:00'));
  });

  it('supports a custom working-day calendar', () => {
    const calendar = { ...getWorkCalendar(data()), workingDays: [2, 3, 4, 5, 6] };
    expect(isWorkingDay('2026-10-12', calendar)).toBe(false);
    expect(addWorkingHours(instant('2026-10-16T18:00:00'), 2, calendar)).toEqual(instant('2026-10-17T11:00:00'));
  });

  it('uses Monday membership for a monthly view', () => {
    expect(monthWeekStarts('2026-10')).toEqual(['2026-10-05', '2026-10-12', '2026-10-19', '2026-10-26']);
  });
});

describe('locked weekly reports', () => {
  function lock(fixture: DashboardData, weekStart: string, time = now) {
    const result = calculateTeamKpi(fixture, weekStart, time);
    fixture.snapshots = [...(fixture.snapshots || []), ...result.members.map((member) => ({
      userId: member.memberId, weekStart,
      value: { ...member, teamEfficiency: result.teamEfficiency, teamBand: result.band },
    }))];
    return result;
  }

  it('keeps delivery, capacity, score and band frozen after settings and task changes', () => {
    const fixture = data([task(30)]);
    const original = lock(fixture, week).developers[0];
    fixture.items[0] = { ...fixture.items[0], status: 'in_progress', completedAt: null, estimateHours: 40 };
    fixture.members[0] = { ...developer, capacity: 50 };
    fixture.settings.deliveryWeight = 20;
    fixture.settings.bugWeight = 80;
    fixture.settings.bandOnTarget = 95;
    fixture.holidays.push({ id: 'holiday', date: '2026-10-14', name: 'New holiday' });
    const frozen = calculateMemberKpi(fixture.members[0], fixture, week, now);
    expect(frozen).toMatchObject({
      capacityHours: original.capacityHours, creditedHours: original.creditedHours,
      deliveryScore: original.deliveryScore, efficiency: original.efficiency, band: original.band,
      isLocked: true, pendingHours: 40, openTasks: 1,
    });
    expect(calculateTeamKpi(fixture, week, now).band).toBe('on_target');
  });

  it('preserves historical team membership and developer role', () => {
    const fixture = data([task(31), task(8, '2026-10-16T18:00:00', lead.id)]);
    fixture.members = [{ ...developer, capacity: 40 }, lead];
    lock(fixture, week);
    fixture.members = [{ ...developer, role: 'admin', capacity: 90, isActive: false }, lead, { ...developer, id: 'new-developer', joinedOn: '2026-10-19' }];
    const historical = calculateTeamKpi(fixture, week, now);
    expect(historical).toMatchObject({ teamEfficiency: 82, capacityHours: 40 });
    expect(historical.developers).toHaveLength(1);
    expect(historical.developers[0].member).toMatchObject({ role: 'developer', isActive: true });
  });

  it('reads the old user role in locked reports as developer without changing the score', () => {
    const fixture = data([task(30)]);
    const original = lock(fixture, week).developers[0];
    const row = fixture.snapshots!.find(snapshot => snapshot.userId === developer.id)!;
    row.value.member = { ...developer, role: 'user' };
    fixture.members = [{ ...developer, role: 'admin', capacity: 80 }, lead];
    const historical = calculateTeamKpi(fixture, week, now);
    expect(historical.developers).toHaveLength(1);
    expect(historical.developers[0]).toMatchObject({
      isLocked: true, efficiency: original.efficiency, capacityHours: original.capacityHours,
      member: { role: 'developer' },
    });
    expect(row.value.member).toMatchObject({ role: 'user' });
  });

  it('preserves null efficiency and zero capacity when leave later changes', () => {
    const fixture = data();
    fixture.leaves = [12, 13, 14, 15, 16].map((day) => ({ id: `${day}`, userId: developer.id, date: `2026-10-${day}`, type: 'full_day', note: '' }));
    lock(fixture, week);
    fixture.leaves = [];
    expect(calculateMemberKpi(developer, fixture, week, now)).toMatchObject({ capacityHours: 0, efficiency: null, band: 'on_leave', isLocked: true });
    expect(calculateTeamKpi(fixture, week, now).teamEfficiency).toBeNull();
  });

  it('scores a Friday fix only once when it is locked then reopened next week', () => {
    const item = bug('2026-10-09T10:00:00', '2026-10-09T18:00:00', false);
    const fixture = data([item]);
    const previous = lock(fixture, '2026-10-05', instant('2026-10-12T00:30:00'));
    expect(previous.developers[0]).toMatchObject({ bugsScored: 1, bugScore: 100, scoredBugIds: [item.id] });
    fixture.items[0] = { ...item, status: 'open', fixedAt: null, reopenCount: 1 };
    // The original clock remains overdue, but its weekly score allocation is already locked.
    expect(getBugKpi(fixture.items[0], fixture, now)).toMatchObject({ score: 0, deadline2: instant('2026-10-14T19:00:00') });
    const firstWeek = calculateMemberKpi(developer, fixture, '2026-10-05', now);
    const secondWeek = calculateMemberKpi(developer, fixture, week, now);
    expect(firstWeek).toMatchObject({ bugsScored: 1, bugScore: 100 });
    expect(secondWeek).toMatchObject({ bugsScored: 0, bugScore: 100, scoredBugIds: [], openBugs: 1 });
    expect(firstWeek.bugsScored + secondWeek.bugsScored).toBe(1);
  });

  it('does not score a locked bug again after reassignment to another developer', () => {
    const item = bug('2026-10-09T10:00:00', '2026-10-09T18:00:00', false);
    const fixture = data([item]);
    const other = { ...developer, id: 'other-developer' };
    fixture.members.push(other);
    lock(fixture, '2026-10-05', instant('2026-10-12T00:30:00'));
    fixture.items[0] = { ...item, assigneeId: other.id, status: 'open', fixedAt: null, reopenCount: 1 };
    expect(calculateMemberKpi(other, fixture, week, now)).toMatchObject({ bugsScored: 0, scoredBugIds: [], openBugs: 1 });
  });

  it('still scores a newly reported bug after excluding previously allocated IDs', () => {
    const old = bug('2026-10-09T10:00:00', '2026-10-09T18:00:00', false);
    const fixture = data([old]);
    lock(fixture, '2026-10-05', instant('2026-10-12T00:30:00'));
    const current = bug('2026-10-12T11:00:00', '2026-10-12T18:00:00');
    fixture.items.push(current);
    expect(calculateMemberKpi(developer, fixture, week, now)).toMatchObject({ bugsScored: 1, bugScore: 50, scoredBugIds: [current.id] });
  });

  it('supports allocation-only rows without exposing another developer snapshot', () => {
    const reopened = bug('2026-10-09T10:00:00', null, false);
    const fixture = data([reopened]);
    fixture.currentUser = developer;
    fixture.members = [developer];
    fixture.snapshots = [{ userId: 'allocation', weekStart: '2026-10-05', value: { scoredBugIds: [reopened.id] } }];
    expect(calculateMemberKpi(developer, fixture, week, now)).toMatchObject({ bugsScored: 0, scoredBugIds: [], openBugs: 1 });
    expect(calculateTeamKpi(fixture, week, now).developers).toHaveLength(1);
  });

  it('falls back to live calculations for malformed snapshot JSON', () => {
    const fixture = data([task(30)]);
    fixture.snapshots = [{ userId: developer.id, weekStart: week, value: { efficiency: 'bad-data' } }];
    expect(calculateMemberKpi(developer, fixture, week, now)).toMatchObject({ creditedHours: 30, efficiency: 92.73, isLocked: false });
    expect(calculateTeamKpi(fixture, week, now).teamEfficiency).toBe(92.73);
  });
});
