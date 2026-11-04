import type { BugStatus, DashboardData, Department, DueDateRequest, Holiday, Leave, Member, Project, RequestCategory, RequestWork, Settings, TaskStatus, TechRequest, TicketRequest, WorkItem } from '@/lib/types';
import { ADHOC_PROJECT_ID } from '@/lib/project-defaults';
import { dateKey, dueDateAfterHours, getBugKpi, getWorkCalendar, isWorkingDay, localDate, shiftDate } from '@/lib/kpi';

/** The database calls a ticket a "task". Everything a person reads says "ticket". */
export const kindLabels = { task: 'Ticket', bug: 'Bug' } as const;
export const statusLabels: Record<WorkItem['status'], string> = { todo: 'To do', in_progress: 'In progress', blocked: 'Blocked', in_review: 'In review', done: 'Done', open: 'Open', fixed: 'Fixed', verified: 'Verified' };
export const bands = { on_target: 'On target', below_target: 'Below target', needs_attention: 'Needs attention', on_leave: 'No hours at work' };
export const ticketStatuses: TaskStatus[] = ['todo', 'in_progress', 'blocked', 'in_review', 'done'];
export const bugStatuses: BugStatus[] = ['open', 'in_progress', 'fixed', 'verified'];
export const priorities: WorkItem['priority'][] = ['low', 'medium', 'high', 'urgent'];
export const adminOnlyPages = ['standup', 'team', 'other-teams', 'settings'];
const TIMEZONE = 'Asia/Kolkata';

export function isDone(item: WorkItem) { return item.type === 'task' ? item.status === 'done' : item.status === 'verified'; }
export function today(tz = TIMEZONE) { return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()); }
export function displayDate(date: string | Date | null, options?: Intl.DateTimeFormatOptions) {
  if (!date) return 'No date';
  const parsed = typeof date === 'string' ? new Date(date.length === 10 ? `${date}T12:00:00+05:30` : date) : date;
  if (Number.isNaN(parsed.getTime())) return 'Date unavailable';
  return new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: TIMEZONE, ...options }).format(parsed);
}
export function displayDateTime(date: string | Date) {
  return displayDate(date, { hour: '2-digit', minute: '2-digit', hour12: false });
}
export function displayRange(start: string, end: string) {
  return start === end ? displayDate(start, { weekday: 'short' }) : `${displayDate(start)} – ${displayDate(end)}`;
}
export function percent(n: number | null) { return n === null ? '—' : `${Math.round(n)}%`; }
export function hours(n: number) { return Number(n.toFixed(1)); }
export function firstName(member?: Member) { return member?.name.split(' ')[0] ?? 'Unassigned'; }

export function findMember(data: DashboardData, id: string) { return data.members.find(m => m.id === id); }
/** People on the tech team. People from other teams only raise requests, so they never own work or join projects. */
export function techMembers(data: DashboardData) { return data.members.filter(m => m.role !== 'requester'); }
/** Admin, Developer, or someone from another team, such as "Sales team lead" or "Sales team". The code calls them a requester. */
export function roleLabel(data: DashboardData, member: Member) {
  if (member.role !== 'requester') return member.role === 'admin' ? 'Admin' : 'Developer';
  const team = findDepartment(data, member.departmentId)?.name;
  if (member.isTeamLead) return team ? `${team} team lead` : 'Team lead';
  return team ? `${team} team` : 'No team yet';
}
export function findProject(data: DashboardData, id: string) { return data.projects.find(p => p.id === id); }
export function isAdhocProject(project?: Project) { return project?.isAdhoc === true || project?.id === ADHOC_PROJECT_ID; }
/** A project's members, with the primary developer first. */
export function projectTeam(data: DashboardData, project: Project) {
  const ids = project.primaryMemberId ? [project.primaryMemberId, ...project.memberIds.filter(id => id !== project.primaryMemberId)] : project.memberIds;
  return ids.flatMap(id => { const found = findMember(data, id); return found ? [found] : []; });
}
/** Active people who may own new work in a project. A retained owner keeps existing work valid. */
export function projectMembers(data: DashboardData, projectId: string, retainedId?: string) {
  const selected = findProject(data, projectId);
  return data.members.filter(m => (m.isActive && m.role === 'developer' && (isAdhocProject(selected) || selected?.memberIds.includes(m.id))) || m.id === retainedId);
}
/**
 * Which ticket fields the person has picked by hand. An auto-fill never overwrites a hand pick,
 * and only a hand pick triggers an auto-fill, so the project and owner cannot keep changing each other.
 */
export type PickedByHand = { project: boolean; owner: boolean };
/** The project an owner usually works in: the first one they lead, then the first one they belong to, then Ad hoc. */
export function ownerHomeProject(data: DashboardData, ownerId: string) {
  const choices = selectableProjects(data).filter(p => !isAdhocProject(p));
  return (choices.find(p => p.primaryMemberId === ownerId) ?? choices.find(p => p.memberIds.includes(ownerId)))?.id ?? ADHOC_PROJECT_ID;
}
/** Owners to offer. Until a project is picked by hand, anyone active can be picked and the project follows them. */
export function ownerChoices(data: DashboardData, projectId: string, projectPicked: boolean, retainedId?: string) {
  return projectPicked ? projectMembers(data, projectId, retainedId) : data.members.filter(m => m.isActive && m.role === 'developer');
}
/** A project was picked by hand. Its primary developer becomes the owner, unless a hand-picked owner is on the project. */
export function withProject(data: DashboardData, value: WorkClassification, projectId: string, picked: PickedByHand): WorkClassification {
  const eligible = projectMembers(data, projectId);
  const fits = (id?: string | null) => !!id && eligible.some(m => m.id === id);
  const primary = findProject(data, projectId)?.primaryMemberId;
  const assigneeId = picked.owner && fits(value.assigneeId) ? value.assigneeId
    : fits(primary) ? primary! : fits(value.assigneeId) ? value.assigneeId : eligible[0]?.id ?? '';
  return { projectId, phaseId: null, assigneeId };
}
/** An owner was picked by hand. Until a project is picked by hand, the project moves to the owner's main project. */
export function withOwner(data: DashboardData, value: WorkClassification, assigneeId: string, picked: PickedByHand): WorkClassification {
  if (picked.project) return { ...value, assigneeId };
  const projectId = ownerHomeProject(data, assigneeId);
  return projectId === value.projectId ? { ...value, assigneeId } : { projectId, phaseId: null, assigneeId };
}
export function projectPhases(data: DashboardData, projectId: string) { return data.phases.filter(phase => phase.projectId === projectId).sort((a, b) => a.position - b.position); }
export function phaseName(data: DashboardData, phaseId: string | null) { return phaseId ? data.phases.find(phase => phase.id === phaseId)?.name ?? 'Unknown phase' : 'Ad hoc'; }
/** Ad hoc first, then active projects by name. A developer sees only projects they belong to. */
export function selectableProjects(data: DashboardData, retainedProjectId?: string) {
  const admin = data.currentUser.role === 'admin';
  return data.projects
    .filter(p => p.id === retainedProjectId || (!p.isArchived && (admin || isAdhocProject(p) || p.memberIds.includes(data.currentUser.id))))
    .sort((a, b) => Number(isAdhocProject(b)) - Number(isAdhocProject(a)) || a.name.localeCompare(b.name));
}
export function findDepartment(data: DashboardData, id?: string | null): Department | undefined { return id ? data.departments.find(d => d.id === id) : undefined; }
/** Teams a new request can go to, in the admin's order. */
export function activeDepartments(data: DashboardData) { return data.departments.filter(d => !d.isArchived).sort((a, b) => a.position - b.position || a.name.localeCompare(b.name)); }

/** Kinds of request, in the words other teams use. A broken thing usually becomes a bug, everything else a ticket. */
export const requestCategories: { value: RequestCategory; label: string; hint: string }[] = [
  { value: 'feature', label: 'New feature', hint: 'Something new on the website, the app, or a tool you use.' },
  { value: 'change', label: 'Change', hint: 'Update a page, its content, or how something works.' },
  { value: 'problem', label: 'Something is broken', hint: 'An error, or something that stopped working.' },
  { value: 'data', label: 'Data or report', hint: 'A report, an export, or numbers you need.' },
  { value: 'access', label: 'Access or setup', hint: 'Accounts, tools, integrations, or permissions.' },
  { value: 'other', label: 'Something else', hint: 'Anything that does not fit the other kinds.' },
];
export function categoryLabel(category: RequestCategory) { return requestCategories.find(c => c.value === category)?.label ?? 'Request'; }

/**
 * Where a request is, as its requester reads it. A blocked ticket shows as in progress, because a blocker is the tech team's
 * to clear. Work that waits for the admin's approval or verification shows as being checked.
 */
export type RequestStage = 'waiting' | 'assigned' | 'in_progress' | 'checking' | 'done' | 'declined';
export const stageLabels: Record<RequestStage, string> = { waiting: 'Waiting for review', assigned: 'Assigned', in_progress: 'In progress', checking: 'Being checked', done: 'Done', declined: 'Declined' };
/** The ticket or bug a request became. Admins and developers hold the item itself, so it is always current; a requester gets the server's summary. */
export function requestWork(data: DashboardData, request: TechRequest): RequestWork | null {
  const item = request.itemId ? data.items.find(i => i.id === request.itemId) : undefined;
  if (!item) return request.work;
  return {
    key: item.key, type: item.type, status: item.status, assigneeId: item.assigneeId, dueDate: item.dueDate,
    assigneeName: findMember(data, item.assigneeId)?.name ?? request.work?.assigneeName ?? 'A developer',
    doneAt: item.type === 'task' ? item.completedAt : item.fixedAt,
  };
}
export function requestStage(data: DashboardData, request: TechRequest): RequestStage {
  if (request.status === 'new') return 'waiting';
  if (request.status === 'declined') return 'declined';
  const status = requestWork(data, request)?.status;
  return status === 'done' || status === 'verified' ? 'done' : status === 'in_review' || status === 'fixed' ? 'checking' : status === 'in_progress' || status === 'blocked' ? 'in_progress' : 'assigned';
}
/** The request a ticket or bug was made from, if any. */
export function requestForItem(data: DashboardData, itemId: string) { return data.techRequests.find(r => r.itemId === itemId); }
export function requestKey(sequence: number) { return `REQ-${String(sequence).padStart(3, '0')}`; }

export function routeFor(data: DashboardData, section: string) { return `${data.mode === 'demo' ? '/demo' : ''}/${section}`; }
/** The query parameter that opens a ticket or bug by its key, so a link can be shared. */
export const OPEN_PARAM = 'open';
/** A link that opens this ticket or bug on its list page. */
export function itemLink(data: DashboardData, item: WorkItem) {
  const origin = typeof window === 'undefined' ? '' : window.location.origin;
  return `${origin}${routeFor(data, item.type === 'task' ? 'tickets' : 'bugs')}?${OPEN_PARAM}=${encodeURIComponent(item.key)}`;
}

export function downloadCsv(rows: (string | number | null)[][], name: string) {
  const csv = rows.map(row => row.map(value => `"${String(value ?? '').replaceAll('"', '""')}"`).join(',')).join('\n');
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }));
  const link = document.createElement('a');
  link.href = url; link.download = name; link.click();
  URL.revokeObjectURL(url);
}

function sentBack(item: WorkItem, data: DashboardData) {
  if (item.status !== 'in_progress') return null;
  const latest = data.activities.filter(a => a.entityId === item.id && a.action.endsWith('status_changed')).sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
  return latest?.payload.from === 'in_review' && latest.payload.to === 'in_progress' ? latest : null;
}

/** Why an item needs someone's attention now, or null. Admins act on reviews; developers act on their own work. */
export function attentionReason(item: WorkItem, data: DashboardData, day = today()): string | null {
  if (isDone(item)) return null;
  const admin = data.currentUser.role === 'admin';
  if (item.status === 'in_review') return admin ? 'Ready for your review' : null;
  if (item.status === 'fixed') return admin ? 'Fixed · ready to verify' : null;
  if (item.status === 'blocked') return item.blocker ? `Blocked: ${item.blocker}` : 'Blocked';
  if (item.type === 'bug') {
    const kpi = getBugKpi(item, data);
    if (kpi.overdueHours > 0) return `Past its fix-by time by ${hours(kpi.overdueHours)} working h`;
    if (item.severity === 'critical') return `Critical · fix by ${displayDateTime(kpi.deadline1)}`;
    return null;
  }
  if (item.dueDate && item.dueDate < day) return `Carried over from ${displayDate(item.dueDate)}`;
  const returned = sentBack(item, data);
  if (returned && !admin) return returned.reason ? `Sent back: ${returned.reason}` : 'Sent back for changes';
  if (!admin && item.dueDate === day) return 'For today';
  return null;
}
export function attentionItems(data: DashboardData) {
  const day = today(data.settings.timezone);
  const rank = (item: WorkItem) => item.type === 'bug' && item.severity === 'critical' ? 0 : item.status === 'blocked' ? 1 : item.status === 'in_review' || item.status === 'fixed' ? 3 : 2;
  return data.items
    .map(item => ({ item, reason: attentionReason(item, data, day) }))
    .filter((entry): entry is { item: WorkItem; reason: string } => entry.reason !== null)
    .sort((a, b) => rank(a.item) - rank(b.item));
}

export type LeaveGroup = { ids: string[]; userId: string; start: string; end: string; type: Leave['type']; note: string; days: number };
/** Shows consecutive full days of leave as one range. Weekends and holidays inside the range do not break it. */
export function groupLeaves(data: DashboardData, leaves: Leave[]): LeaveGroup[] {
  const calendar = getWorkCalendar(data);
  const tz = data.settings.timezone;
  const onlyDaysOffBetween = (from: string, to: string) => {
    let date = shiftDate(from, 1, tz);
    for (let guard = 0; date < to && guard < 10; guard++) {
      if (isWorkingDay(date, calendar)) return false;
      date = shiftDate(date, 1, tz);
    }
    return date === to;
  };
  const groups: LeaveGroup[] = [];
  for (const leave of [...leaves].sort((a, b) => a.userId.localeCompare(b.userId) || a.date.localeCompare(b.date))) {
    const last = groups.at(-1);
    if (last && last.userId === leave.userId && last.type === 'full_day' && leave.type === 'full_day' && last.note === leave.note && onlyDaysOffBetween(last.end, leave.date)) {
      last.ids.push(leave.id); last.end = leave.date; last.days += 1;
    } else {
      groups.push({ ids: [leave.id], userId: leave.userId, start: leave.date, end: leave.date, type: leave.type, note: leave.note, days: leave.type === 'half_day' ? 0.5 : 1 });
    }
  }
  return groups;
}
/** The working days a leave request covers. Mirrors the server, which skips weekends and holidays in a range. */
export function leaveDays(data: DashboardData, start: string, end: string) {
  if (!start || !end || end < start) return [];
  const calendar = getWorkCalendar(data);
  const days: string[] = [];
  for (let date = start, guard = 0; date <= end && guard < 62; date = shiftDate(date, 1, data.settings.timezone), guard++) {
    if (start === end || isWorkingDay(date, calendar)) days.push(date);
  }
  return days;
}

export type WorkClassification = { projectId: string; phaseId: string | null; assigneeId: string };
type ItemInput = Pick<WorkItem, 'type' | 'title' | 'description' | 'projectId' | 'assigneeId' | 'priority' | 'severity' | 'estimateHours' | 'dueDate' | 'taskId' | 'phaseId'>;
/** The same ticket for several developers. With `doneOn`, it records an event they already attended as finished work. */
export type TeamTicketInput = Pick<WorkItem, 'title' | 'description' | 'projectId' | 'phaseId' | 'priority' | 'estimateHours' | 'dueDate'> & { assigneeIds: string[]; doneOn?: string };
export type RequestInput = Pick<TicketRequest, 'title' | 'description' | 'note' | 'projectId' | 'phaseId' | 'estimateHours' | 'dueDate' | 'priority'>;
export type RequestChanges = Partial<Pick<TicketRequest, 'title' | 'projectId' | 'phaseId' | 'estimateHours' | 'dueDate' | 'priority'>>;
export type PhaseDraft = { name: string; description: string };
export type TechRequestInput = Pick<TechRequest, 'title' | 'description' | 'category' | 'priority' | 'neededBy' | 'departmentId'>;
/** Assigning a request makes a ticket, with an estimate and a date, or a bug, which runs on its fix-by time. */
export type AssignRequestInput = { id: string; type: WorkItem['type']; assigneeId: string; title: string; projectId: string; phaseId: string | null; priority: WorkItem['priority']; severity?: WorkItem['severity']; estimateHours?: number; dueDate?: string | null; note?: string };
export type Mutation =
  | ({ action: 'createItem' } & ItemInput)
  | ({ action: 'createTickets' } & TeamTicketInput)
  | ({ action: 'requestTicket' } & RequestInput)
  | { action: 'approveTicketRequest'; id: string; patch?: RequestChanges; note?: string }
  | { action: 'declineTicketRequest'; id: string; reason: string }
  | { action: 'withdrawTicketRequest'; id: string }
  | { action: 'extendTicket'; itemId: string; hours: number; reasonCategory: DueDateRequest['reasonCategory']; reason: string }
  | { action: 'approveDueDateRequest'; id: string; hours?: number; note?: string }
  | { action: 'declineDueDateRequest'; id: string; reason: string }
  | { action: 'withdrawDueDateRequest'; id: string }
  | { action: 'updateItem'; id: string; patch: Partial<WorkItem>; reason?: string; reasonCategory?: string }
  | { action: 'createMember'; name: string; email: string; microsoftObjectId?: string; role: Member['role']; capacity: number; departmentId?: string | null; isTeamLead?: boolean }
  | { action: 'updateMember'; id: string; patch: Partial<Member> }
  | { action: 'createProject'; name: string; color: string; description: string; memberIds: string[]; primaryMemberId: string | null; phases: PhaseDraft[]; startDate: string | null; targetDate: string | null }
  | { action: 'updateProject'; id: string; patch: Partial<Project>; reason?: string; reasonCategory?: string }
  | { action: 'createPhase'; projectId: string; name: string; description: string }
  | { action: 'updatePhase'; id: string; name?: string; description?: string }
  | { action: 'saveSettings'; settings: Settings }
  | ({ action: 'addLeave'; userIds: string[]; endDate?: string } & Omit<Leave, 'id' | 'userId'>)
  | ({ action: 'addHoliday' } & Omit<Holiday, 'id'>)
  | { action: 'deleteLeave'; ids: string[] }
  | { action: 'deleteHoliday'; id: string }
  | ({ action: 'createTechRequest' } & TechRequestInput)
  | { action: 'updateTechRequest'; id: string; patch: Partial<TechRequestInput> }
  | { action: 'withdrawTechRequest'; id: string }
  | ({ action: 'assignTechRequest' } & AssignRequestInput)
  | { action: 'declineTechRequest'; id: string; reason: string }
  | { action: 'createDepartment'; name: string }
  | { action: 'updateDepartment'; id: string; name?: string; isArchived?: boolean };
export type MutationFn = (mutation: Mutation, message?: string, options?: { optimistic?: boolean }) => Promise<boolean>;
export type OnAction = (item: WorkItem, status: WorkItem['status']) => void;
export type QuickAction = { item: WorkItem; patch: Partial<WorkItem>; requireReason: boolean; label: string };
export type ModalState =
  | { type: 'item'; kind: 'task' | 'bug'; assigneeId?: string }
  | { type: 'member'; member?: Member; role?: Member['role']; departmentId?: string }
  | { type: 'department'; department?: Department }
  | { type: 'project'; project?: Project }
  | { type: 'leave'; userId?: string }
  | { type: 'holiday' }
  | { type: 'teamTicket' }
  | { type: 'extend'; target: ExtendTarget }
  | { type: 'techRequest'; request?: TechRequest }
  | null;
/** What more hours do to a ticket: they join the estimate, and the due date moves by them. The server applies the same rule. */
export function ticketExtension(data: DashboardData, item: WorkItem, hours: number, now = new Date()) {
  return {
    estimate: Math.round((item.estimateHours + hours) * 100) / 100,
    dueDate: item.dueDate ? dueDateAfterHours(item.dueDate, hours, getWorkCalendar(data, item.assigneeId), now) : null,
  };
}
/** The largest estimate a ticket can hold. More work than this belongs in a new ticket. */
export const MAX_TICKET_HOURS = 80;
/** Focused hours in one working day. The estimate's day presets count in these. */
export const WORKDAY_HOURS = 6.5;
export const ESTIMATE_PRESETS = [{ label: 'Half day', hours: WORKDAY_HOURS / 2 }, { label: '1 day', hours: WORKDAY_HOURS }, { label: '2 days', hours: WORKDAY_HOURS * 2 }];
/** A ticket date or a project target that already exists and is being moved. Both need a reason. */
/** A ticket opened with `hours` adds hours even without a date. Without it, a ticket with no date gets its first one. */
export type ExtendTarget = { kind: 'ticket'; item: WorkItem; hours?: boolean } | { kind: 'project'; project: Project };

/** Applies a change to demo data in the browser. It follows the server's rules closely enough to try every flow. */
export function mutateDemo(data: DashboardData, mutation: Mutation, actor: Member): DashboardData {
  const next = structuredClone(data);
  const now = new Date().toISOString();
  const id = crypto.randomUUID();
  const log = (entityId: string, action: string, payload: Record<string, unknown> = {}, reason: string | null = null) =>
    next.activities.unshift({ id: crypto.randomUUID(), entityId, actorId: actor.id, action, reason, payload, createdAt: now });
  const nextKey = () => Math.max(0, ...next.items.map(i => Number(i.key.split('-').pop()) || 0)) + 1;
  function extend(item: WorkItem, hours: number, reasonCategory: string, reason: string, request?: DueDateRequest) {
    if (item.estimateHours + hours > MAX_TICKET_HOURS) throw new Error(`This ticket already has ${item.estimateHours} h. A ticket holds up to ${MAX_TICKET_HOURS} h, so split the extra work into a new ticket.`);
    const { estimate, dueDate } = ticketExtension(next, item, hours);
    // With a due date, the date moves too. Without one, only the estimate grows.
    log(item.id, item.dueDate ? 'task.due_changed' : 'task.hours_added', {
      from: item.dueDate, to: dueDate, addedHours: hours, estimateFrom: item.estimateHours, estimateTo: estimate, reasonCategory,
      ...(request ? { requestId: request.id, requestedBy: request.requesterId, ...(hours !== request.hours ? { requestedHours: request.hours } : {}) } : {}),
    }, reason);
    Object.assign(item, { dueDate, estimateHours: estimate, updatedAt: now });
  }
  switch (mutation.action) {
    case 'requestTicket':
      next.requests.unshift({ id, requesterId: actor.id, title: mutation.title, description: mutation.description, note: mutation.note, projectId: mutation.projectId, phaseId: mutation.phaseId,
        estimateHours: mutation.estimateHours, dueDate: mutation.dueDate, priority: mutation.priority, status: 'pending', reviewedById: null, reviewedAt: null, reviewNote: null, itemId: null, createdAt: now });
      break;
    case 'approveTicketRequest': {
      const request = next.requests.find(r => r.id === mutation.id);
      if (!request || request.status !== 'pending') throw new Error('This request was already reviewed.');
      const final = { ...request, ...mutation.patch };
      next.items.unshift({
        id, key: `UG-${String(nextKey()).padStart(3, '0')}`, type: 'task', title: final.title, description: final.description,
        projectId: final.projectId, phaseId: final.phaseId, assigneeId: request.requesterId, status: 'todo',
        priority: final.priority, severity: 'normal', estimateHours: final.estimateHours, dueDate: final.dueDate, originalDueDate: final.dueDate,
        createdAt: now, updatedAt: now, startedAt: null, completedAt: null, fixedAt: null, reportedAt: now, blocker: null, taskId: null, reopenCount: 0,
      });
      log(id, 'task.created', { estimateHours: final.estimateHours, dueDate: final.dueDate, requestId: request.id });
      Object.assign(request, { status: 'approved', reviewedById: actor.id, reviewedAt: now, reviewNote: mutation.note?.trim() || null, itemId: id });
      break;
    }
    case 'declineTicketRequest': {
      const request = next.requests.find(r => r.id === mutation.id);
      if (!request || request.status !== 'pending') throw new Error('This request was already reviewed.');
      Object.assign(request, { status: 'declined', reviewedById: actor.id, reviewedAt: now, reviewNote: mutation.reason });
      break;
    }
    case 'extendTicket': {
      const item = next.items.find(i => i.id === mutation.itemId);
      if (!item || item.type !== 'task' || !['todo', 'in_progress', 'blocked'].includes(item.status)) throw new Error('Only an open ticket can get more time.');
      if (actor.role === 'admin') { extend(item, mutation.hours, mutation.reasonCategory, mutation.reason); break; }
      if (item.estimateHours + mutation.hours > MAX_TICKET_HOURS) throw new Error(`This ticket already has ${item.estimateHours} h. A ticket holds up to ${MAX_TICKET_HOURS} h, so split the extra work into a new ticket.`);
      if (next.dueDateRequests.some(r => r.itemId === item.id && r.status === 'pending')) throw new Error('An extension for this ticket already waits for approval.');
      next.dueDateRequests.unshift({ id, itemId: item.id, requesterId: actor.id, fromDate: item.dueDate, fromEstimate: item.estimateHours, hours: mutation.hours, approvedHours: null, reasonCategory: mutation.reasonCategory, reason: mutation.reason, status: 'pending', reviewedById: null, reviewedAt: null, reviewNote: null, createdAt: now });
      log(item.id, 'task.due_change_requested', { requestId: id, from: item.dueDate, hours: mutation.hours, reasonCategory: mutation.reasonCategory }, mutation.reason);
      break;
    }
    case 'approveDueDateRequest': {
      const request = next.dueDateRequests.find(r => r.id === mutation.id);
      const item = next.items.find(i => i.id === request?.itemId);
      if (!request || request.status !== 'pending' || !item) throw new Error('This request was already reviewed.');
      if (item.dueDate !== request.fromDate || item.estimateHours !== request.fromEstimate) throw new Error('The ticket\'s date or estimate changed after this request. Decline it, and the developer can ask again.');
      const hours = mutation.hours ?? request.hours;
      extend(item, hours, request.reasonCategory, request.reason, request);
      Object.assign(request, { status: 'approved', approvedHours: hours, reviewedById: actor.id, reviewedAt: now, reviewNote: mutation.note?.trim() || null });
      break;
    }
    case 'declineDueDateRequest': {
      const request = next.dueDateRequests.find(r => r.id === mutation.id);
      if (!request || request.status !== 'pending') throw new Error('This request was already reviewed.');
      Object.assign(request, { status: 'declined', reviewedById: actor.id, reviewedAt: now, reviewNote: mutation.reason });
      log(request.itemId, 'task.due_change_declined', { requestId: request.id, from: request.fromDate, hours: request.hours }, mutation.reason);
      break;
    }
    case 'withdrawDueDateRequest': {
      const request = next.dueDateRequests.find(r => r.id === mutation.id && r.status === 'pending');
      if (!request) break;
      next.dueDateRequests = next.dueDateRequests.filter(r => r.id !== request.id);
      log(request.itemId, 'task.due_change_withdrawn', { requestId: request.id, from: request.fromDate, hours: request.hours });
      break;
    }
    case 'withdrawTicketRequest':
      next.requests = next.requests.filter(r => !(r.id === mutation.id && r.status === 'pending'));
      break;
    case 'createTickets': {
      const { timezone, workdayEnd } = next.settings;
      if (mutation.doneOn && mutation.doneOn > dateKey(new Date(), timezone)) throw new Error('Work that is already done needs a date of today or earlier.');
      // Done at the end of that workday, or now if the workday has not ended yet.
      const doneAt = mutation.doneOn ? new Date(Math.min(Date.now(), localDate(mutation.doneOn, workdayEnd, timezone).getTime())).toISOString() : null;
      for (const assigneeId of mutation.assigneeIds) {
        const ticketId = crypto.randomUUID();
        next.items.unshift({
          id: ticketId, key: `UG-${String(nextKey()).padStart(3, '0')}`, type: 'task', title: mutation.title, description: mutation.description,
          projectId: mutation.projectId, phaseId: mutation.phaseId, assigneeId, status: doneAt ? 'done' : 'todo', priority: mutation.priority, severity: 'normal',
          estimateHours: mutation.estimateHours, dueDate: doneAt ? null : mutation.dueDate, originalDueDate: doneAt ? null : mutation.dueDate,
          createdAt: now, updatedAt: now, startedAt: doneAt, completedAt: doneAt, fixedAt: null, reportedAt: now, blocker: null, taskId: null, reopenCount: 0,
        });
        log(ticketId, 'task.created', { estimateHours: mutation.estimateHours, dueDate: mutation.dueDate, assigneeId });
        if (doneAt) log(ticketId, 'task.completed', { from: 'todo', to: 'done', creditedHours: mutation.estimateHours, completedOn: doneAt });
      }
      break;
    }
    case 'createItem': {
      const sequence = nextKey();
      next.items.unshift({
        id, key: `${mutation.type === 'bug' ? 'BUG' : 'UG'}-${String(sequence).padStart(3, '0')}`, type: mutation.type, title: mutation.title, description: mutation.description,
        projectId: mutation.projectId, phaseId: mutation.phaseId, assigneeId: mutation.assigneeId, status: mutation.type === 'task' ? 'todo' : 'open',
        priority: mutation.priority, severity: mutation.severity, estimateHours: mutation.type === 'task' ? mutation.estimateHours : 0, dueDate: mutation.dueDate, originalDueDate: mutation.dueDate,
        createdAt: now, updatedAt: now, startedAt: null, completedAt: null, fixedAt: null, reportedAt: now, blocker: null, taskId: mutation.taskId, reopenCount: 0,
      });
      log(id, mutation.type === 'task' ? 'task.created' : 'bug.reported', { estimateHours: mutation.estimateHours, dueDate: mutation.dueDate });
      break;
    }
    case 'updateItem': {
      const item = next.items.find(i => i.id === mutation.id);
      if (!item) break;
      const before = { ...item };
      const patch = mutation.patch;
      const reason = mutation.reason ?? null;
      Object.assign(item, patch, { updatedAt: now });
      if (patch.status && patch.status !== before.status) {
        if (['in_progress', 'in_review', 'done'].includes(patch.status) && !item.startedAt) item.startedAt = now;
        if (patch.status === 'done') item.completedAt = now;
        if (before.status === 'done') { item.completedAt = null; item.reopenCount++; }
        if (patch.status === 'fixed') item.fixedAt = now;
        if (patch.status === 'open' && ['fixed', 'verified'].includes(before.status)) { item.fixedAt = null; item.reopenCount++; }
        if (before.status === 'blocked' && patch.status !== 'blocked') item.blocker = null;
        const event = item.type === 'task' && patch.status === 'done' ? 'task.completed'
          : item.type === 'bug' && patch.status === 'fixed' ? 'bug.fixed'
          : item.type === 'bug' && patch.status === 'verified' ? 'bug.verified'
          : item.type === 'bug' && patch.status === 'open' ? 'bug.reopened' : `${item.type}.status_changed`;
        log(item.id, event, { from: before.status, to: patch.status }, reason);
      }
      if (patch.dueDate !== undefined && patch.dueDate !== before.dueDate) {
        if (!before.originalDueDate) item.originalDueDate = patch.dueDate;
        log(item.id, `${item.type}.due_changed`, { from: before.dueDate, to: patch.dueDate, ...(before.dueDate ? { reasonCategory: mutation.reasonCategory ?? 'other' } : {}) }, before.dueDate ? reason : null);
      }
      if (patch.estimateHours !== undefined && patch.estimateHours !== before.estimateHours) log(item.id, 'task.estimate_revised', { from: before.estimateHours, to: patch.estimateHours }, reason);
      const changed = (Object.keys(patch) as (keyof WorkItem)[]).filter(key => !['status', 'dueDate', 'estimateHours', 'blocker'].includes(key) && patch[key] !== before[key]);
      if (changed.length) log(item.id, `${item.type}.updated`, { changes: changed }, reason);
      break;
    }
    case 'createMember':
      next.members.push({ id, name: mutation.name, email: mutation.email.toLowerCase(), role: mutation.role, capacity: mutation.capacity, isActive: true, image: null, departmentId: mutation.role === 'requester' ? mutation.departmentId ?? null : null, isTeamLead: mutation.role === 'requester' && !!mutation.isTeamLead, ...(mutation.microsoftObjectId ? { microsoftObjectId: mutation.microsoftObjectId } : {}) });
      break;
    case 'updateMember': {
      const found = next.members.find(m => m.id === mutation.id);
      if (!found) break;
      if (mutation.patch.isTeamLead && (mutation.patch.role ?? found.role) !== 'requester') throw new Error('Only someone in a team outside tech can lead it.');
      Object.assign(found, mutation.patch);
      // Someone who moves to the tech team leaves their other team.
      if (found.role !== 'requester') Object.assign(found, { departmentId: null, isTeamLead: false });
      break;
    }
    case 'createProject':
      next.projects.push({ id, name: mutation.name, color: mutation.color, description: mutation.description, isArchived: false, memberIds: mutation.memberIds, primaryMemberId: mutation.primaryMemberId, isAdhoc: false, startDate: mutation.startDate, targetDate: mutation.targetDate, originalTargetDate: mutation.targetDate });
      mutation.phases.forEach((phase, position) => next.phases.push({ id: crypto.randomUUID(), projectId: id, name: phase.name, description: phase.description, position }));
      log(id, 'project.created', { name: mutation.name, startDate: mutation.startDate, targetDate: mutation.targetDate });
      break;
    case 'updateProject': {
      const found = next.projects.find(p => p.id === mutation.id);
      if (!found) break;
      const before = { ...found };
      Object.assign(found, mutation.patch);
      if (found.primaryMemberId && !found.memberIds.includes(found.primaryMemberId)) found.primaryMemberId = null;
      const { targetDate } = mutation.patch;
      if (targetDate !== undefined && targetDate !== before.targetDate) {
        if (before.targetDate && (mutation.reason ?? '').trim().length < 3) throw new Error('Add a short reason for this change.');
        if (!before.originalTargetDate) found.originalTargetDate = targetDate;
        log(found.id, 'project.target_changed', { from: before.targetDate, to: targetDate, ...(before.targetDate ? { reasonCategory: mutation.reasonCategory ?? 'other' } : {}) }, before.targetDate ? mutation.reason ?? null : null);
      }
      break;
    }
    case 'createPhase':
      next.phases.push({ id, projectId: mutation.projectId, name: mutation.name, description: mutation.description, position: next.phases.filter(phase => phase.projectId === mutation.projectId).length });
      break;
    case 'updatePhase': {
      const phase = next.phases.find(p => p.id === mutation.id);
      if (phase && mutation.name !== undefined) phase.name = mutation.name;
      if (phase && mutation.description !== undefined) phase.description = mutation.description;
      break;
    }
    case 'saveSettings':
      next.settings = mutation.settings;
      break;
    case 'addLeave': {
      const days = leaveDays(next, mutation.date, mutation.endDate ?? mutation.date);
      // Days someone already has leave on are skipped, so one form can cover a whole team.
      const fresh = mutation.userIds.flatMap(userId => {
        const taken = new Set(next.leaves.filter(l => l.userId === userId).map(l => l.date));
        return days.filter(date => !taken.has(date)).map(date => ({ userId, date }));
      });
      if (!fresh.length) throw new Error('Leave is already recorded for these days.');
      fresh.forEach(({ userId, date }) => next.leaves.push({ id: crypto.randomUUID(), userId, date, type: mutation.type, note: mutation.note }));
      break;
    }
    case 'addHoliday':
      next.holidays.push({ id, date: mutation.date, name: mutation.name, type: mutation.type });
      break;
    case 'deleteLeave':
      next.leaves = next.leaves.filter(l => !mutation.ids.includes(l.id));
      break;
    case 'deleteHoliday':
      next.holidays = next.holidays.filter(h => h.id !== mutation.id);
      break;
    case 'createTechRequest': {
      const fields: TechRequestInput = { title: mutation.title, description: mutation.description, category: mutation.category, priority: mutation.priority, neededBy: mutation.neededBy, departmentId: mutation.departmentId };
      if (!next.departments.some(d => d.id === fields.departmentId && !d.isArchived)) throw new Error('Choose a team from the list.');
      const sequence = Math.max(0, ...next.techRequests.map(r => Number(r.key.split('-').pop()) || 0)) + 1;
      next.techRequests.unshift({ id, key: requestKey(sequence), requesterId: actor.id, requesterName: actor.name, ...fields, status: 'new', reviewedById: null, reviewedAt: null, reviewNote: null, itemId: null, work: null, createdAt: now, updatedAt: now });
      // The first request sets the requester's team, as on the server.
      const requester = next.members.find(m => m.id === actor.id);
      if (requester && !requester.departmentId) requester.departmentId = fields.departmentId;
      break;
    }
    case 'updateTechRequest': {
      const request = next.techRequests.find(r => r.id === mutation.id && r.requesterId === actor.id);
      if (!request || request.status !== 'new') throw new Error('The tech team already reviewed this request.');
      Object.assign(request, mutation.patch, { updatedAt: now });
      break;
    }
    case 'withdrawTechRequest':
      next.techRequests = next.techRequests.filter(r => !(r.id === mutation.id && r.requesterId === actor.id && r.status === 'new'));
      break;
    case 'assignTechRequest': {
      const request = next.techRequests.find(r => r.id === mutation.id);
      if (!request || request.status !== 'new') throw new Error('The tech team already reviewed this request.');
      const bug = mutation.type === 'bug';
      const dueDate = bug ? null : mutation.dueDate ?? null;
      next.items.unshift({
        id, key: `${bug ? 'BUG' : 'UG'}-${String(nextKey()).padStart(3, '0')}`, type: mutation.type, title: mutation.title, description: request.description,
        projectId: mutation.projectId, phaseId: mutation.phaseId, assigneeId: mutation.assigneeId, status: bug ? 'open' : 'todo', priority: mutation.priority,
        severity: bug ? mutation.severity ?? 'normal' : 'normal', estimateHours: bug ? 0 : mutation.estimateHours ?? 1, dueDate, originalDueDate: dueDate,
        createdAt: now, updatedAt: now, startedAt: null, completedAt: null, fixedAt: null, reportedAt: now, blocker: null, taskId: null, reopenCount: 0,
      });
      log(id, bug ? 'bug.reported' : 'task.created', { estimateHours: bug ? 0 : mutation.estimateHours, dueDate, techRequestId: request.id });
      Object.assign(request, { status: 'assigned', itemId: id, reviewedById: actor.id, reviewedAt: now, reviewNote: mutation.note?.trim() || null, updatedAt: now });
      request.work = requestWork(next, request);
      break;
    }
    case 'declineTechRequest': {
      const request = next.techRequests.find(r => r.id === mutation.id);
      if (!request || request.status !== 'new') throw new Error('The tech team already reviewed this request.');
      Object.assign(request, { status: 'declined', reviewedById: actor.id, reviewedAt: now, reviewNote: mutation.reason, updatedAt: now });
      break;
    }
    case 'createDepartment': {
      const name = mutation.name.trim();
      if (next.departments.some(d => d.name.toLowerCase() === name.toLowerCase())) throw new Error('A team with this name already exists.');
      next.departments.push({ id, name, position: Math.max(-1, ...next.departments.map(d => d.position)) + 1, isArchived: false });
      break;
    }
    case 'updateDepartment': {
      const department = next.departments.find(d => d.id === mutation.id);
      const name = mutation.name?.trim();
      if (!department) break;
      if (name && next.departments.some(d => d.id !== department.id && d.name.toLowerCase() === name.toLowerCase())) throw new Error('A team with this name already exists.');
      if (name) department.name = name;
      if (mutation.isArchived !== undefined) department.isArchived = mutation.isArchived;
      break;
    }
  }
  return next;
}

/** The demo shows what one developer would see, using the same filters as the server. */
export function viewAs(data: DashboardData, viewerId: string | null): DashboardData {
  const viewer = viewerId ? data.members.find(m => m.id === viewerId && m.isActive) : undefined;
  if (!viewer || viewer.id === data.currentUser.id) return data;
  if (viewer.role === 'admin') return { ...data, currentUser: viewer };
  if (viewer.role === 'requester') {
    // Their own and their team's requests, each with a summary of the work it became. Nothing from the tech team's side.
    const techRequests = data.techRequests.filter(r => r.requesterId === viewer.id || (!!viewer.departmentId && r.departmentId === viewer.departmentId)).map(r => ({ ...r, work: requestWork(data, r) }));
    return { ...data, currentUser: viewer, members: [viewer], projects: [], phases: [], items: [], requests: [], dueDateRequests: [], activities: [], leaves: [], holidays: [], snapshots: [], techRequests };
  }
  const items = data.items.filter(item => item.assigneeId === viewer.id);
  const requests = data.requests.filter(request => request.requesterId === viewer.id);
  const dueDateRequests = data.dueDateRequests.filter(request => request.requesterId === viewer.id);
  const itemIds = new Set(items.map(item => item.id));
  const history = new Set([...items, ...requests].map(row => row.projectId));
  const projects = data.projects.filter(p => isAdhocProject(p) || p.memberIds.includes(viewer.id) || history.has(p.id));
  const projectIds = new Set(projects.map(p => p.id));
  return {
    ...data, currentUser: viewer, members: [viewer], items, requests, dueDateRequests, projects,
    techRequests: data.techRequests.filter(r => !!r.itemId && itemIds.has(r.itemId)),
    phases: data.phases.filter(phase => projectIds.has(phase.projectId)),
    activities: data.activities.filter(a => itemIds.has(a.entityId) || (projectIds.has(a.entityId) && a.action === 'project.target_changed')),
    leaves: data.leaves.filter(l => l.userId === viewer.id),
  };
}

export const DEMO_DATA_KEY = 'urban-gabru-kpi-demo-v9';
/** The extension waiting for approval on a ticket, if any. */
export function pendingExtension(data: DashboardData, itemId: string) {
  return data.dueDateRequests.find(request => request.itemId === itemId && request.status === 'pending');
}
const DEMO_VIEWER_KEY = 'urban-gabru-kpi-demo-viewer';
let demoCacheText: string | null = null;
let demoCacheData: DashboardData | null = null;
export function demoSnapshot(initialData: DashboardData) {
  if (initialData.mode !== 'demo') return initialData;
  let value: string | null = null;
  try { value = localStorage.getItem(DEMO_DATA_KEY); } catch { return initialData; }
  if (!value) return initialData;
  if (value !== demoCacheText) {
    demoCacheText = value;
    try { demoCacheData = JSON.parse(value) as DashboardData; } catch { demoCacheData = null; }
  }
  const valid = demoCacheData?.mode === 'demo' && demoCacheData.currentUser.id === initialData.currentUser.id
    && Array.isArray(demoCacheData.techRequests) && Array.isArray(demoCacheData.departments)
    && Array.isArray(demoCacheData.phases) && demoCacheData.phases.every(phase => typeof phase.description === 'string')
    && demoCacheData.projects.every(p => Array.isArray(p.memberIds) && typeof p.isAdhoc === 'boolean' && p.targetDate !== undefined && p.primaryMemberId !== undefined);
  return valid ? demoCacheData! : initialData;
}
export function saveDemo(data: DashboardData) {
  localStorage.setItem(DEMO_DATA_KEY, JSON.stringify(data));
  window.dispatchEvent(new Event('ug-demo-change'));
}
export function demoViewer(): string | null {
  try { return localStorage.getItem(DEMO_VIEWER_KEY); } catch { return null; }
}
export function setDemoViewer(id: string | null) {
  try { if (id) localStorage.setItem(DEMO_VIEWER_KEY, id); else localStorage.removeItem(DEMO_VIEWER_KEY); } catch { /* The demo still works without storage. */ }
  window.dispatchEvent(new Event('ug-demo-change'));
}
export function subscribeDemo(callback: () => void) {
  window.addEventListener('storage', callback);
  window.addEventListener('ug-demo-change', callback);
  return () => { window.removeEventListener('storage', callback); window.removeEventListener('ug-demo-change', callback); };
}
