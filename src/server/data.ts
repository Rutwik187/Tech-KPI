import { and, desc, eq, inArray, or, isNull, ne, sql } from "drizzle-orm";
import { headers } from "next/headers";
import { db } from "@/db";
import { account, activities, dueDateRequests, holidays, leaves, memberProfiles, projectMembers, projectPhases, projects, settings, snapshots, ticketRequests, user, workItems } from "@/db/schema";
import type { DashboardData, DueDateRequest, Member, TicketRequest, WorkItem } from "@/lib/types";
import { DEFAULT_SETTINGS } from "./default-settings";
import { requireSession } from "./authz";
import { ADHOC_PROJECT_ID } from "@/lib/project-defaults";

export function serializeItem(item: typeof workItems.$inferSelect): WorkItem {
  return {
    id: item.id, key: `${item.type === "bug" ? "BUG" : "UG"}-${String(item.sequence).padStart(3, "0")}`,
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

async function loadDashboardData(currentUser: Member): Promise<DashboardData> {
  const isAdmin = currentUser.role === "admin";
  const [itemRows, identities, projectRows, membershipRows, phaseRows, leaveRows, holidayRows, settingRows, snapshotRows, requestRows, dueDateRows] = await Promise.all([
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
  ]);
  const itemIds = itemRows.map((item) => item.id);
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
  const appSettings = settingRows[0]?.value ?? DEFAULT_SETTINGS;
  const members: Member[] = identities.map(({ identity, profile, microsoftObjectId }) => ({
    id: identity.id, name: identity.name, email: identity.email,
    role: identity.role === "admin" ? "admin" : "developer", image: identity.image,
    capacity: profile?.capacity ?? (identity.role === "admin" ? appSettings.defaultLeadCapacityHours : appSettings.defaultDevCapacityHours),
    isActive: !identity.banned && profile?.isActive !== false,
    joinedOn: profile?.joinedOn,
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
  };
}
