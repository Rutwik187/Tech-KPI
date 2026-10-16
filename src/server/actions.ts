import { randomUUID } from "node:crypto";
import { and, eq, inArray, notInArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { account, activities, holidays, leaves, memberProfiles, projectMembers, projectPhases, projects, session, settings, user, workItems } from "@/db/schema";
import type { Member } from "@/lib/types";
import { requireAdmin } from "./authz";
import { AppError } from "./errors";
import type { DataAction } from "./validation";
import { DEFAULT_SETTINGS } from "./default-settings";
import { workingHoursBetween } from "@/lib/kpi/calendar";
import { linkMicrosoftAccount } from "./microsoft-accounts";
import { ADHOC_PROJECT_ID } from "@/lib/project-defaults";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type ItemRow = typeof workItems.$inferSelect;
function audit(tx: Tx, actor: Member, entityId: string, action: string, payload: Record<string, unknown>, reason?: string) {
  return tx.insert(activities).values({ actorId: actor.id, entityId, action, payload, reason: reason || null });
}
function requireReason(reason?: string) {
  if (!reason || reason.trim().length < 3) throw new AppError("Add a short reason for this change.");
}
async function assertAssignee(tx: Tx, id: string) {
  const [member] = await tx.select({ id: user.id, banned: user.banned, isActive: memberProfiles.isActive }).from(user)
    .leftJoin(memberProfiles, eq(memberProfiles.userId, user.id)).where(eq(user.id, id));
  if (!member || member.banned || member.isActive === false) throw new AppError("Choose an active team member.");
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
  const members = await tx.select({ id: user.id, banned: user.banned, isActive: memberProfiles.isActive }).from(user)
    .leftJoin(memberProfiles, eq(memberProfiles.userId, user.id)).where(inArray(user.id, ids));
  if (members.length !== ids.length || members.some((member) => member.banned || member.isActive === false)) throw new AppError("Choose active team members for this project.");
}
async function replaceProjectMembers(tx: Tx, projectId: string, ids: string[]) {
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
  if (ids.length) await tx.insert(projectMembers).values(ids.map((userId) => ({ projectId, userId })));
}
function statusChange(item: ItemRow, next: string, actor: Member, reason?: string): Partial<typeof workItems.$inferInsert> {
  if (next === item.status) return {};
  const admin = actor.role === "admin";
  const now = new Date();
  if (item.type === "task") {
    const allowed: Record<string, string[]> = {
      todo: ["in_progress", "blocked"], in_progress: ["blocked", "in_review"],
      blocked: ["in_progress", "todo"], in_review: admin ? ["done", "in_progress"] : [],
      done: admin ? ["in_progress"] : [],
    };
    if (!allowed[item.status]?.includes(next)) throw new AppError("That task state change is not allowed.");
    if (item.status === "in_review" && next === "in_progress" || item.status === "done") requireReason(reason);
    return {
      status: next as ItemRow["status"],
      ...(next === "in_progress" && !item.startedAt ? { startedAt: now } : {}),
      ...(next === "in_review" ? { submittedAt: now } : {}),
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

export async function executeAction(actor: Member, action: DataAction): Promise<void> {
  if (action.action !== "updateItem") requireAdmin(actor);
  await db.transaction(async (tx) => {
    switch (action.action) {
      case "createItem": {
        const projectId = action.projectId ?? ADHOC_PROJECT_ID;
        await assertAssignee(tx, action.assigneeId);
        await assertProject(tx, projectId);
        await assertProjectOwner(tx, projectId, action.assigneeId);
        const task = action.type === "bug" ? await linkedTask(tx, action.taskId, projectId) : null;
        if (action.type === "task" && action.taskId) throw new AppError("Only a bug can link to a task.");
        const phaseId = action.phaseId === undefined ? task?.phaseId ?? null : action.phaseId;
        if (task && task.phaseId !== phaseId) throw new AppError("A linked bug must use its task's phase.");
        await assertPhase(tx, projectId, phaseId);
        const estimate = action.type === "task" ? action.estimateHours ?? 1 : 0;
        if (action.type === "task" && (estimate <= 0 || estimate > 80)) throw new AppError("Task estimates must be between 0.01 and 80 hours.");
        if (action.type === "bug" && action.estimateHours) throw new AppError("Bug fixes are included in the task estimate.");
        const [item] = await tx.insert(workItems).values({
          type: action.type, title: action.title, description: action.description ?? "", projectId, phaseId,
          assigneeId: action.assigneeId, createdById: actor.id, status: action.type === "task" ? "todo" : "open",
          priority: action.priority ?? "medium", severity: action.severity ?? "normal",
          estimateHours: estimate, originalEstimateHours: estimate, dueDate: action.dueDate, originalDueDate: action.dueDate,
          taskId: action.type === "bug" ? action.taskId : null,
        }).returning();
        await audit(tx, actor, item.id, action.type === "task" ? "task.created" : "bug.reported", {
          estimateHours: estimate, dueDate: item.dueDate, assigneeId: item.assigneeId, severity: item.severity, taskId: item.taskId, projectId, phaseId,
        });
        break;
      }
      case "updateItem": {
        const [item] = await tx.select().from(workItems).where(eq(workItems.id, action.id)).for("update");
        if (!item || actor.role !== "admin" && item.assigneeId !== actor.id) throw new AppError("This item was not found.", 404);
        const patch = { ...action.patch };
        if (actor.role !== "admin" && Object.keys(patch).some((key) => key !== "status" && key !== "blocker")) requireAdmin(actor);
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
        if (patch.dueDate !== undefined && patch.dueDate !== item.dueDate) requireReason(action.reason);
        if (item.status === "done" && patch.status !== "in_progress" && Object.keys(patch).some((key) => ["estimateHours", "assigneeId", "projectId", "phaseId"].includes(key))) throw new AppError("Reopen this task before changing its estimate, owner, project, or phase.");
        const transition = patch.status ? statusChange(item, patch.status, actor, action.reason) : {};
        const nextStatus = patch.status ?? item.status;
        if (nextStatus === "blocked" && !(patch.blocker ?? item.blocker)?.trim()) throw new AppError("Add what is blocking this task.");
        if (item.type === "bug" && patch.blocker !== undefined) throw new AppError("Only tasks can be marked blocked.");
        const changes: Record<string, unknown> = {};
        for (const [key, value] of Object.entries(patch)) {
          const previous = item[key as keyof ItemRow];
          if (previous !== value) changes[key] = [previous, value];
        }
        if (!Object.keys(changes).length) break;
        await tx.update(workItems).set({ ...patch, ...transition, updatedAt: new Date() }).where(eq(workItems.id, item.id));
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
              holidays: new Set(holidaysRows.map((holiday) => holiday.date)),
              extraDaysOff: new Set(leaveRows.filter((leave) => leave.type === "full_day").map((leave) => leave.date)),
            }).toFixed(2));
          }
          await audit(tx, actor, item.id, event, {
            from: item.status, to: nextStatus,
            ...(nextStatus === "done" ? { creditedHours: patch.estimateHours ?? item.estimateHours, completedOn: new Date().toISOString() } : {}),
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
        const id = randomUUID(); const memberRole = action.role ?? "developer";
        await tx.insert(user).values({ id, name: action.name, email: action.email.toLowerCase(), emailVerified: false, role: memberRole === "admin" ? "admin" : "user" });
        await linkMicrosoftAccount(tx, id, action.microsoftObjectId);
        await tx.insert(memberProfiles).values({ userId: id, capacity: action.capacity ?? (memberRole === "admin" ? defaults.defaultLeadCapacityHours : defaults.defaultDevCapacityHours) });
        await audit(tx, actor, id, "member.created", { name: action.name, role: memberRole, microsoftObjectId: action.microsoftObjectId.toLowerCase() });
        break;
      }
      case "updateMember": {
        await tx.execute(sql`SELECT pg_advisory_xact_lock(7201201)`);
        const [member] = await tx.select().from(user).where(eq(user.id, action.id));
        if (!member) throw new AppError("This team member was not found.", 404);
        if (action.id === actor.id && (action.patch.isActive === false || action.patch.role === "developer")) throw new AppError("You cannot disable or remove your own admin access.");
        const patch = action.patch;
        const databaseRole = patch.role ? patch.role === "admin" ? "admin" : "user" : undefined;
        await tx.update(user).set({ ...(patch.name ? { name: patch.name } : {}), ...(databaseRole ? { role: databaseRole } : {}), ...(patch.isActive !== undefined ? { banned: !patch.isActive } : {}), updatedAt: new Date() }).where(eq(user.id, action.id));
        const [existingProfile] = await tx.select().from(memberProfiles).where(eq(memberProfiles.userId, action.id));
        if (!existingProfile || patch.capacity !== undefined || patch.isActive !== undefined) {
          const capacity = patch.capacity ?? existingProfile?.capacity ?? (member.role === "admin" ? 10 : 33);
          const isActive = patch.isActive ?? existingProfile?.isActive ?? true;
          await tx.insert(memberProfiles).values({ userId: action.id, capacity, isActive })
            .onConflictDoUpdate({ target: memberProfiles.userId, set: { capacity, isActive } });
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
        const [project] = await tx.insert(projects).values({ name: action.name, description: action.description ?? "", color: action.color ?? "#2563eb" }).returning();
        if (action.memberIds.length) await tx.insert(projectMembers).values(action.memberIds.map((userId) => ({ projectId: project.id, userId })));
        if (action.phaseNames.length) await tx.insert(projectPhases).values(action.phaseNames.map((name, position) => ({ projectId: project.id, name, position })));
        await audit(tx, actor, project.id, "project.created", { name: project.name, memberIds: action.memberIds, phaseNames: action.phaseNames }); break;
      }
      case "updateProject": {
        const [project] = await tx.select().from(projects).where(eq(projects.id, action.id)).for("update");
        if (!project) throw new AppError("This project was not found.", 404);
        protectAdhoc(project);
        if (action.patch.name) assertProjectName(action.patch.name);
        const { memberIds, ...details } = action.patch;
        if (memberIds !== undefined) await replaceProjectMembers(tx, project.id, memberIds);
        if (Object.keys(details).length) await tx.update(projects).set(details).where(eq(projects.id, project.id));
        await audit(tx, actor, action.id, "project.updated", { changes: action.patch }); break;
      }
      case "createPhase": {
        const [project] = await tx.select().from(projects).where(eq(projects.id, action.projectId)).for("update");
        if (!project) throw new AppError("This project was not found.", 404);
        protectAdhoc(project);
        if (project.isArchived) throw new AppError("Restore this project before adding a phase.");
        const [last] = await tx.select({ position: projectPhases.position }).from(projectPhases)
          .where(eq(projectPhases.projectId, project.id)).orderBy(sql`${projectPhases.position} DESC`).limit(1);
        const [phase] = await tx.insert(projectPhases).values({ projectId: project.id, name: action.name, position: (last?.position ?? -1) + 1 }).returning();
        await audit(tx, actor, project.id, "phase.created", { phaseId: phase.id, name: phase.name, position: phase.position }); break;
      }
      case "updatePhase": {
        const [phase] = await tx.select().from(projectPhases).where(eq(projectPhases.id, action.id));
        if (!phase) throw new AppError("This phase was not found.", 404);
        const [project] = await tx.select().from(projects).where(eq(projects.id, phase.projectId)).for("update");
        if (!project) throw new AppError("This project was not found.", 404);
        protectAdhoc(project);
        if (project.isArchived) throw new AppError("Restore this project before changing a phase.");
        await tx.update(projectPhases).set({ name: action.name }).where(eq(projectPhases.id, phase.id));
        await audit(tx, actor, project.id, "phase.updated", { phaseId: phase.id, from: phase.name, to: action.name }); break;
      }
      case "saveSettings": {
        await tx.insert(settings).values({ id: 1, value: action.settings }).onConflictDoUpdate({ target: settings.id, set: { value: action.settings, updatedAt: new Date() } });
        await audit(tx, actor, "settings", "settings.updated", { settings: action.settings }); break;
      }
      case "addLeave": {
        await assertAssignee(tx, action.userId);
        const [leave] = await tx.insert(leaves).values({ userId: action.userId, date: action.date, type: action.type, note: action.note ?? "" }).returning();
        await audit(tx, actor, leave.id, "leave.added", { userId: action.userId, date: action.date, type: action.type }); break;
      }
      case "addHoliday": {
        const [holiday] = await tx.insert(holidays).values({ date: action.date, name: action.name }).returning();
        await audit(tx, actor, holiday.id, "holiday.added", { date: action.date, name: action.name }); break;
      }
      case "deleteLeave": {
        const [leave] = await tx.delete(leaves).where(eq(leaves.id, action.id)).returning();
        if (!leave) throw new AppError("This leave was not found.", 404);
        await audit(tx, actor, action.id, "leave.removed", { date: leave.date, userId: leave.userId }); break;
      }
      case "deleteHoliday": {
        const [holiday] = await tx.delete(holidays).where(eq(holidays.id, action.id)).returning();
        if (!holiday) throw new AppError("This holiday was not found.", 404);
        await audit(tx, actor, action.id, "holiday.removed", { date: holiday.date }); break;
      }
    }
  });
}
