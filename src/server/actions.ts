import { randomUUID } from "node:crypto";
import { and, desc, eq, inArray, isNull, ne, notInArray, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { DeleteObjectCommand } from "@aws-sdk/client-s3";
import { account, activities, attachments, departments, dueDateRequests, holidays, leaves, leaveRequests, memberProfiles, projectMembers, projectPhases, projects, requestComments, session, settings, snapshots, techRequests, ticketRequests, user, workItems } from "@/db/schema";
import type { Member, TechRequestStatus } from "@/lib/types";
import { attachmentBucket, storageClient } from "@/lib/storage";
import { canSeeRequest } from "./request-access";
import { memberRole, requireCapability, storedRole } from "./authz";
import { ACTION_CAPABILITY, can, isOrgAdmin, isTechTeam, leadsWork, manageableRoles, mayDo, ownsNoWork, aRole, type Capability } from "@/lib/permissions";
import { AppError } from "./errors";
import type { DataAction } from "./validation";
import { DEFAULT_SETTINGS } from "./default-settings";
import { creditedAt, dateKey, dueDateAfterHours, isWorkingDay, shiftDate, workingHoursBetween, type WorkCalendar } from "@/lib/kpi/calendar";
import { linkMicrosoftAccount } from "./microsoft-accounts";
import { ADHOC_PROJECT_ID } from "@/lib/project-defaults";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type ItemRow = typeof workItems.$inferSelect;
function audit(tx: Tx, actor: Member, entityId: string, action: string, payload: Record<string, unknown>, reason?: string) {
  return tx.insert(activities).values({ actorId: actor.id, entityId, action, payload, reason: reason || null });
}
async function assertEmailFree(tx: Tx, email: string) {
  const [taken] = await tx.select({ id: user.id }).from(user).where(eq(user.email, email));
  if (taken) throw new AppError("A team member with this email already exists.", 409);
}
function requireReason(reason?: string) {
  if (!reason || reason.trim().length < 3) throw new AppError("Add a short reason for this change.");
}
/** Full-day holidays are days off. A half-day holiday keeps the office open and only lowers hours at work. */
function daysOff(rows: { date: string; type: string }[]) {
  return new Set(rows.filter((row) => row.type !== "half_day").map((row) => row.date));
}
/** Working days and hours from settings and holidays. With a person, their full days of leave are days off too. */
async function workCalendar(tx: Tx, userId?: string): Promise<WorkCalendar> {
  const [saved] = await tx.select().from(settings).where(eq(settings.id, 1));
  const config = saved?.value ?? DEFAULT_SETTINGS;
  const holidayRows = await tx.select({ date: holidays.date, type: holidays.type }).from(holidays);
  const leaveRows = userId ? await tx.select({ date: leaves.date }).from(leaves).where(and(eq(leaves.userId, userId), eq(leaves.type, "full_day"))) : [];
  return {
    timezone: config.timezone, workingDays: config.workingDays, workdayStart: config.workdayStart, workdayEnd: config.workdayEnd,
    holidays: daysOff(holidayRows), ...(userId ? { extraDaysOff: new Set(leaveRows.map((row) => row.date)) } : {}),
  };
}
/**
 * One leave row per working day. Weekends and holidays are skipped because they already cost no hours.
 * The days come as a list of picked days, or as a first and last day from older pages. One picked day is kept as it is.
 */
async function leaveDates(tx: Tx, asked: { dates?: string[]; date?: string; endDate?: string }) {
  const calendar = await workCalendar(tx);
  let days: string[];
  if (asked.dates) days = [...new Set(asked.dates)].sort();
  else {
    const first = asked.date!, last = asked.endDate ?? first;
    days = [];
    for (let date = first; date <= last; date = shiftDate(date, 1, calendar.timezone)) {
      if (days.length >= 62) throw new AppError("Record up to two months of leave at a time.");
      days.push(date);
    }
  }
  const dates = days.length === 1 ? days : days.filter((date) => isWorkingDay(date, calendar));
  if (!dates.length) throw new AppError("These dates are weekends or holidays. No leave is needed.");
  return dates;
}
async function assertAssignee(tx: Tx, id: string) {
  const [member] = await tx.select({ id: user.id, role: user.role, banned: user.banned, isActive: memberProfiles.isActive }).from(user)
    .leftJoin(memberProfiles, eq(memberProfiles.userId, user.id)).where(eq(user.id, id));
  if (!member || member.banned || member.isActive === false) throw new AppError("Choose an active team member.");
  // The tech lead manages the work and is not scored. Project managers and requesters only handle requests. Tickets and bugs belong to developers.
  if (memberRole(member.role) !== "developer") throw new AppError("Tickets and bugs belong to developers. Choose a developer.");
}
async function assertProject(tx: Tx, id: string) {
  // Project edits take an update lock, keeping membership stable during a work assignment.
  const [project] = await tx.select().from(projects).where(eq(projects.id, id)).for("share");
  if (!project || project.isArchived) throw new AppError("Choose an active project.");
  return project;
}
async function assertProjectOwner(tx: Tx, projectId: string, assigneeId: string) {
  if (projectId === ADHOC_PROJECT_ID) return;
  const [membership] = await tx.select({ userId: projectMembers.userId }).from(projectMembers)
    .where(and(eq(projectMembers.projectId, projectId), eq(projectMembers.userId, assigneeId)));
  if (!membership) throw new AppError("Add this owner to the project before assigning work.");
}
async function assertPhase(tx: Tx, projectId: string, phaseId: string | null) {
  if (!phaseId) return;
  const [phase] = await tx.select({ id: projectPhases.id }).from(projectPhases)
    .where(and(eq(projectPhases.id, phaseId), eq(projectPhases.projectId, projectId)));
  if (!phase) throw new AppError("Choose a phase from this project.");
}
async function linkedTask(tx: Tx, taskId: string | null | undefined, projectId: string) {
  if (!taskId) return null;
  const [task] = await tx.select().from(workItems).where(eq(workItems.id, taskId)).for("share");
  if (!task || task.type !== "task" || task.projectId !== projectId) throw new AppError("Link a task from the same project.");
  return task;
}
function protectAdhoc(project: typeof projects.$inferSelect) {
  if (project.id === ADHOC_PROJECT_ID || project.isAdhoc) throw new AppError("The built-in Ad hoc project cannot be changed.");
}
function assertProjectName(name: string) {
  if (name.toLowerCase() === "ad hoc") throw new AppError("Use the built-in Ad hoc project for unplanned work.");
}
async function assertProjectMembers(tx: Tx, ids: string[]) {
  if (!ids.length) return;
  const members = await tx.select({ id: user.id, role: user.role, banned: user.banned, isActive: memberProfiles.isActive }).from(user)
    .leftJoin(memberProfiles, eq(memberProfiles.userId, user.id)).where(inArray(user.id, ids));
  if (members.length !== ids.length || members.some((member) => member.banned || member.isActive === false)) throw new AppError("Choose active team members for this project.");
  if (members.some((member) => memberRole(member.role) === "requester")) throw new AppError("People from other teams raise requests and do not join projects. Choose people from the tech team.");
  if (members.some((member) => !isTechTeam(memberRole(member.role)))) throw new AppError("Project managers handle requests and do not join projects. Choose people from the tech team.");
}
function assertPrimaryMember(ids: string[], primaryId: string | null) {
  if (primaryId && !ids.includes(primaryId)) throw new AppError("The primary developer must be a member of this project.");
}
async function replaceProjectMembers(tx: Tx, projectId: string, ids: string[], primaryId: string | null) {
  assertPrimaryMember(ids, primaryId);
  const existingMembers = await tx.select({ userId: projectMembers.userId }).from(projectMembers)
    .where(eq(projectMembers.projectId, projectId));
  const existingIds = new Set(existingMembers.map((member) => member.userId));
  // Disabling access must not prevent unrelated project edits or erase existing ownership.
  await assertProjectMembers(tx, ids.filter((id) => !existingIds.has(id)));
  const removedOwners = await tx.select({ id: workItems.id }).from(workItems).where(and(
    eq(workItems.projectId, projectId), notInArray(workItems.status, ["done", "verified"]),
    ids.length ? notInArray(workItems.assigneeId, ids) : undefined,
  )).limit(1);
  if (removedOwners.length) throw new AppError("Finish or reassign a member's unfinished work before removing them from this project.");
  await tx.delete(projectMembers).where(eq(projectMembers.projectId, projectId));
  if (ids.length) await tx.insert(projectMembers).values(ids.map((userId) => ({ projectId, userId, isPrimary: userId === primaryId })));
}
function statusChange(item: ItemRow, next: string, actor: Member, reason?: string): Partial<typeof workItems.$inferInsert> {
  if (next === item.status) return {};
  const admin = leadsWork(actor);
  const now = new Date();
  if (item.type === "task") {
    // Open work completes in one step: to review for a developer, straight to done for the tech lead.
    const complete = admin ? ["in_review", "done"] : ["in_review"];
    const allowed: Record<string, string[]> = {
      todo: ["in_progress", "blocked", ...complete], in_progress: ["blocked", ...complete],
      blocked: ["in_progress", "todo", ...complete], in_review: admin ? ["done", "in_progress"] : [],
      done: admin ? ["in_progress"] : [],
    };
    if (!allowed[item.status]?.includes(next)) throw new AppError("That task state change is not allowed.");
    if (item.status === "in_review" && next === "in_progress" || item.status === "done") requireReason(reason);
    return {
      status: next as ItemRow["status"],
      ...(["in_progress", "in_review", "done"].includes(next) && !item.startedAt ? { startedAt: now } : {}),
      ...(next === "in_review" || next === "done" && item.status !== "in_review" ? { submittedAt: now } : {}),
      ...(next === "done" ? { completedAt: now } : {}),
      ...(item.status === "done" ? { completedAt: null, submittedAt: null, reopenCount: item.reopenCount + 1 } : {}),
      ...(item.status === "blocked" ? { blocker: null } : {}),
    };
  }
  const allowed: Record<string, string[]> = {
    open: ["in_progress", "fixed"], in_progress: ["fixed"],
    fixed: admin ? ["verified", "open"] : [], verified: admin ? ["open"] : [],
  };
  if (!allowed[item.status]?.includes(next)) throw new AppError("That bug state change is not allowed.");
  if (next === "open") requireReason(reason);
  return {
    status: next as ItemRow["status"],
    ...(next === "in_progress" && !item.startedAt ? { startedAt: now } : {}),
    ...(next === "fixed" ? { fixedAt: now } : {}),
    ...(next === "verified" ? { verifiedAt: now } : {}),
    ...(next === "open" ? { fixedAt: null, verifiedAt: null, reopenCount: item.reopenCount + 1 } : {}),
  };
}

/** Fields a ticket's owner may change. Estimates, owners, and projects stay with the tech lead because they change the score. */
const OWNER_FIELDS = new Set(["status", "blocker", "dueDate", "title", "description", "priority"]);

// Every change the server accepts has an entry in the shared table, so the demo and the server follow the same rules.
const ACTION_RULES: Record<DataAction["action"], readonly Capability[] | null> = ACTION_CAPABILITY;
/** Refuses a change this person's role cannot make, before anything is read. */
function assertAllowed(actor: Member, action: DataAction["action"]) {
  const needed = ACTION_RULES[action];
  if (needed && !mayDo(actor, action)) requireCapability(actor, needed[0]);
}
/**
 * Whether a person left anything behind: a Microsoft sign-in, requests, comments, files, tickets, leave, scores, or any change
 * they made. Deleting their account would delete or orphan these, so such a person keeps their account with access turned off.
 */
async function hasHistory(tx: Tx, id: string): Promise<boolean> {
  const checks = await Promise.all([
    tx.select({ id: account.id }).from(account).where(and(eq(account.userId, id), eq(account.providerId, "microsoft"))).limit(1),
    tx.select({ id: activities.id }).from(activities).where(eq(activities.actorId, id)).limit(1),
    tx.select({ id: techRequests.id }).from(techRequests).where(eq(techRequests.requesterId, id)).limit(1),
    tx.select({ id: requestComments.id }).from(requestComments).where(eq(requestComments.authorId, id)).limit(1),
    tx.select({ id: attachments.id }).from(attachments).where(eq(attachments.uploadedById, id)).limit(1),
    tx.select({ id: workItems.id }).from(workItems).where(or(eq(workItems.assigneeId, id), eq(workItems.createdById, id))).limit(1),
    tx.select({ id: ticketRequests.id }).from(ticketRequests).where(eq(ticketRequests.requesterId, id)).limit(1),
    tx.select({ id: leaveRequests.id }).from(leaveRequests).where(eq(leaveRequests.requesterId, id)).limit(1),
    tx.select({ id: leaves.id }).from(leaves).where(eq(leaves.userId, id)).limit(1),
    tx.select({ userId: snapshots.userId }).from(snapshots).where(eq(snapshots.userId, id)).limit(1),
    tx.select({ userId: projectMembers.userId }).from(projectMembers).where(eq(projectMembers.userId, id)).limit(1),
  ]);
  return checks.some((rows) => rows.length > 0);
}
/** The actor's role as saved now. A role changed a moment ago applies to people changes already on their way. */
async function savedActor(tx: Tx, actor: Member): Promise<Member> {
  const [row] = await tx.select({ role: user.role, banned: user.banned }).from(user).where(eq(user.id, actor.id)).for("share");
  if (!row || row.banned) throw new AppError("This account is inactive. Ask an admin to turn it back on.", 403);
  const role = memberRole(row.role);
  if (!can(role, "people.manage")) throw new AppError("Only an admin or the tech lead can change people.", 403);
  return { ...actor, role };
}
/**
 * A person this actor may change, and the role they may give. An admin changes anyone. A tech lead changes developers and
 * project managers, and may make someone only a developer or a project manager. Nobody turns off or demotes themselves,
 * and the last active admin always stays, so the organisation is never locked out.
 */
function assertMayManage(actor: Member, current: string | null, next: string | undefined) {
  const allowed = manageableRoles(actor);
  if (current !== null && !allowed.includes(memberRole(current))) throw new AppError(`Only an admin can change ${aRole(memberRole(current))}.`, 403);
  if (next && !allowed.includes(next as Member["role"])) throw new AppError(`Only an admin can make someone ${aRole(next as Member["role"])}.`, 403);
}
async function assertAnotherAdmin(tx: Tx, leavingId: string) {
  const [other] = await tx.select({ id: user.id }).from(user).leftJoin(memberProfiles, eq(memberProfiles.userId, user.id))
    .where(and(eq(user.role, "admin"), ne(user.id, leavingId), sql`${user.banned} IS NOT TRUE`, sql`${memberProfiles.isActive} IS NOT FALSE`)).limit(1);
  if (!other) throw new AppError("Make someone else an admin first. The organisation always needs one active admin.");
}
const OPEN_TICKET = ["todo", "in_progress", "blocked"];

type ItemInput = Extract<DataAction, { action: "createItem" }> | (Omit<Extract<DataAction, { action: "createItem" }>, "action">);
/** Creates a ticket or bug after the same checks every path uses. An approved request passes its developer as the creator. */
async function insertItem(tx: Tx, actor: Member, input: ItemInput, origin: { createdById?: string; requestId?: string; techRequestId?: string } = {}) {
  const projectId = input.projectId ?? ADHOC_PROJECT_ID;
  await assertAssignee(tx, input.assigneeId);
  await assertProject(tx, projectId);
  await assertProjectOwner(tx, projectId, input.assigneeId);
  const task = input.type === "bug" ? await linkedTask(tx, input.taskId, projectId) : null;
  if (input.type === "task" && input.taskId) throw new AppError("Only a bug can link to a task.");
  const phaseId = input.phaseId === undefined ? task?.phaseId ?? null : input.phaseId;
  if (task && task.phaseId !== phaseId) throw new AppError("A linked bug must use its task's phase.");
  await assertPhase(tx, projectId, phaseId);
  const estimate = input.type === "task" ? input.estimateHours ?? 1 : 0;
  if (input.type === "task" && (estimate <= 0 || estimate > 80)) throw new AppError("Task estimates must be between 0.01 and 80 hours.");
  if (input.type === "bug" && input.estimateHours) throw new AppError("Bug fixes are included in the task estimate.");
  const [item] = await tx.insert(workItems).values({
    type: input.type, title: input.title, description: input.description ?? "", projectId, phaseId,
    assigneeId: input.assigneeId, createdById: origin.createdById ?? actor.id, status: input.type === "task" ? "todo" : "open",
    priority: input.priority ?? "medium", severity: input.severity ?? "normal",
    estimateHours: estimate, originalEstimateHours: estimate, dueDate: input.dueDate, originalDueDate: input.dueDate,
    taskId: input.type === "bug" ? input.taskId : null,
  }).returning();
  await audit(tx, actor, item.id, input.type === "task" ? "task.created" : "bug.reported", {
    estimateHours: estimate, dueDate: item.dueDate, assigneeId: item.assigneeId, severity: item.severity, taskId: item.taskId, projectId, phaseId,
    ...(origin.requestId ? { requestId: origin.requestId } : {}),
    ...(origin.techRequestId ? { techRequestId: origin.techRequestId } : {}),
  });
  return item;
}
/** Only an open ticket can get more hours, and a ticket holds at most 80. */
function assertExtendable(item: ItemRow, hours: number) {
  if (item.type !== "task" || !OPEN_TICKET.includes(item.status)) throw new AppError("Only an open ticket can get more time.");
  if (item.estimateHours + hours > 80) throw new AppError(`This ticket already has ${item.estimateHours} h. A ticket holds up to 80 h, so split the extra work into a new ticket.`);
}
/**
 * Adds the hours to the estimate. With a due date, the date moves by those working hours too.
 * The reason goes into the ticket's history.
 */
async function applyExtension(tx: Tx, actor: Member, item: ItemRow, hours: number, reasonCategory: string, reason: string, request?: typeof dueDateRequests.$inferSelect) {
  const to = item.dueDate ? dueDateAfterHours(item.dueDate, hours, await workCalendar(tx, item.assigneeId)) : null;
  const estimate = Math.round((item.estimateHours + hours) * 100) / 100;
  await tx.update(workItems).set({ dueDate: to, estimateHours: estimate, updatedAt: new Date() }).where(eq(workItems.id, item.id));
  // An approved request names who asked, so the history reads the same as a direct extension.
  await audit(tx, actor, item.id, item.dueDate ? "task.due_changed" : "task.hours_added", {
    from: item.dueDate, to, addedHours: hours, estimateFrom: item.estimateHours, estimateTo: estimate, reasonCategory,
    ...(request ? { requestId: request.id, requestedBy: request.requesterId, ...(hours !== request.hours ? { requestedHours: request.hours } : {}) } : {}),
  }, reason);
}
async function pendingDueDateRequest(tx: Tx, id: string) {
  const [request] = await tx.select().from(dueDateRequests).where(eq(dueDateRequests.id, id)).for("update");
  if (!request) throw new AppError("This request was not found.", 404);
  if (request.status !== "pending") throw new AppError("This request was already reviewed.", 409);
  return request;
}
/** A team a request can go to. Archived teams keep their old requests but take no new ones. */
async function activeDepartment(tx: Tx, id: string) {
  const [department] = await tx.select().from(departments).where(eq(departments.id, id));
  if (!department || department.isArchived) throw new AppError("Choose a team from the list.");
  return department;
}
async function assertDepartmentNameFree(tx: Tx, name: string, exceptId?: string) {
  const [taken] = await tx.select({ id: departments.id }).from(departments)
    .where(and(sql`lower(${departments.name}) = lower(${name})`, exceptId ? ne(departments.id, exceptId) : undefined));
  if (taken) throw new AppError("A team with this name already exists.", 409);
}
async function assertNeededBy(tx: Tx, neededBy: string | null | undefined) {
  if (neededBy && neededBy < dateKey(new Date(), (await workCalendar(tx)).timezone)) throw new AppError("Pick today or a later date for when you need it.");
}
/**
 * The stages in which each person may act on a request. A project manager acts while it is new. The tech lead acts while it
 * is new or forwarded, so a request never waits on a project manager who is away or not yet added.
 */
function openStages(actor: Member): TechRequestStatus[] {
  return can(actor, "requests.assign") ? ["new", "forwarded"] : ["new"];
}
const STAGE_MESSAGES: Record<TechRequestStatus, string> = {
  new: "This request is still with a project manager.",
  forwarded: "A project manager already forwarded this request to the tech lead. Add a comment instead.",
  assigned: "This request is already assigned to a developer. Add a comment instead.",
  declined: "This request was declined. Add a comment instead.",
};
/** A request locked for a change, in one of the given stages. With `requesterId`, only that person's own request. */
async function openTechRequest(tx: Tx, id: string, stages: TechRequestStatus[], requesterId?: string) {
  const [request] = await tx.select().from(techRequests).where(eq(techRequests.id, id)).for("update");
  if (!request || (requesterId && request.requesterId !== requesterId)) throw new AppError("This request was not found.", 404);
  if (!stages.includes(request.status)) throw new AppError(STAGE_MESSAGES[request.status], 409);
  return request;
}
/** The fields of a request that differ from the patch. Unchanged values are left out, so the history shows real changes only. */
function requestChanges(request: typeof techRequests.$inferSelect, patch: Record<string, unknown>) {
  return Object.fromEntries(Object.entries(patch).filter(([key, value]) => value !== undefined && request[key as keyof typeof request] !== value));
}
async function pendingRequest(tx: Tx, id: string) {
  const [request] = await tx.select().from(ticketRequests).where(eq(ticketRequests.id, id)).for("update");
  if (!request) throw new AppError("This request was not found.", 404);
  if (request.status !== "pending") throw new AppError("This request was already reviewed.", 409);
  return request;
}

export async function executeAction(actor: Member, action: DataAction): Promise<void> {
  assertAllowed(actor, action.action);
  // Files of a withdrawn request leave storage after its rows are gone.
  const removedObjects: string[] = [];
  await db.transaction(async (tx) => {
    switch (action.action) {
      case "createItem": {
        await insertItem(tx, actor, action);
        break;
      }
      case "createTickets": {
        const { assigneeIds, doneOn, title, description, projectId, phaseId, priority, estimateHours, dueDate } = action;
        let completedAt: Date | null = null;
        if (doneOn) {
          const calendar = await workCalendar(tx);
          if (doneOn > dateKey(new Date(), calendar.timezone)) throw new AppError("Work that is already done needs a date of today or earlier.");
          // Done at the end of that workday, or now if the workday has not ended yet.
          completedAt = creditedAt(doneOn, calendar.workdayEnd, calendar.timezone);
        }
        for (const assigneeId of assigneeIds) {
          const item = await insertItem(tx, actor, { type: "task", title, description, projectId, phaseId, priority, estimateHours, assigneeId, dueDate: doneOn ? null : dueDate });
          if (!completedAt) continue;
          await tx.update(workItems).set({ status: "done", startedAt: completedAt, submittedAt: completedAt, completedAt, updatedAt: new Date() }).where(eq(workItems.id, item.id));
          await audit(tx, actor, item.id, "task.completed", { from: "todo", to: "done", creditedHours: item.estimateHours, completedOn: completedAt.toISOString() });
        }
        break;
      }
      case "requestTicket": {
        if (leadsWork(actor)) throw new AppError("You add tickets directly. Requests are for developers.");
        const projectId = action.projectId ?? ADHOC_PROJECT_ID;
        const phaseId = action.phaseId ?? null;
        await assertAssignee(tx, actor.id);
        await assertProject(tx, projectId);
        await assertProjectOwner(tx, projectId, actor.id);
        await assertPhase(tx, projectId, phaseId);
        const [request] = await tx.insert(ticketRequests).values({
          requesterId: actor.id, title: action.title, description: action.description ?? "", note: action.note ?? "",
          projectId, phaseId, estimateHours: action.estimateHours, dueDate: action.dueDate ?? null, priority: action.priority ?? "medium",
        }).returning();
        await audit(tx, actor, request.id, "ticket_request.created", { estimateHours: request.estimateHours, projectId, phaseId, dueDate: request.dueDate });
        break;
      }
      case "approveTicketRequest": {
        const request = await pendingRequest(tx, action.id);
        const patch = action.patch ?? {};
        // The tech lead may adjust the request before approving. The ticket belongs to the developer who asked.
        const item = await insertItem(tx, actor, {
          type: "task", title: patch.title ?? request.title, description: request.description,
          projectId: patch.projectId ?? request.projectId, phaseId: patch.phaseId !== undefined ? patch.phaseId : patch.projectId && patch.projectId !== request.projectId ? null : request.phaseId,
          assigneeId: request.requesterId, priority: patch.priority ?? request.priority, estimateHours: patch.estimateHours ?? request.estimateHours,
          dueDate: patch.dueDate !== undefined ? patch.dueDate : request.dueDate,
        }, { createdById: request.requesterId, requestId: request.id });
        await tx.update(ticketRequests).set({ status: "approved", reviewedById: actor.id, reviewedAt: new Date(), reviewNote: action.note?.trim() || null, itemId: item.id }).where(eq(ticketRequests.id, request.id));
        const changes = Object.fromEntries(Object.entries(patch).filter(([key, value]) => request[key as keyof typeof request] !== value));
        await audit(tx, actor, request.id, "ticket_request.approved", { itemId: item.id, changes }, action.note);
        break;
      }
      case "declineTicketRequest": {
        const request = await pendingRequest(tx, action.id);
        await tx.update(ticketRequests).set({ status: "declined", reviewedById: actor.id, reviewedAt: new Date(), reviewNote: action.reason }).where(eq(ticketRequests.id, request.id));
        await audit(tx, actor, request.id, "ticket_request.declined", {}, action.reason);
        break;
      }
      case "extendTicket": {
        const admin = leadsWork(actor);
        const [item] = await tx.select().from(workItems).where(eq(workItems.id, action.itemId)).for("update");
        if (!item || (!admin && item.assigneeId !== actor.id)) throw new AppError("This item was not found.", 404);
        assertExtendable(item, action.hours);
        if (admin) { await applyExtension(tx, actor, item, action.hours, action.reasonCategory, action.reason); break; }
        // A developer's extension waits for the tech lead. Nothing on the ticket changes until then.
        const [waiting] = await tx.select({ id: dueDateRequests.id }).from(dueDateRequests).where(and(eq(dueDateRequests.itemId, item.id), eq(dueDateRequests.status, "pending")));
        if (waiting) throw new AppError("An extension for this ticket already waits for approval.", 409);
        const [request] = await tx.insert(dueDateRequests).values({ itemId: item.id, requesterId: actor.id, fromDate: item.dueDate, fromEstimate: item.estimateHours, hours: action.hours, reasonCategory: action.reasonCategory, reason: action.reason }).returning();
        await audit(tx, actor, item.id, "task.due_change_requested", { requestId: request.id, from: item.dueDate, hours: action.hours, reasonCategory: action.reasonCategory }, action.reason);
        break;
      }
      case "approveDueDateRequest": {
        const request = await pendingDueDateRequest(tx, action.id);
        const [item] = await tx.select().from(workItems).where(eq(workItems.id, request.itemId)).for("update");
        if (!item || !OPEN_TICKET.includes(item.status)) throw new AppError("This ticket is no longer open. Decline the request instead.", 409);
        if (item.dueDate !== request.fromDate || item.estimateHours !== request.fromEstimate) throw new AppError("The ticket's date or estimate changed after this request. Decline it, and the developer can ask again.", 409);
        const hours = action.hours ?? request.hours;
        assertExtendable(item, hours);
        await applyExtension(tx, actor, item, hours, request.reasonCategory, request.reason, request);
        await tx.update(dueDateRequests).set({ status: "approved", approvedHours: hours, reviewedById: actor.id, reviewedAt: new Date(), reviewNote: action.note?.trim() || null }).where(eq(dueDateRequests.id, request.id));
        break;
      }
      case "declineDueDateRequest": {
        const request = await pendingDueDateRequest(tx, action.id);
        await tx.update(dueDateRequests).set({ status: "declined", reviewedById: actor.id, reviewedAt: new Date(), reviewNote: action.reason }).where(eq(dueDateRequests.id, request.id));
        await audit(tx, actor, request.itemId, "task.due_change_declined", { requestId: request.id, from: request.fromDate, hours: request.hours }, action.reason);
        break;
      }
      case "withdrawDueDateRequest": {
        const [request] = await tx.select().from(dueDateRequests).where(eq(dueDateRequests.id, action.id)).for("update");
        if (!request || request.requesterId !== actor.id) throw new AppError("This request was not found.", 404);
        if (request.status !== "pending") throw new AppError("This request was already reviewed.", 409);
        await tx.delete(dueDateRequests).where(eq(dueDateRequests.id, request.id));
        await audit(tx, actor, request.itemId, "task.due_change_withdrawn", { requestId: request.id, from: request.fromDate, hours: request.hours });
        break;
      }
      case "withdrawTicketRequest": {
        const [request] = await tx.select().from(ticketRequests).where(eq(ticketRequests.id, action.id)).for("update");
        if (!request || request.requesterId !== actor.id) throw new AppError("This request was not found.", 404);
        if (request.status !== "pending") throw new AppError("This request was already reviewed.", 409);
        await tx.delete(ticketRequests).where(eq(ticketRequests.id, request.id));
        break;
      }
      case "createTechRequest": {
        // People raise requests for the team an admin put them in. Someone without a team waits until an admin sets it,
        // so nobody can choose a team and then read its requests.
        const [profile] = await tx.select({ departmentId: memberProfiles.departmentId }).from(memberProfiles).where(eq(memberProfiles.userId, actor.id));
        const departmentId = profile?.departmentId;
        if (!departmentId) throw new AppError("An admin needs to add you to your team before you can raise a request.", 403);
        if (action.departmentId && action.departmentId !== departmentId) throw new AppError("You raise requests for your own team only.");
        const [team] = await tx.select().from(departments).where(eq(departments.id, departmentId));
        if (!team || team.isArchived) throw new AppError("Your team no longer takes requests. Ask an admin to move you to another team.");
        await assertNeededBy(tx, action.neededBy);
        if (action.id) {
          // The id the page chose must be new everywhere. Request and ticket history share one audit table, keyed by id.
          const [taken] = await tx.select({ id: techRequests.id }).from(techRequests).where(eq(techRequests.id, action.id));
          const [ticket] = taken ? [] : await tx.select({ id: workItems.id }).from(workItems).where(eq(workItems.id, action.id));
          if (taken || ticket) throw new AppError("This request was already sent.", 409);
        }
        const [request] = await tx.insert(techRequests).values({
          ...(action.id ? { id: action.id } : {}), requesterId: actor.id, departmentId, title: action.title, description: action.description,
          category: action.category, tool: action.tool ?? "", priority: action.priority, neededBy: action.neededBy,
        }).returning();
        await audit(tx, actor, request.id, "tech_request.created", { departmentId: request.departmentId, category: request.category, priority: request.priority, neededBy: request.neededBy });
        break;
      }
      case "updateTechRequest":
      case "editTechRequest": {
        // A requester changes their own request while a project manager has it. The tech side corrects it until it is assigned.
        const own = action.action === "updateTechRequest";
        const request = await openTechRequest(tx, action.id, own ? ["new"] : openStages(actor), own ? actor.id : undefined);
        const patch = action.patch;
        // A requester's request stays with their team. A project manager or the tech lead may move it to the right team.
        if (own && patch.departmentId && patch.departmentId !== request.departmentId) throw new AppError("You raise requests for your own team only.");
        if (patch.departmentId && patch.departmentId !== request.departmentId) await activeDepartment(tx, patch.departmentId);
        if (patch.neededBy !== undefined && patch.neededBy !== request.neededBy) await assertNeededBy(tx, patch.neededBy);
        const changes = requestChanges(request, patch);
        if (!Object.keys(changes).length) break;
        await tx.update(techRequests).set({ ...changes, updatedAt: new Date() }).where(eq(techRequests.id, request.id));
        await audit(tx, actor, request.id, "tech_request.updated", { changes: Object.keys(changes), ...(own ? {} : { by: actor.role }) });
        break;
      }
      case "withdrawTechRequest": {
        const request = await openTechRequest(tx, action.id, ["new"], actor.id);
        const files = await tx.select({ objectKey: attachments.objectKey }).from(attachments).where(eq(attachments.requestId, request.id));
        removedObjects.push(...files.map((file) => file.objectKey));
        await tx.delete(techRequests).where(eq(techRequests.id, request.id));
        await audit(tx, actor, request.id, "tech_request.withdrawn", { title: request.title });
        break;
      }
      case "forwardTechRequest": {
        const request = await openTechRequest(tx, action.id, ["new"]);
        const now = new Date();
        const priority = action.priority && action.priority !== request.priority ? { priority: action.priority } : {};
        await tx.update(techRequests).set({ status: "forwarded", forwardedById: actor.id, forwardedAt: now, updatedAt: now, ...priority }).where(eq(techRequests.id, request.id));
        // A note for the tech lead stays on the tech side.
        const note = action.note?.trim();
        if (note) await tx.insert(requestComments).values({ requestId: request.id, authorId: actor.id, body: note, internal: true });
        await audit(tx, actor, request.id, "tech_request.forwarded", { ...(priority.priority ? { priorityFrom: request.priority, priorityTo: priority.priority } : {}) }, note);
        break;
      }
      case "returnTechRequest": {
        const request = await openTechRequest(tx, action.id, ["forwarded"]);
        const now = new Date();
        await tx.update(techRequests).set({ status: "new", forwardedById: null, forwardedAt: null, updatedAt: now }).where(eq(techRequests.id, request.id));
        await tx.insert(requestComments).values({ requestId: request.id, authorId: actor.id, body: action.reason, internal: true });
        await audit(tx, actor, request.id, "tech_request.returned", { forwardedById: request.forwardedById }, action.reason);
        break;
      }
      case "assignTechRequest": {
        const request = await openTechRequest(tx, action.id, ["new", "forwarded"]);
        const ticket = action.type === "task";
        // The request's details become the work's description. The link back shows who asked and for which team.
        const item = await insertItem(tx, actor, {
          type: action.type, title: action.title, description: request.description, projectId: action.projectId, phaseId: action.phaseId,
          assigneeId: action.assigneeId, priority: action.priority ?? request.priority, severity: ticket ? undefined : action.severity,
          estimateHours: ticket ? action.estimateHours : undefined, dueDate: ticket ? action.dueDate ?? null : null,
        }, { techRequestId: request.id });
        const now = new Date();
        await tx.update(techRequests).set({ status: "assigned", itemId: item.id, reviewedById: actor.id, reviewedAt: now, reviewNote: action.note?.trim() || null, updatedAt: now }).where(eq(techRequests.id, request.id));
        await audit(tx, actor, request.id, "tech_request.assigned", { itemId: item.id, type: item.type, assigneeId: item.assigneeId, skippedReview: request.status === "new" }, action.note);
        break;
      }
      case "declineTechRequest": {
        const request = await openTechRequest(tx, action.id, openStages(actor));
        const now = new Date();
        await tx.update(techRequests).set({ status: "declined", reviewedById: actor.id, reviewedAt: now, reviewNote: action.reason, updatedAt: now }).where(eq(techRequests.id, request.id));
        await audit(tx, actor, request.id, "tech_request.declined", { by: actor.role }, action.reason);
        break;
      }
      case "addRequestComment": {
        const [request] = await tx.select().from(techRequests).where(eq(techRequests.id, action.requestId)).for("share");
        if (!request || !(await canSeeRequest(tx, actor, request))) throw new AppError("This request was not found.", 404);
        if (action.internal && actor.role === "requester") throw new AppError("Your comments are for everyone on the request.", 403);
        const [comment] = await tx.insert(requestComments).values({ requestId: request.id, authorId: actor.id, body: action.body, internal: !!action.internal }).returning();
        await tx.update(techRequests).set({ updatedAt: new Date() }).where(eq(techRequests.id, request.id));
        await audit(tx, actor, request.id, "tech_request.commented", { commentId: comment.id, internal: comment.internal });
        break;
      }
      case "deleteRequestComment": {
        const [comment] = await tx.select().from(requestComments).where(eq(requestComments.id, action.id)).for("update");
        const [request] = comment ? await tx.select().from(techRequests).where(eq(techRequests.id, comment.requestId)) : [];
        if (!comment || !request || !(await canSeeRequest(tx, actor, request)) || (comment.internal && actor.role === "requester")) throw new AppError("This comment was not found.", 404);
        // People remove their own words. The tech lead can also remove anything posted by mistake.
        if (comment.authorId !== actor.id && !leadsWork(actor)) throw new AppError("You can remove only your own comments.", 403);
        await tx.delete(requestComments).where(eq(requestComments.id, comment.id));
        await audit(tx, actor, request.id, "tech_request.comment_removed", { commentId: comment.id, authorId: comment.authorId });
        break;
      }
      case "createDepartment": {
        await tx.execute(sql`SELECT pg_advisory_xact_lock(7201204)`);
        await assertDepartmentNameFree(tx, action.name);
        const [last] = await tx.select({ position: departments.position }).from(departments).orderBy(desc(departments.position)).limit(1);
        const [department] = await tx.insert(departments).values({ name: action.name, position: (last?.position ?? -1) + 1 }).returning();
        await audit(tx, actor, department.id, "department.created", { name: department.name });
        break;
      }
      case "updateDepartment": {
        const [department] = await tx.select().from(departments).where(eq(departments.id, action.id)).for("update");
        if (!department) throw new AppError("This team was not found.", 404);
        if (action.name !== undefined && action.name !== department.name) await assertDepartmentNameFree(tx, action.name, department.id);
        const changes = { ...(action.name !== undefined && action.name !== department.name ? { name: action.name } : {}), ...(action.isArchived !== undefined && action.isArchived !== department.isArchived ? { isArchived: action.isArchived } : {}) };
        if (!Object.keys(changes).length) break;
        await tx.update(departments).set(changes).where(eq(departments.id, department.id));
        await audit(tx, actor, department.id, "department.updated", { from: department.name, ...changes });
        break;
      }
      case "updateItem": {
        const [item] = await tx.select().from(workItems).where(eq(workItems.id, action.id)).for("update");
        const lead = leadsWork(actor);
        if (!item || !lead && item.assigneeId !== actor.id) throw new AppError("This item was not found.", 404);
        const patch = { ...action.patch };
        if (!lead && Object.keys(patch).some((key) => !OWNER_FIELDS.has(key))) requireCapability(actor, "work.manage");
        if (item.type === "task" && patch.taskId) throw new AppError("Only a bug can link to a task.");
        const projectId = patch.projectId ?? item.projectId;
        const assigneeId = patch.assigneeId ?? item.assigneeId;
        const projectChanged = projectId !== item.projectId;
        const ownerChanged = assigneeId !== item.assigneeId;
        if (ownerChanged) await assertAssignee(tx, assigneeId);
        // Work can outlive membership after completion. Reopening must restore a valid assignment.
        const reopening = ["done", "verified"].includes(item.status) && patch.status && !["done", "verified"].includes(patch.status);
        if (projectChanged || ownerChanged || reopening) {
          await assertProject(tx, projectId);
          await assertAssignee(tx, assigneeId);
          await assertProjectOwner(tx, projectId, assigneeId);
        }
        if (projectChanged && patch.phaseId === undefined) patch.phaseId = null;
        if (item.type === "bug") {
          const task = await linkedTask(tx, patch.taskId === undefined ? item.taskId : patch.taskId, projectId);
          if (task) {
            if (action.patch.phaseId !== undefined && action.patch.phaseId !== task.phaseId) throw new AppError("A linked bug must use its task's phase.");
            patch.phaseId = task.phaseId;
          }
        }
        const phaseId = patch.phaseId === undefined ? item.phaseId : patch.phaseId;
        if (projectChanged || phaseId !== item.phaseId) await assertPhase(tx, projectId, phaseId);
        if (item.type === "task" && (projectChanged || phaseId !== item.phaseId)) {
          const linkedBugs = await tx.select({ id: workItems.id }).from(workItems).where(eq(workItems.taskId, item.id)).limit(1);
          if (linkedBugs.length) throw new AppError("Unlink this task's bugs before changing its project or phase.");
        }
        if (patch.estimateHours !== undefined && patch.estimateHours !== item.estimateHours) {
          if (item.type === "bug") throw new AppError("Bug fixes are included in the task estimate.");
          if (patch.estimateHours <= 0) throw new AppError("Task estimates must be greater than zero.");
          requireReason(action.reason);
          if (action.reasonCategory && action.reasonCategory !== "scope_change") throw new AppError("Estimate revisions need a scope change reason.");
        }
        if (patch.dueDate !== undefined && patch.dueDate !== item.dueDate) {
          if (item.type === "bug") throw new AppError("Bugs use their fix-by time instead of a date.");
          if (item.status === "done") throw new AppError("Reopen this ticket before changing its date.");
          // Setting the first due date is planning. Moving an existing one is an extension: the tech lead's needs a reason,
          // and a developer asks for it, so the date moves only after the tech lead approves.
          if (item.dueDate && !lead) throw new AppError("Use Extend to ask for more hours. Your tech lead approves it.", 403);
          if (item.dueDate) requireReason(action.reason);
        }
        if (item.status === "done" && patch.status !== "in_progress" && Object.keys(patch).some((key) => ["estimateHours", "assigneeId", "projectId", "phaseId"].includes(key))) throw new AppError("Reopen this task before changing its estimate, owner, project, or phase.");
        const transition = patch.status ? statusChange(item, patch.status, actor, action.reason) : {};
        if (item.type === "task" && transition.completedAt) {
          // Approved work counts on the ticket's date, not on the day the tech lead approves it.
          const calendar = await workCalendar(tx);
          const at = creditedAt(patch.dueDate !== undefined ? patch.dueDate : item.dueDate, calendar.workdayEnd, calendar.timezone, transition.completedAt as Date);
          transition.completedAt = at;
          for (const key of ["startedAt", "submittedAt"] as const) {
            const value = (transition[key] ?? item[key]) as Date | null;
            if (value && value > at) transition[key] = at;
          }
        }
        const nextStatus = patch.status ?? item.status;
        if (nextStatus === "blocked" && !(patch.blocker ?? item.blocker)?.trim()) throw new AppError("Add what is blocking this task.");
        if (item.type === "bug" && patch.blocker !== undefined) throw new AppError("Only tasks can be marked blocked.");
        const changes: Record<string, unknown> = {};
        for (const [key, value] of Object.entries(patch)) {
          const previous = item[key as keyof ItemRow];
          if (previous !== value) changes[key] = [previous, value];
        }
        if (!Object.keys(changes).length) break;
        // The first due date set is the original. Later moves keep it, so the size of each extension stays visible.
        const firstDueDate = changes.dueDate && !item.originalDueDate ? { originalDueDate: patch.dueDate } : {};
        await tx.update(workItems).set({ ...patch, ...transition, ...firstDueDate, updatedAt: new Date() }).where(eq(workItems.id, item.id));
        const genericChanges = Object.fromEntries(Object.entries(changes).filter(([key]) => !["status", "estimateHours", "dueDate"].includes(key)));
        const reasonPayload = action.reason ? { reasonCategory: action.reasonCategory ?? "other" } : {};
        if (Object.keys(genericChanges).length) await audit(tx, actor, item.id, `${item.type}.updated`, { changes: genericChanges, ...reasonPayload }, action.reason);
        if (changes.estimateHours) await audit(tx, actor, item.id, "task.estimate_revised", { from: item.estimateHours, to: patch.estimateHours, reasonCategory: "scope_change" }, action.reason);
        if (changes.dueDate) await audit(tx, actor, item.id, `${item.type}.due_changed`, { from: item.dueDate, to: patch.dueDate, ...reasonPayload }, action.reason);
        if (changes.status) {
          const event = item.type === "task" && nextStatus === "done" ? "task.completed"
            : item.type === "bug" && nextStatus === "fixed" ? "bug.fixed"
            : item.type === "bug" && nextStatus === "verified" ? "bug.verified"
            : item.type === "bug" && nextStatus === "open" ? "bug.reopened" : `${item.type}.status_changed`;
          let resolutionWorkingHours: number | undefined;
          if (item.type === "bug" && nextStatus === "fixed") {
            const configRows = await tx.select().from(settings).where(eq(settings.id, 1));
            const holidaysRows = await tx.select().from(holidays);
            const leaveRows = await tx.select().from(leaves).where(eq(leaves.userId, patch.assigneeId ?? item.assigneeId));
            const calendar = configRows[0]?.value ?? DEFAULT_SETTINGS;
            resolutionWorkingHours = Number(workingHoursBetween(item.reportedAt, transition.fixedAt as Date, {
              timezone: calendar.timezone, workingDays: calendar.workingDays,
              workdayStart: calendar.workdayStart, workdayEnd: calendar.workdayEnd,
              holidays: daysOff(holidaysRows),
              extraDaysOff: new Set(leaveRows.filter((leave) => leave.type === "full_day").map((leave) => leave.date)),
            }).toFixed(2));
          }
          await audit(tx, actor, item.id, event, {
            from: item.status, to: nextStatus,
            ...(nextStatus === "done" ? { creditedHours: patch.estimateHours ?? item.estimateHours, completedOn: (transition.completedAt as Date).toISOString() } : {}),
            ...(nextStatus === "open" ? { reopenCount: item.reopenCount + 1 } : {}),
            ...(resolutionWorkingHours !== undefined ? { workingHours: resolutionWorkingHours } : {}),
            ...reasonPayload,
          }, action.reason);
        }
        break;
      }
      case "createMember": {
        const [saved] = await tx.select().from(settings).where(eq(settings.id, 1));
        const defaults = saved?.value ?? DEFAULT_SETTINGS;
        const id = randomUUID(); const role = action.role ?? "developer"; const email = action.email.toLowerCase();
        assertMayManage(await savedActor(tx, actor), null, role);
        if (role !== "requester" && action.departmentId) throw new AppError("Only someone in a team outside tech has a team.");
        await assertEmailFree(tx, email);
        // A requester belongs to a team, such as Sales, and may lead it. Nobody else has a team.
        const departmentId = role === "requester" ? (await activeDepartment(tx, action.departmentId!)).id : null;
        const isTeamLead = role === "requester" && !!action.isTeamLead;
        await tx.insert(user).values({ id, name: action.name, email, emailVerified: false, role: storedRole(role) });
        // Without an Object ID, the member links their Microsoft account on first sign-in with this work email.
        if (action.microsoftObjectId) await linkMicrosoftAccount(tx, id, action.microsoftObjectId);
        await tx.insert(memberProfiles).values({ userId: id, capacity: action.capacity ?? (leadsWork(role) ? defaults.defaultLeadCapacityHours : defaults.defaultDevCapacityHours), departmentId, isTeamLead });
        await audit(tx, actor, id, "member.created", { name: action.name, role, departmentId, isTeamLead, microsoftObjectId: action.microsoftObjectId?.toLowerCase() ?? null });
        break;
      }
      case "removeMember": {
        await tx.execute(sql`SELECT pg_advisory_xact_lock(7201201)`);
        const [member] = await tx.select().from(user).where(eq(user.id, action.id)).for("update");
        if (!member) throw new AppError("This person was not found.", 404);
        assertMayManage(await savedActor(tx, actor), member.role, undefined);
        if (member.id === actor.id) throw new AppError("You cannot remove yourself. Ask another admin.");
        if (member.role === "admin") await assertAnotherAdmin(tx, member.id);
        const role = memberRole(member.role);
        const [openWork] = await tx.select({ id: workItems.id }).from(workItems).where(and(eq(workItems.assigneeId, member.id), notInArray(workItems.status, ["done", "verified"]))).limit(1);
        if (openWork) throw new AppError("Reassign this person's open tickets and bugs before removing them.");
        const deleted = !(await hasHistory(tx, member.id));
        if (deleted) {
          // Added by mistake, or never used: nothing refers to them, so the account goes.
          await tx.delete(user).where(eq(user.id, member.id));
        } else {
          // Their requests, comments, and history stay. They can no longer sign in, and an admin can restore them.
          await tx.update(user).set({ banned: true, updatedAt: new Date() }).where(eq(user.id, member.id));
          await tx.insert(memberProfiles).values({ userId: member.id, isActive: false })
            .onConflictDoUpdate({ target: memberProfiles.userId, set: { isActive: false } });
          await tx.delete(session).where(eq(session.userId, member.id));
        }
        await audit(tx, actor, member.id, "member.removed", { name: member.name, email: member.email, role, deleted });
        break;
      }
      case "updateMember": {
        await tx.execute(sql`SELECT pg_advisory_xact_lock(7201201)`);
        const [member] = await tx.select().from(user).where(eq(user.id, action.id));
        if (!member) throw new AppError("This team member was not found.", 404);
        const patch = action.patch;
        assertMayManage(await savedActor(tx, actor), member.role, patch.role);
        if (action.id === actor.id && (patch.isActive === false || (patch.role && patch.role !== actor.role))) throw new AppError(`You cannot turn off your own access or change your own role. Ask ${isOrgAdmin(actor) ? "another admin" : "an admin"}.`);
        // The last active admin stays an admin, so someone can always manage the organisation.
        if (member.role === "admin" && (patch.isActive === false || (patch.role && patch.role !== "admin"))) await assertAnotherAdmin(tx, member.id);
        const databaseRole = patch.role ? storedRole(patch.role) : undefined;
        const [existingProfile] = await tx.select().from(memberProfiles).where(eq(memberProfiles.userId, action.id));
        const nextRole = patch.role ?? memberRole(member.role);
        if (patch.role && ownsNoWork(patch.role) && !ownsNoWork(memberRole(member.role))) {
          // Requesters and project managers own no work and join no project. Move these to someone else first.
          const where = patch.role === "requester" ? "to a team outside tech" : "to project manager";
          const [openWork] = await tx.select({ id: workItems.id }).from(workItems).where(and(eq(workItems.assigneeId, action.id), notInArray(workItems.status, ["done", "verified"]))).limit(1);
          if (openWork) throw new AppError(`Reassign this person's open tickets and bugs before moving them ${where}.`);
          const [membership] = await tx.select({ projectId: projectMembers.projectId }).from(projectMembers).where(eq(projectMembers.userId, action.id)).limit(1);
          if (membership) throw new AppError(`Remove this person from their projects before moving them ${where}.`);
        }
        if (patch.departmentId) await activeDepartment(tx, patch.departmentId);
        if (nextRole === "requester" && !(patch.departmentId !== undefined ? patch.departmentId : existingProfile?.departmentId)) throw new AppError("Choose a team for this person.");
        if (patch.isTeamLead && nextRole !== "requester") throw new AppError("Only someone in a team outside tech can lead it.");
        // Someone who moves to the tech team leaves their other team.
        const leavesTeam = nextRole !== "requester" && !!(existingProfile?.departmentId || existingProfile?.isTeamLead);
        const email = patch.email?.toLowerCase();
        if (email && email !== member.email) {
          // The email is how a member is first matched at sign-in. After that, the Microsoft account is the identity.
          const [microsoft] = await tx.select({ id: account.id }).from(account).where(and(eq(account.userId, action.id), eq(account.providerId, "microsoft")));
          if (microsoft) throw new AppError("This member has signed in already. Their email can change only before their first sign-in.");
          await assertEmailFree(tx, email);
        }
        await tx.update(user).set({ ...(patch.name ? { name: patch.name } : {}), ...(email ? { email } : {}), ...(databaseRole ? { role: databaseRole } : {}), ...(patch.isActive !== undefined ? { banned: !patch.isActive } : {}), updatedAt: new Date() }).where(eq(user.id, action.id));
        if (!existingProfile || patch.capacity !== undefined || patch.isActive !== undefined || patch.departmentId !== undefined || patch.isTeamLead !== undefined || leavesTeam) {
          const capacity = patch.capacity ?? existingProfile?.capacity ?? (leadsWork(memberRole(member.role)) ? 10 : 33);
          const isActive = patch.isActive ?? existingProfile?.isActive ?? true;
          const departmentId = nextRole !== "requester" ? null : patch.departmentId !== undefined ? patch.departmentId : existingProfile?.departmentId ?? null;
          const isTeamLead = nextRole === "requester" && (patch.isTeamLead ?? existingProfile?.isTeamLead ?? false);
          await tx.insert(memberProfiles).values({ userId: action.id, capacity, isActive, departmentId, isTeamLead })
            .onConflictDoUpdate({ target: memberProfiles.userId, set: { capacity, isActive, departmentId, isTeamLead } });
        }
        const linked = patch.microsoftObjectId ? await linkMicrosoftAccount(tx, action.id, patch.microsoftObjectId) : false;
        if (linked) await tx.delete(account).where(and(eq(account.userId, action.id), eq(account.providerId, "credential")));
        if (patch.isActive === false || databaseRole && databaseRole !== member.role || linked) await tx.delete(session).where(eq(session.userId, action.id));
        await audit(tx, actor, action.id, "member.updated", { changes: patch, ...(linked ? { microsoftLinked: true } : {}) });
        break;
      }
      case "createProject": {
        assertProjectName(action.name);
        await assertProjectMembers(tx, action.memberIds);
        const primaryMemberId = action.primaryMemberId ?? null;
        assertPrimaryMember(action.memberIds, primaryMemberId);
        const targetDate = action.targetDate ?? null;
        const [project] = await tx.insert(projects).values({ name: action.name, description: action.description ?? "", color: action.color ?? "#2563eb", startDate: action.startDate ?? null, targetDate, originalTargetDate: targetDate }).returning();
        if (action.memberIds.length) await tx.insert(projectMembers).values(action.memberIds.map((userId) => ({ projectId: project.id, userId, isPrimary: userId === primaryMemberId })));
        if (action.phases.length) await tx.insert(projectPhases).values(action.phases.map((phase, position) => ({ projectId: project.id, name: phase.name, description: phase.description ?? "", position })));
        await audit(tx, actor, project.id, "project.created", { name: project.name, memberIds: action.memberIds, primaryMemberId, phaseNames: action.phases.map((phase) => phase.name), startDate: project.startDate, targetDate }); break;
      }
      case "updateProject": {
        const [project] = await tx.select().from(projects).where(eq(projects.id, action.id)).for("update");
        if (!project) throw new AppError("This project was not found.", 404);
        protectAdhoc(project);
        if (action.patch.name) assertProjectName(action.patch.name);
        const { memberIds, primaryMemberId, targetDate, ...details } = action.patch;
        const targetChanged = targetDate !== undefined && targetDate !== project.targetDate;
        const startChanged = details.startDate !== undefined && details.startDate !== project.startDate;
        if ((targetChanged || startChanged) && project.isArchived && details.isArchived !== false) throw new AppError("Restore this project before changing its timeline.");
        // Setting the first target is planning. Moving an existing one is an extension and needs a reason.
        if (targetChanged && project.targetDate) requireReason(action.reason);
        const nextStart = details.startDate === undefined ? project.startDate : details.startDate;
        const nextTarget = targetDate ?? project.targetDate;
        if (nextStart && nextTarget && nextTarget < nextStart) throw new AppError("The target date must be on or after the start date.");
        let primaryChanged = false;
        if (memberIds !== undefined || primaryMemberId !== undefined) {
          const current = await tx.select().from(projectMembers).where(eq(projectMembers.projectId, project.id));
          const currentPrimary = current.find((row) => row.isPrimary)?.userId ?? null;
          const nextIds = memberIds ?? current.map((row) => row.userId);
          // Keep the current primary unless it is changed or that person leaves the project.
          const nextPrimary = primaryMemberId !== undefined ? primaryMemberId : currentPrimary && nextIds.includes(currentPrimary) ? currentPrimary : null;
          primaryChanged = nextPrimary !== currentPrimary;
          if (memberIds !== undefined) await replaceProjectMembers(tx, project.id, nextIds, nextPrimary);
          else if (primaryChanged) {
            assertPrimaryMember(nextIds, nextPrimary);
            await tx.update(projectMembers).set({ isPrimary: false }).where(eq(projectMembers.projectId, project.id));
            if (nextPrimary) await tx.update(projectMembers).set({ isPrimary: true }).where(and(eq(projectMembers.projectId, project.id), eq(projectMembers.userId, nextPrimary)));
          }
        }
        const timeline = targetChanged ? { targetDate, ...(project.originalTargetDate ? {} : { originalTargetDate: targetDate }) } : {};
        if (Object.keys(details).length || targetChanged) await tx.update(projects).set({ ...details, ...timeline }).where(eq(projects.id, project.id));
        const otherChanges = { ...details, ...(memberIds !== undefined ? { memberIds } : {}), ...(primaryChanged ? { primaryMemberId: primaryMemberId ?? null } : {}) };
        if (Object.keys(otherChanges).length) await audit(tx, actor, action.id, "project.updated", { changes: otherChanges });
        if (targetChanged) await audit(tx, actor, action.id, "project.target_changed", { from: project.targetDate, to: targetDate, ...(project.targetDate ? { reasonCategory: action.reasonCategory ?? "other" } : {}) }, project.targetDate ? action.reason : undefined);
        break;
      }
      case "createPhase": {
        const [project] = await tx.select().from(projects).where(eq(projects.id, action.projectId)).for("update");
        if (!project) throw new AppError("This project was not found.", 404);
        protectAdhoc(project);
        if (project.isArchived) throw new AppError("Restore this project before adding a phase.");
        const [last] = await tx.select({ position: projectPhases.position }).from(projectPhases)
          .where(eq(projectPhases.projectId, project.id)).orderBy(sql`${projectPhases.position} DESC`).limit(1);
        const [phase] = await tx.insert(projectPhases).values({ projectId: project.id, name: action.name, description: action.description ?? "", position: (last?.position ?? -1) + 1 }).returning();
        await audit(tx, actor, project.id, "phase.created", { phaseId: phase.id, name: phase.name, position: phase.position }); break;
      }
      case "updatePhase": {
        const [phase] = await tx.select().from(projectPhases).where(eq(projectPhases.id, action.id));
        if (!phase) throw new AppError("This phase was not found.", 404);
        const [project] = await tx.select().from(projects).where(eq(projects.id, phase.projectId)).for("update");
        if (!project) throw new AppError("This project was not found.", 404);
        protectAdhoc(project);
        if (project.isArchived) throw new AppError("Restore this project before changing a phase.");
        if (action.name === undefined && action.description === undefined) break;
        await tx.update(projectPhases).set({ ...(action.name !== undefined ? { name: action.name } : {}), ...(action.description !== undefined ? { description: action.description } : {}) }).where(eq(projectPhases.id, phase.id));
        await audit(tx, actor, project.id, "phase.updated", { phaseId: phase.id, from: phase.name, to: action.name ?? phase.name, ...(action.description !== undefined ? { description: action.description } : {}) }); break;
      }
      case "saveSettings": {
        // Who can sign in is an organisation choice. A tech lead changes the team's working hours and scores, not the sign-in list.
        if (!isOrgAdmin(actor)) {
          // Locked, so an admin's change to the sign-in list at the same moment cannot be written back over.
          const [saved] = await tx.select().from(settings).where(eq(settings.id, 1)).for("update");
          const before = [...(saved?.value.requestDomains ?? [])].sort().join(",");
          if ([...action.settings.requestDomains].sort().join(",") !== before) requireCapability(actor, "org.manage");
        }
        await tx.insert(settings).values({ id: 1, value: action.settings }).onConflictDoUpdate({ target: settings.id, set: { value: action.settings, updatedAt: new Date() } });
        await audit(tx, actor, "settings", "settings.updated", { settings: action.settings }); break;
      }
      case "requestLeave": {
        if (actor.role !== "developer") throw new AppError("Only developers can request leave.", 403);
        await assertAssignee(tx, actor.id);
        // Serialize requests for this person so overlapping submissions cannot both pass.
        await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${actor.id}), 12)`);
        const dates = await leaveDates(tx, action);
        const recorded = await tx.select().from(leaves).where(eq(leaves.userId, actor.id));
        const pending = await tx.select().from(leaveRequests).where(and(eq(leaveRequests.requesterId, actor.id), eq(leaveRequests.status, "pending")));
        const taken = new Set([...recorded.map(l => l.date), ...pending.flatMap(r => r.dates)]);
        const fresh = dates.filter(date => !taken.has(date));
        if (!fresh.length) throw new AppError("Leave is already recorded or waiting for approval for these days.");
        const [request] = await tx.insert(leaveRequests).values({ requesterId: actor.id, dates: fresh, type: action.type, note: action.note ?? "" }).returning();
        await audit(tx, actor, request.id, "leave.requested", { dates: fresh, type: action.type });
        break;
      }
      case "approveLeaveRequest":
      case "declineLeaveRequest":
      case "withdrawLeaveRequest": {
        const [request] = await tx.select().from(leaveRequests).where(eq(leaveRequests.id, action.id)).for("update");
        if (!request || (action.action === "withdrawLeaveRequest" && request.requesterId !== actor.id)) throw new AppError("This leave request was not found.", 404);
        if (request.status !== "pending") throw new AppError("This leave request was already reviewed.", 409);
        if (action.action === "withdrawLeaveRequest") {
          await tx.delete(leaveRequests).where(eq(leaveRequests.id, request.id));
          await audit(tx, actor, request.id, "leave.withdrawn", {});
          break;
        }
        const approved = action.action === "approveLeaveRequest";
        if (approved) {
          await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${request.requesterId}), 12)`);
          await assertAssignee(tx, request.requesterId);
          const saved = await tx.insert(leaves).values(request.dates.map(date => ({ userId: request.requesterId, date, type: request.type, note: request.note })))
            .onConflictDoNothing({ target: [leaves.userId, leaves.date] }).returning();
          if (!saved.length) throw new AppError("Leave is already recorded for all these days. Decline this request instead.", 409);
          for (const leave of saved) await audit(tx, actor, leave.id, "leave.added", { userId: leave.userId, date: leave.date, type: leave.type, requestId: request.id });
        }
        const reviewNote = action.action === "declineLeaveRequest" ? action.reason : null;
        await tx.update(leaveRequests).set({ status: approved ? "approved" : "declined", reviewedById: actor.id, reviewedAt: new Date(), reviewNote }).where(eq(leaveRequests.id, request.id));
        await audit(tx, actor, request.id, approved ? "leave.approved" : "leave.declined", { dates: request.dates, requesterId: request.requesterId }, reviewNote ?? undefined);
        break;
      }
      case "addLeave": {
        for (const userId of action.userIds) await assertAssignee(tx, userId);
        const dates = await leaveDates(tx, action);
        // Days someone already has leave on are skipped, so one form can cover a whole team.
        const saved = await tx.insert(leaves).values(action.userIds.flatMap((userId) => dates.map((date) => ({ userId, date, type: action.type, note: action.note ?? "" }))))
          .onConflictDoNothing({ target: [leaves.userId, leaves.date] }).returning();
        if (!saved.length) throw new AppError("Leave is already recorded for these days.");
        for (const leave of saved) await audit(tx, actor, leave.id, "leave.added", { userId: leave.userId, date: leave.date, type: action.type });
        break;
      }
      case "addHoliday": {
        const [holiday] = await tx.insert(holidays).values({ date: action.date, name: action.name, type: action.type }).returning();
        await audit(tx, actor, holiday.id, "holiday.added", { date: action.date, name: action.name, type: action.type }); break;
      }
      case "deleteLeave": {
        const removed = await tx.delete(leaves).where(inArray(leaves.id, action.ids)).returning();
        if (removed.length !== new Set(action.ids).size) throw new AppError("This leave was not found.", 404);
        for (const leave of removed) await audit(tx, actor, leave.id, "leave.removed", { date: leave.date, userId: leave.userId });
        break;
      }
      case "deleteHoliday": {
        const [holiday] = await tx.delete(holidays).where(eq(holidays.id, action.id)).returning();
        if (!holiday) throw new AppError("This holiday was not found.", 404);
        await audit(tx, actor, action.id, "holiday.removed", { date: holiday.date }); break;
      }
    }
  });
  if (removedObjects.length) {
    try {
      const s3 = storageClient();
      await Promise.all(removedObjects.map((key) => s3.send(new DeleteObjectCommand({ Bucket: attachmentBucket(), Key: key })).catch(() => undefined)));
    } catch { /* Storage is not configured here. The rows are already gone, so nothing links to these files. */ }
  }
}
