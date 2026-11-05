import { and, desc, eq, inArray, or, isNull, ne, sql, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { headers } from "next/headers";
import { db } from "@/db";
import { account, activities, departments, dueDateRequests, holidays, leaves, memberProfiles, projectMembers, projectPhases, projects, settings, snapshots, techRequests, ticketRequests, user, workItems } from "@/db/schema";
import type { DashboardData, DueDateRequest, Member, TechRequest, TicketRequest, WorkItem } from "@/lib/types";
import { withDefaults } from "./default-settings";
import { memberRole, requireSession } from "./authz";
import { ADHOC_PROJECT_ID } from "@/lib/project-defaults";

type ItemRow = typeof workItems.$inferSelect;
function itemKey(item: Pick<ItemRow, "type" | "sequence">) {
  return `${item.type === "bug" ? "BUG" : "UG"}-${String(item.sequence).padStart(3, "0")}`;
}
export function serializeItem(item: ItemRow): WorkItem {
  return {
    id: item.id, key: itemKey(item),
    type: item.type, title: item.title, description: item.description,
    projectId: item.projectId, phaseId: item.phaseId, assigneeId: item.assigneeId, status: item.status, priority: item.priority,
    severity: item.severity, estimateHours: item.estimateHours, dueDate: item.dueDate, originalDueDate: item.originalDueDate,
    createdAt: item.createdAt.toISOString(), updatedAt: item.updatedAt.toISOString(),
    startedAt: item.startedAt?.toISOString() ?? null, completedAt: item.completedAt?.toISOString() ?? null,
    fixedAt: item.fixedAt?.toISOString() ?? null, reportedAt: item.reportedAt.toISOString(),
    blocker: item.blocker, taskId: item.taskId, reopenCount: item.reopenCount,
  };
}

export function serializeDueDateRequest(request: typeof dueDateRequests.$inferSelect): DueDateRequest {
  return { ...request, reviewedAt: request.reviewedAt?.toISOString() ?? null, createdAt: request.createdAt.toISOString() };
}

export function serializeRequest(request: typeof ticketRequests.$inferSelect): TicketRequest {
  return {
    ...request, reviewedAt: request.reviewedAt?.toISOString() ?? null, createdAt: request.createdAt.toISOString(),
  };
}

function loadDepartments() {
  return db.select({ id: departments.id, name: departments.name, position: departments.position, isArchived: departments.isArchived })
    .from(departments).orderBy(departments.position, departments.name);
}

const assignee = alias(user, "assignee");
/** Requests with their requester's name and the work they became. New ones come first, then the newest. */
async function loadTechRequests(where: SQL | undefined, limit: number): Promise<TechRequest[]> {
  const rows = await db.select({ request: techRequests, requesterName: user.name, item: workItems, assigneeName: assignee.name })
    .from(techRequests).innerJoin(user, eq(user.id, techRequests.requesterId))
    .leftJoin(workItems, eq(workItems.id, techRequests.itemId)).leftJoin(assignee, eq(assignee.id, workItems.assigneeId))
    .where(where).orderBy(sql`${techRequests.status} = 'new' DESC`, desc(techRequests.createdAt)).limit(limit);
  return rows.map(({ request, requesterName, item, assigneeName }) => ({
    id: request.id, key: `REQ-${String(request.sequence).padStart(3, "0")}`, requesterId: request.requesterId, requesterName, departmentId: request.departmentId,
    title: request.title, description: request.description, category: request.category, priority: request.priority, neededBy: request.neededBy,
    status: request.status, reviewedById: request.reviewedById, reviewedAt: request.reviewedAt?.toISOString() ?? null, reviewNote: request.reviewNote,
    itemId: request.itemId, createdAt: request.createdAt.toISOString(), updatedAt: request.updatedAt.toISOString(),
    work: item ? {
      key: itemKey(item), type: item.type, status: item.status, assigneeId: item.assigneeId, assigneeName: assigneeName ?? "A developer", dueDate: item.dueDate,
      doneAt: (item.type === "task" ? item.completedAt : item.fixedAt)?.toISOString() ?? null,
    } : null,
  }));
}

export async function getDashboardData(requestHeaders?: Headers): Promise<DashboardData> {
  const currentUser = await requireSession(requestHeaders ?? await headers());
  return loadDashboardData(currentUser);
}

/** Cron-only source. Its route must validate CRON_SECRET before calling this. */
export async function getSnapshotSource(): Promise<DashboardData | null> {
  const [identity] = await db.select({ identity: user, profile: memberProfiles }).from(user)
    .leftJoin(memberProfiles, eq(memberProfiles.userId, user.id)).where(and(eq(user.role, "admin"), or(eq(user.banned, false), isNull(user.banned)), or(eq(memberProfiles.isActive, true), isNull(memberProfiles.userId))));
  if (!identity || identity.identity.banned || identity.profile?.isActive === false) return null;
  return loadDashboardData({
    id: identity.identity.id, name: identity.identity.name, email: identity.identity.email,
    image: identity.identity.image, role: "admin", isActive: true, capacity: identity.profile?.capacity ?? 10,
    joinedOn: identity.profile?.joinedOn,
  });
}

/** A requester sees the teams, their own requests, and their team's requests. No tickets, people, or scores. */
async function loadRequesterData(currentUser: Member): Promise<DashboardData> {
  const [departmentRows, settingRows, requests] = await Promise.all([
    loadDepartments(),
    db.select().from(settings).where(eq(settings.id, 1)),
    loadTechRequests(or(eq(techRequests.requesterId, currentUser.id), currentUser.departmentId ? eq(techRequests.departmentId, currentUser.departmentId) : undefined), 300),
  ]);
  return {
    currentUser, members: [currentUser], projects: [], phases: [], items: [], requests: [], dueDateRequests: [], activities: [], leaves: [], holidays: [],
    settings: withDefaults(settingRows[0]?.value), mode: "live", snapshots: [], departments: departmentRows, techRequests: requests,
  };
}

async function loadDashboardData(currentUser: Member): Promise<DashboardData> {
  if (currentUser.role === "requester") return loadRequesterData(currentUser);
  const isAdmin = currentUser.role === "admin";
  const [itemRows, identities, projectRows, membershipRows, phaseRows, leaveRows, holidayRows, settingRows, snapshotRows, requestRows, dueDateRows, departmentRows] = await Promise.all([
    db.select().from(workItems).where(isAdmin ? undefined : eq(workItems.assigneeId, currentUser.id)).orderBy(desc(workItems.createdAt)),
    db.select({ identity: user, profile: memberProfiles, microsoftObjectId: account.accountId }).from(user)
      .leftJoin(memberProfiles, eq(memberProfiles.userId, user.id))
      .leftJoin(account, and(eq(account.userId, user.id), eq(account.providerId, "microsoft")))
      .where(isAdmin ? undefined : eq(user.id, currentUser.id)),
    db.select().from(projects),
    db.select().from(projectMembers),
    db.select().from(projectPhases).orderBy(projectPhases.position, projectPhases.name),
    db.select().from(leaves).where(isAdmin ? undefined : eq(leaves.userId, currentUser.id)),
    db.select().from(holidays), db.select().from(settings).where(eq(settings.id, 1)),
    db.select({ userId: snapshots.userId, weekStart: snapshots.weekStart, value: snapshots.value }).from(snapshots).where(isAdmin ? undefined : eq(snapshots.userId, currentUser.id)),
    // Admins review everyone's requests. A developer sees only their own.
    db.select().from(ticketRequests).where(isAdmin ? undefined : eq(ticketRequests.requesterId, currentUser.id)).orderBy(desc(ticketRequests.createdAt)).limit(200),
    db.select().from(dueDateRequests).where(isAdmin ? undefined : eq(dueDateRequests.requesterId, currentUser.id)).orderBy(desc(dueDateRequests.createdAt)).limit(200),
    loadDepartments(),
  ]);
  const itemIds = itemRows.map((item) => item.id);
  // Admins triage every team's requests. A developer sees the requests behind their own tickets and bugs.
  const techRequestRows = isAdmin ? await loadTechRequests(undefined, 500)
    : itemIds.length ? await loadTechRequests(inArray(techRequests.itemId, itemIds), 500) : [];
  if (!isAdmin) {
    // A reassigned bug can already have a locked score under its previous owner. Send only that allocation.
    const allocations = await db.select({ weekStart: snapshots.weekStart, bugIds: sql<unknown>`${snapshots.value}->'scoredBugIds'` })
      .from(snapshots).where(ne(snapshots.userId, currentUser.id));
    const assignedBugIds = new Set(itemRows.filter((item) => item.type === "bug").map((item) => item.id));
    for (const allocation of allocations) {
      const bugIds = Array.isArray(allocation.bugIds) ? allocation.bugIds.filter((id): id is string => typeof id === "string" && assignedBugIds.has(id)) : [];
      if (bugIds.length) snapshotRows.push({ userId: "allocation", weekStart: allocation.weekStart, value: { scoredBugIds: bugIds } });
    }
  }
  const assignedProjects = new Set(membershipRows.filter((row) => row.userId === currentUser.id).map((row) => row.projectId));
  const historicalProjects = new Set([...itemRows, ...requestRows].map((row) => row.projectId));
  const visibleProjects = projectRows.filter((project) => isAdmin || project.id === ADHOC_PROJECT_ID || assignedProjects.has(project.id) || historicalProjects.has(project.id));
  const visibleProjectIds = new Set(visibleProjects.map((project) => project.id));
  // Developers see their own work's history and why their projects' targets moved, nothing else.
  const activityRows = isAdmin
    ? await db.select().from(activities).orderBy(desc(activities.createdAt))
    : await db.select().from(activities).where(or(
      itemIds.length ? inArray(activities.entityId, itemIds) : undefined,
      and(inArray(activities.entityId, [...visibleProjectIds]), eq(activities.action, "project.target_changed")),
    )).orderBy(desc(activities.createdAt));
  const appSettings = withDefaults(settingRows[0]?.value);
  const members: Member[] = identities.map(({ identity, profile, microsoftObjectId }) => ({
    id: identity.id, name: identity.name, email: identity.email,
    role: memberRole(identity.role), image: identity.image,
    capacity: profile?.capacity ?? (identity.role === "admin" ? appSettings.defaultLeadCapacityHours : appSettings.defaultDevCapacityHours),
    isActive: !identity.banned && profile?.isActive !== false,
    joinedOn: profile?.joinedOn, departmentId: profile?.departmentId ?? null, isTeamLead: profile?.isTeamLead ?? false,
    ...(isAdmin && microsoftObjectId ? { microsoftObjectId } : {}),
  }));
  return {
    currentUser: members.find((member) => member.id === currentUser.id) ?? currentUser, members,
    projects: visibleProjects.map((project) => {
      const rows = membershipRows.filter((row) => row.projectId === project.id);
      return { ...project, memberIds: rows.map((row) => row.userId), primaryMemberId: rows.find((row) => row.isPrimary)?.userId ?? null };
    }),
    phases: phaseRows.filter((phase) => visibleProjectIds.has(phase.projectId)),
    items: itemRows.map(serializeItem), requests: requestRows.map(serializeRequest), dueDateRequests: dueDateRows.map(serializeDueDateRequest), activities: activityRows.map((activity) => ({ ...activity, createdAt: activity.createdAt.toISOString() })),
    leaves: leaveRows, holidays: holidayRows, settings: appSettings, mode: "live", snapshots: snapshotRows,
    departments: departmentRows, techRequests: techRequestRows,
  };
}
