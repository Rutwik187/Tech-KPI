import type { DashboardData, Member, Settings, WorkItem } from '../types';
import { addWorkingHours, dateKey, isWorkingDay, shiftDate, workingHoursBetween, type WorkCalendar } from './calendar';
import { getWeekRange, getWeekStart } from './week';

export * from './calendar';
export * from './week';

export const defaultSettings: Settings = {
  timezone: 'Asia/Kolkata',
  trackingStartDate: '2026-10-01',
  workingDays: [1, 2, 3, 4, 5],
  workdayStart: '10:00',
  workdayEnd: '19:00',
  defaultDevCapacityHours: 33,
  defaultLeadCapacityHours: 10,
  deliveryWeight: 80,
  bugWeight: 20,
  leadTeamWeight: 70,
  leadOwnWeight: 30,
  criticalTargetHours: 4,
  normalTargetHours: 18,
  bandOnTarget: 85,
  bandBelowTarget: 70,
};

export type EfficiencyBand = 'on_target' | 'below_target' | 'needs_attention' | 'on_leave';

export interface MemberKpi {
  memberId: string;
  member: Member;
  capacityHours: number;
  creditedHours: number;
  /** Percentage before the score cap; 40 hours / 33 hours is 121.21%. */
  deliveryRaw: number;
  deliveryScore: number;
  bugScore: number;
  bugsScored: number;
  /** Persisted with a locked week so a reopened bug cannot score again in another week. */
  scoredBugIds: string[];
  isLocked: boolean;
  efficiency: number | null;
  band: EfficiencyBand;
  /** Current outstanding workload, not a reconstruction of historic statuses. */
  pendingHours: number;
  openTasks: number;
  openBugs: number;
}

export interface TeamKpi {
  members: MemberKpi[];
  developers: MemberKpi[];
  teamEfficiency: number | null;
  leadEfficiency: number | null;
  capacityHours: number;
  creditedHours: number;
  pendingHours: number;
  openTasks: number;
  openBugs: number;
  bugScore: number;
  bugsScored: number;
  deliveryScore: number;
  band: EfficiencyBand;
}

export interface BugKpi {
  deadline1: Date;
  deadline2: Date;
  score: 0 | 50 | 100 | null;
  scoredAt: Date | null;
  resolutionWorkingHours: number;
  hoursRemaining: number;
  overdueHours: number;
}

export function roundHours(value: number): number {
  return Number(value.toFixed(2));
}

export function efficiencyBand(score: number | null, settings: Settings = defaultSettings): EfficiencyBand {
  if (score === null) return 'on_leave';
  if (score >= settings.bandOnTarget) return 'on_target';
  if (score >= settings.bandBelowTarget) return 'below_target';
  return 'needs_attention';
}

export function getWorkCalendar(data: DashboardData, assigneeId?: string): WorkCalendar {
  return {
    timezone: data.settings.timezone,
    workingDays: data.settings.workingDays,
    workdayStart: data.settings.workdayStart,
    workdayEnd: data.settings.workdayEnd,
    holidays: new Set(data.holidays.map((holiday) => holiday.date)),
    extraDaysOff: assigneeId ? new Set(data.leaves.filter((leave) => leave.userId === assigneeId && leave.type === 'full_day').map((leave) => leave.date)) : undefined,
  };
}

export function calculateCapacity(member: Member & { joinedOn?: string }, data: DashboardData, weekStart: string): number {
  const calendar = getWorkCalendar(data);
  const standardDays = new Set(data.settings.workingDays).size;
  if (standardDays === 0 || member.capacity <= 0) return 0;
  const monday = getWeekStart(weekStart, calendar.timezone);
  const firstDay = [data.settings.trackingStartDate, member.joinedOn || data.settings.trackingStartDate].sort().at(-1) || monday;
  const leaveByDate = new Map<string, number>();
  for (const leave of data.leaves) {
    if (leave.userId === member.id) {
      // A holiday plus leave (or duplicate leave data) must never deduct the day twice.
      leaveByDate.set(leave.date, Math.max(leaveByDate.get(leave.date) || 0, leave.type === 'full_day' ? 1 : 0.5));
    }
  }
  let availableDays = 0;
  for (let day = 0; day < 7; day++) {
    const date = shiftDate(monday, day, calendar.timezone);
    if (date >= firstDay && isWorkingDay(date, calendar)) availableDays += 1 - (leaveByDate.get(date) || 0);
  }
  return roundHours(member.capacity * availableDays / standardDays);
}

export function getBugKpi(bug: WorkItem, data: DashboardData, now: Date = new Date()): BugKpi {
  const calendar = getWorkCalendar(data, bug.assigneeId);
  const target = bug.severity === 'critical' ? data.settings.criticalTargetHours : data.settings.normalTargetHours;
  const reported = new Date(bug.reportedAt);
  const deadline1 = addWorkingHours(reported, target, calendar);
  const deadline2 = addWorkingHours(reported, 2 * target, calendar);
  // Reopening clears fixedAt. reportedAt remains the original report, so it never resets the clock.
  const fixed = bug.fixedAt ? new Date(bug.fixedAt) : null;
  const effectiveFixed = fixed && fixed <= now ? fixed : null;
  let score: BugKpi['score'] = null;
  let scoredAt: Date | null = null;
  if (effectiveFixed && effectiveFixed <= deadline2) {
    score = effectiveFixed <= deadline1 ? 100 : 50;
    scoredAt = effectiveFixed;
  } else if (now >= deadline2) {
    score = 0;
    scoredAt = deadline2;
  }
  const taken = workingHoursBetween(reported, effectiveFixed || now, calendar);
  return {
    deadline1,
    deadline2,
    score,
    scoredAt,
    resolutionWorkingHours: roundHours(taken),
    hoursRemaining: roundHours(Math.max(0, target - taken)),
    overdueHours: roundHours(Math.max(0, taken - target)),
  };
}

function inRange(timestamp: Date, range: { start: Date; end: Date }): boolean {
  return timestamp >= range.start && timestamp <= range.end;
}

function validBand(value: unknown): value is EfficiencyBand {
  return value === 'on_target' || value === 'below_target' || value === 'needs_attention' || value === 'on_leave';
}

function isMember(value: unknown): value is Member | (Omit<Member, 'role'> & { role: 'user' }) {
  if (!value || typeof value !== 'object') return false;
  const member = value as Record<string, unknown>;
  return typeof member.id === 'string' && typeof member.name === 'string' && typeof member.email === 'string'
    && (member.role === 'admin' || member.role === 'developer' || member.role === 'user') && typeof member.capacity === 'number'
    && Number.isFinite(member.capacity) && typeof member.isActive === 'boolean'
    && (typeof member.image === 'string' || member.image === null);
}

/** Validate stored JSON before using it. Older rows without bug IDs remain readable. */
function frozenMemberKpi(value: Record<string, unknown>): MemberKpi | null {
  if (!isMember(value.member) || typeof value.memberId !== 'string' || value.member.id !== value.memberId
    || !validBand(value.band) || !(value.efficiency === null || typeof value.efficiency === 'number' && Number.isFinite(value.efficiency))) return null;
  const numeric = ['capacityHours', 'creditedHours', 'deliveryRaw', 'deliveryScore', 'bugScore', 'bugsScored', 'pendingHours', 'openTasks', 'openBugs'] as const;
  if (numeric.some((field) => typeof value[field] !== 'number' || !Number.isFinite(value[field]))) return null;
  return {
    memberId: value.memberId, member: { ...value.member, role: value.member.role === 'admin' ? 'admin' : 'developer' },
    capacityHours: value.capacityHours as number, creditedHours: value.creditedHours as number,
    deliveryRaw: value.deliveryRaw as number, deliveryScore: value.deliveryScore as number,
    bugScore: value.bugScore as number, bugsScored: value.bugsScored as number,
    efficiency: value.efficiency, band: value.band,
    pendingHours: value.pendingHours as number, openTasks: value.openTasks as number, openBugs: value.openBugs as number,
    scoredBugIds: Array.isArray(value.scoredBugIds) ? value.scoredBugIds.filter((id): id is string => typeof id === 'string') : [],
    isLocked: true,
  };
}

function getFrozenMember(data: DashboardData, weekStart: string, userId: string): MemberKpi | null {
  const monday = getWeekStart(weekStart, data.settings.timezone);
  const snapshot = data.snapshots?.find((row) => row.weekStart === monday && row.userId === userId);
  return snapshot ? frozenMemberKpi(snapshot.value) : null;
}

function weeklyMembers(data: DashboardData, weekStart: string): Member[] {
  const monday = getWeekStart(weekStart, data.settings.timezone);
  const frozen = data.snapshots?.filter((row) => row.weekStart === monday)
    .map((row) => frozenMemberKpi(row.value)).filter((row): row is MemberKpi => row !== null);
  // A locked report describes the team that existed then, including its roles and active state.
  if (frozen?.length) return frozen.map((row) => row.member);
  return data.members.filter((member) => member.isActive);
}

function liveWorkload(memberId: string, data: DashboardData) {
  const assigned = data.items.filter((item) => item.assigneeId === memberId);
  const pendingTasks = assigned.filter((item) => item.type === 'task' && item.status !== 'done');
  return {
    pendingHours: roundHours(pendingTasks.reduce((sum, item) => sum + item.estimateHours, 0)),
    openTasks: pendingTasks.length,
    openBugs: assigned.filter((item) => item.type === 'bug' && (item.status === 'open' || item.status === 'in_progress')).length,
  };
}

function baseMemberKpi(member: Member, data: DashboardData, weekStart: string, now: Date): MemberKpi {
  const frozen = getFrozenMember(data, weekStart, member.id);
  if (frozen) return { ...frozen, ...liveWorkload(member.id, data) };
  const range = getWeekRange(weekStart, data.settings.timezone);
  const monday = getWeekStart(weekStart, data.settings.timezone);
  const assigned = data.items.filter((item) => item.assigneeId === member.id);
  const capacityHours = calculateCapacity(member, data, weekStart);
  const creditedRaw = assigned.filter((item) => item.type === 'task' && item.status === 'done'
    && item.completedAt && new Date(item.completedAt) <= now && inRange(new Date(item.completedAt), range))
    .reduce((sum, item) => sum + item.estimateHours, 0);
  const creditedHours = roundHours(creditedRaw);
  const deliveryRaw = capacityHours > 0 ? creditedRaw / capacityHours * 100 : 0;
  const deliveryScore = Math.min(deliveryRaw, 100);
  const previouslyScored = new Set(data.snapshots?.filter((row) => row.weekStart !== monday)
    .flatMap((row) => Array.isArray(row.value.scoredBugIds) ? row.value.scoredBugIds.filter((id): id is string => typeof id === 'string') : []) || []);
  const scores = assigned.filter((item) => item.type === 'bug' && !previouslyScored.has(item.id))
    .map((item) => ({ ...getBugKpi(item, data, now), id: item.id }))
    .filter((bug) => bug.score !== null && bug.scoredAt && inRange(bug.scoredAt, range));
  const bugScore = scores.length ? scores.reduce((sum, bug) => sum + (bug.score || 0), 0) / scores.length : 100;
  const efficiency = capacityHours === 0 ? null : roundHours(deliveryScore * data.settings.deliveryWeight / 100 + bugScore * data.settings.bugWeight / 100);
  return {
    memberId: member.id,
    member,
    capacityHours,
    creditedHours,
    deliveryRaw: roundHours(deliveryRaw),
    deliveryScore: roundHours(deliveryScore),
    bugScore: roundHours(bugScore),
    bugsScored: scores.length,
    scoredBugIds: scores.map((bug) => bug.id),
    isLocked: false,
    efficiency,
    band: efficiencyBand(efficiency, data.settings),
    ...liveWorkload(member.id, data),
  };
}

function mean(values: number[]): number | null {
  return values.length ? roundHours(values.reduce((sum, value) => sum + value, 0) / values.length) : null;
}

function leadScore(own: MemberKpi, teamEfficiency: number | null, settings: Settings): number | null {
  if (own.capacityHours === 0) return teamEfficiency;
  if (teamEfficiency === null) return own.deliveryScore;
  return roundHours(teamEfficiency * settings.leadTeamWeight / 100 + own.deliveryScore * settings.leadOwnWeight / 100);
}

export function calculateMemberKpi(member: Member, data: DashboardData, weekStart: string, now = new Date()): MemberKpi {
  const own = baseMemberKpi(member, data, weekStart, now);
  if (own.isLocked || own.member.role !== 'admin') return own;
  const developerScores = weeklyMembers(data, weekStart).filter((developer) => developer.role === 'developer' && developer.isActive)
    .map((developer) => baseMemberKpi(developer, data, weekStart, now).efficiency).filter((score): score is number => score !== null);
  const efficiency = leadScore(own, mean(developerScores), data.settings);
  return { ...own, efficiency, band: efficiencyBand(efficiency, data.settings) };
}

export function calculateTeamKpi(data: DashboardData, weekStart: string, now = new Date()): TeamKpi {
  const base = weeklyMembers(data, weekStart).map((member) => baseMemberKpi(member, data, weekStart, now));
  const developers = base.filter((kpi) => kpi.member.role === 'developer');
  const teamEfficiency = mean(developers.map((kpi) => kpi.efficiency).filter((score): score is number => score !== null));
  const members = base.map((kpi) => {
    if (kpi.isLocked || kpi.member.role !== 'admin') return kpi;
    const efficiency = leadScore(kpi, teamEfficiency, data.settings);
    return { ...kpi, efficiency, band: efficiencyBand(efficiency, data.settings) };
  });
  const lead = members.find((kpi) => kpi.memberId === data.currentUser.id && kpi.member.role === 'admin')
    || members.find((kpi) => kpi.member.role === 'admin');
  const capacityHours = roundHours(developers.reduce((sum, kpi) => sum + kpi.capacityHours, 0));
  const creditedHours = roundHours(developers.reduce((sum, kpi) => sum + kpi.creditedHours, 0));
  const bugsScored = developers.reduce((sum, kpi) => sum + kpi.bugsScored, 0);
  const frozenTeamBand = data.snapshots?.find((row) => row.weekStart === getWeekStart(weekStart, data.settings.timezone) && validBand(row.value.teamBand))?.value.teamBand;
  return {
    members,
    developers,
    teamEfficiency,
    leadEfficiency: lead?.efficiency ?? null,
    capacityHours,
    creditedHours,
    pendingHours: roundHours(developers.reduce((sum, kpi) => sum + kpi.pendingHours, 0)),
    openTasks: developers.reduce((sum, kpi) => sum + kpi.openTasks, 0),
    openBugs: developers.reduce((sum, kpi) => sum + kpi.openBugs, 0),
    bugScore: bugsScored ? roundHours(developers.reduce((sum, kpi) => sum + kpi.bugScore * kpi.bugsScored, 0) / bugsScored) : 100,
    bugsScored,
    deliveryScore: capacityHours ? roundHours(Math.min(creditedHours / capacityHours * 100, 100)) : 0,
    band: validBand(frozenTeamBand) ? frozenTeamBand : efficiencyBand(teamEfficiency, data.settings),
  };
}

export function getTeamTrend(data: DashboardData, weekStart = getWeekStart(new Date(), data.settings.timezone), weeks = 8, now = new Date()) {
  return Array.from({ length: Math.max(0, weeks) }, (_, index) => {
    const start = shiftDate(weekStart, (index - weeks + 1) * 7, data.settings.timezone);
    const kpi = calculateTeamKpi(data, start, now);
    return { weekStart: start, efficiency: kpi.teamEfficiency, capacityHours: kpi.capacityHours, creditedHours: kpi.creditedHours };
  });
}

export function getMemberTrend(member: Member, data: DashboardData, weekStart = getWeekStart(new Date(), data.settings.timezone), weeks = 8, now = new Date()) {
  return Array.from({ length: Math.max(0, weeks) }, (_, index) => {
    const start = shiftDate(weekStart, (index - weeks + 1) * 7, data.settings.timezone);
    return { weekStart: start, ...calculateMemberKpi(member, data, start, now) };
  });
}

export function isOverdue(item: WorkItem, data: DashboardData, now = new Date()): boolean {
  if (item.type === 'bug') return (item.status === 'open' || item.status === 'in_progress') && now > getBugKpi(item, data, now).deadline1;
  return item.status !== 'done' && !!item.dueDate && item.dueDate < dateKey(now, data.settings.timezone);
}
