import type { Activity, DashboardData, ExtensionReason, Project, WorkItem } from './types';

/** How a project is doing against its target date. */
export type TimelineHealth = 'no_target' | 'not_started' | 'on_track' | 'behind' | 'overdue' | 'complete';
export const healthLabels: Record<TimelineHealth, string> = {
  no_target: 'No target date', not_started: 'Not started', on_track: 'On track', behind: 'Behind plan', overdue: 'Past target', complete: 'Complete',
};
export const reasonLabels: Record<ExtensionReason, string> = {
  blocked_dependency: 'Waiting on someone', scope_change: 'Scope grew', underestimated: 'Took longer', other: 'Other',
};
/** A project is behind plan when the share of time used runs this many points ahead of the share of work done. */
export const BEHIND_PLAN_GAP = 15;

export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}
export function addDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

/**
 * Every move of a date that was already set, oldest first. Setting the first date is planning, not an extension.
 * Tickets log `task.due_changed`; projects log `project.target_changed`.
 */
export function extensionHistory(data: Pick<DashboardData, 'activities'>, entityId: string): Activity[] {
  return data.activities
    .filter(a => a.entityId === entityId && (a.action.endsWith('.due_changed') || a.action === 'project.target_changed') && typeof a.payload.from === 'string' && typeof a.payload.to === 'string')
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}
export function reasonLabel(category: unknown): string | null {
  return typeof category === 'string' && category in reasonLabels ? reasonLabels[category as ExtensionReason] : null;
}

export interface ProjectTimeline {
  startDate: string | null;
  targetDate: string | null;
  originalTargetDate: string | null;
  extensions: Activity[];
  /** Calendar days between the first target and the current one. */
  extendedDays: number;
  totalHours: number;
  doneHours: number;
  /** Share of ticket hours approved, 0–100. */
  workPercent: number;
  /** Share of the start → target window that has passed, 0–100. Null without both dates. */
  timePercent: number | null;
  /** Calendar days until the target. Negative once it has passed. */
  daysLeft: number | null;
  health: TimelineHealth;
}

export function projectTimeline(data: DashboardData, project: Project, today: string): ProjectTimeline {
  const tickets = data.items.filter(item => item.projectId === project.id && item.type === 'task');
  const totalHours = tickets.reduce((sum, item) => sum + item.estimateHours, 0);
  const doneHours = tickets.filter(item => item.status === 'done').reduce((sum, item) => sum + item.estimateHours, 0);
  const workPercent = totalHours ? doneHours / totalHours * 100 : 0;
  const { startDate, targetDate } = project;
  const originalTargetDate = project.originalTargetDate ?? targetDate;
  const span = startDate && targetDate ? daysBetween(startDate, targetDate) : null;
  const timePercent = span === null ? null : span <= 0 ? (today >= targetDate! ? 100 : 0) : Math.min(100, Math.max(0, daysBetween(startDate!, today) / span * 100));
  const daysLeft = targetDate ? daysBetween(today, targetDate) : null;
  const allDone = tickets.length > 0 && tickets.every(item => item.status === 'done');
  const health: TimelineHealth = allDone ? 'complete'
    : !targetDate ? 'no_target'
    : today > targetDate ? 'overdue'
    : startDate && today < startDate ? 'not_started'
    : timePercent !== null && timePercent - workPercent >= BEHIND_PLAN_GAP ? 'behind'
    : 'on_track';
  return {
    startDate, targetDate, originalTargetDate, extensions: extensionHistory(data, project.id),
    extendedDays: originalTargetDate && targetDate ? Math.max(0, daysBetween(originalTargetDate, targetDate)) : 0,
    totalHours, doneHours, workPercent, timePercent, daysLeft, health,
  };
}

export interface BurnUpPoint { date: string; planned: number; done: number | null }

/**
 * Planned and approved ticket hours over time. Planned counts each ticket from the day it was added;
 * done counts it from the day it was approved. Done stops at today, so the gap to the target stays visible.
 */
export function burnUp(data: DashboardData, project: Project, today: string, timezone = data.settings.timezone): BurnUpPoint[] {
  const tickets = data.items.filter(item => item.projectId === project.id && item.type === 'task');
  if (!tickets.length && !project.startDate) return [];
  const day = (iso: string) => iso.length === 10 ? iso : new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso));
  const added = tickets.map(item => ({ item, added: day(item.createdAt), done: item.status === 'done' && item.completedAt ? day(item.completedAt) : null }));
  const first = [project.startDate, ...added.map(entry => entry.added)].filter((d): d is string => !!d).sort()[0];
  const last = [today, project.targetDate, project.originalTargetDate].filter((d): d is string => !!d).sort().at(-1)!;
  const span = Math.max(1, daysBetween(first, last));
  const step = span <= 31 ? 1 : span <= 120 ? 7 : 14;
  const dates = new Set<string>();
  for (let offset = 0; offset < span; offset += step) dates.add(addDays(first, offset));
  [last, today, project.targetDate, project.originalTargetDate].forEach(date => { if (date && date >= first) dates.add(date); });
  return [...dates].sort().map(date => ({
    date,
    planned: added.filter(entry => entry.added <= date).reduce((sum, entry) => sum + entry.item.estimateHours, 0),
    done: date > today ? null : added.filter(entry => entry.done && entry.done <= date).reduce((sum, entry) => sum + entry.item.estimateHours, 0),
  }));
}

/** The extra days a ticket's due date has moved from its first value. */
export function ticketExtendedDays(item: Pick<WorkItem, 'dueDate' | 'originalDueDate'>): number {
  return item.dueDate && item.originalDueDate ? Math.max(0, daysBetween(item.originalDueDate, item.dueDate)) : 0;
}
