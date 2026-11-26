import { and, desc, eq, inArray, notInArray, or, isNull, ne, sql, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { headers } from "next/headers";
import { db } from "@/db";
import { account, activities, attachments, departments, dueDateRequests, holidays, leaves, leaveRequests, memberProfiles, projectMembers, projectPhases, projects, requestComments, settings, snapshots, techRequests, ticketRequests, user, workItems } from "@/db/schema";
import type { DashboardData, DueDateRequest, Member, RequestComment, RequestEvent, Role, TechRequest, TicketRequest, WorkItem } from "@/lib/types";
import { withDefaults } from "./default-settings";
import { memberRole, requireSession } from "./authz";
import { isOrgAdmin, leadsWork, manageableRoles } from "@/lib/permissions";
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
/**
 * History steps a requester may read. Returning a request to a project manager, and comment removals, are tech-side
 * housekeeping, so the requester's history leaves them out. Their stage already shows where the request is.
 */
const REQUESTER_EVENTS = new Set(["tech_request.created", "tech_request.updated", "tech_request.forwarded", "tech_request.assigned", "tech_request.declined", "tech_request.plan_shared", "tech_request.plan_confirmed", "attachment.added", "attachment.removed"]);
/** History steps everyone on the tech side reads. Comments are shown as comments, so they are not repeated as steps. */
const HIDDEN_EVENTS = new Set(["tech_request.commented", "tech_request.comment_removed", "tech_request.plan_saved"]);

/**
 * Requests with their requester's name, the work they became, their comments, their history, and how many files they have.
 * New ones come first, then the newest. A requester gets public comments only, and history without tech-side notes.
 */
async function loadTechRequests(where: SQL | undefined, limit: number, viewer: Role): Promise<TechRequest[]> {
  const rows = await db.select({ request: techRequests, requesterName: user.name, item: workItems, assigneeName: assignee.name })
    .from(techRequests).innerJoin(user, eq(user.id, techRequests.requesterId))
    .leftJoin(workItems, eq(workItems.id, techRequests.itemId)).leftJoin(assignee, eq(assignee.id, workItems.assigneeId))
    .where(where).orderBy(sql`${techRequests.status} IN ('new', 'forwarded') DESC`, desc(techRequests.createdAt)).limit(limit);
  const ids = rows.map(({ request }) => request.id);
  const requester = viewer === "requester";
  const author = alias(user, "author");
  const [commentRows, eventRows, fileCounts] = ids.length ? await Promise.all([
    db.select({ comment: requestComments, authorName: author.name, authorRole: author.role }).from(requestComments)
      .innerJoin(author, eq(author.id, requestComments.authorId))
      .where(and(inArray(requestComments.requestId, ids), requester ? eq(requestComments.internal, false) : undefined))
      .orderBy(requestComments.createdAt),
    db.select({ event: activities, actorName: author.name }).from(activities).innerJoin(author, eq(author.id, activities.actorId))
      .where(and(inArray(activities.entityId, ids), sql`(${activities.action} LIKE 'tech_request.%' OR ${activities.action} LIKE 'attachment.%')`))
      .orderBy(activities.createdAt),
    db.select({ requestId: attachments.requestId, count: sql<number>`count(*)::int` }).from(attachments)
      .where(inArray(attachments.requestId, ids)).groupBy(attachments.requestId),
  ]) : [[], [], []];
  const comments = new Map<string, RequestComment[]>();
  for (const { comment, authorName, authorRole } of commentRows) {
    const list = comments.get(comment.requestId) ?? [];
    list.push({ id: comment.id, requestId: comment.requestId, authorId: comment.authorId, authorName, authorRole: memberRole(authorRole), body: comment.body, internal: comment.internal, createdAt: comment.createdAt.toISOString() });
    comments.set(comment.requestId, list);
  }
  const history = new Map<string, RequestEvent[]>();
  for (const { event, actorName } of eventRows) {
    if (HIDDEN_EVENTS.has(event.action) || (requester && !REQUESTER_EVENTS.has(event.action))) continue;
    // A forwarding note is for the tech lead. The decline reason and the assignment note are written for the requester.
    const publicNote = event.action === "tech_request.declined" || event.action === "tech_request.assigned" || event.action === "tech_request.plan_shared";
    const list = history.get(event.entityId) ?? [];
    list.push({
      id: event.id, action: event.action, actorId: event.actorId, actorName, createdAt: event.createdAt.toISOString(),
      note: requester && !publicNote ? null : event.reason,
      payload: requester ? pick(event.payload, ["name", "changes", "type", "version", "plan"]) : event.payload,
    });
    history.set(event.entityId, list);
  }
  const files = new Map(fileCounts.map((row) => [row.requestId, row.count]));
  return rows.map(({ request, requesterName, item, assigneeName }) => ({
    id: request.id, key: `REQ-${String(request.sequence).padStart(3, "0")}`, requesterId: request.requesterId, requesterName, departmentId: request.departmentId,
    title: request.title, description: request.description, category: request.category, tool: request.tool, priority: request.priority, neededBy: request.neededBy,
    status: request.status, forwardedById: request.forwardedById, forwardedAt: request.forwardedAt?.toISOString() ?? null,
    reviewedById: request.reviewedById, reviewedAt: request.reviewedAt?.toISOString() ?? null, reviewNote: request.reviewNote,
    itemId: request.itemId, createdAt: request.createdAt.toISOString(), updatedAt: request.updatedAt.toISOString(),
    work: item ? {
      key: itemKey(item), type: item.type, status: item.status, assigneeId: item.assigneeId, assigneeName: assigneeName ?? "A developer", dueDate: item.dueDate,
      doneAt: (item.type === "task" ? item.completedAt : item.fixedAt)?.toISOString() ?? null,
    } : null,
    comments: comments.get(request.id) ?? [], history: history.get(request.id) ?? [], attachmentCount: files.get(request.id) ?? 0,
    // A requester reads the plan that was sent, never the draft.
    plan: requester ? null : request.plan ?? null, sharedPlan: request.planShared ?? null,
  }));
}
function pick(value: Record<string, unknown>, keys: string[]) {
  return Object.fromEntries(keys.filter((key) => key in value).map((key) => [key, value[key]]));
}

export async function getDashboardData(requestHeaders?: Headers): Promise<DashboardData> {
  const currentUser = await requireSession(requestHeaders ?? await headers());
  return loadDashboardData(currentUser);
}

/** Cron-only source. Its route must validate CRON_SECRET before calling this. */
export async function getSnapshotSource(): Promise<DashboardData | null> {
  const [identity] = await db.select({ identity: user, profile: memberProfiles }).from(user)
    .leftJoin(memberProfiles, eq(memberProfiles.userId, user.id)).where(and(inArray(user.role, ["admin", "tech_lead"]), or(eq(user.banned, false), isNull(user.banned)), or(eq(memberProfiles.isActive, true), isNull(memberProfiles.userId))));
  if (!identity || identity.identity.banned || identity.profile?.isActive === false) return null;
  return loadDashboardData({
    id: identity.identity.id, name: identity.identity.name, email: identity.identity.email,
    image: identity.identity.image, role: memberRole(identity.identity.role), isActive: true, capacity: identity.profile?.capacity ?? 10,
    joinedOn: identity.profile?.joinedOn,
  });
}

/** A requester sees the teams, their own requests, and their team's requests. No tickets, people, or scores. */
async function loadRequesterData(currentUser: Member): Promise<DashboardData> {
  const [departmentRows, settingRows, requests] = await Promise.all([
    loadDepartments(),
    db.select().from(settings).where(eq(settings.id, 1)),
    loadTechRequests(or(eq(techRequests.requesterId, currentUser.id), currentUser.departmentId ? eq(techRequests.departmentId, currentUser.departmentId) : undefined), 300, "requester"),
  ]);
  return {
    currentUser, members: [currentUser], projects: [], phases: [], items: [], requests: [], dueDateRequests: [], activities: [], leaves: [], leaveRequests: [], holidays: [],
    settings: withDefaults(settingRows[0]?.value), mode: "live", snapshots: [], departments: departmentRows, techRequests: requests,
  };
}

/**
 * A project manager sees every team's requests, with their comments and progress, and the teams. No tickets, people, or scores.
 * Names of requesters, commenters, and developers come with each request, so no list of people is needed.
 */
async function loadManagerData(currentUser: Member): Promise<DashboardData> {
  const [departmentRows, settingRows, requests] = await Promise.all([
    loadDepartments(), db.select().from(settings).where(eq(settings.id, 1)), loadTechRequests(undefined, 500, "project_manager"),
  ]);
  return {
    currentUser, members: [currentUser], projects: [], phases: [], items: [], requests: [], dueDateRequests: [], activities: [], leaves: [], leaveRequests: [], holidays: [],
    settings: withDefaults(settingRows[0]?.value), mode: "live", snapshots: [], departments: departmentRows, techRequests: requests,
  };
}

async function loadDashboardData(currentUser: Member): Promise<DashboardData> {
  if (currentUser.role === "requester") return loadRequesterData(currentUser);
  if (currentUser.role === "project_manager") return loadManagerData(currentUser);
  // The admin and the tech lead see the whole tech team. Only an admin also sees the people in teams outside tech.
  const isAdmin = leadsWork(currentUser);
  const orgAdmin = isOrgAdmin(currentUser);
  const [itemRows, identities, projectRows, membershipRows, phaseRows, leaveRows, holidayRows, settingRows, snapshotRows, requestRows, dueDateRows, departmentRows, leaveRequestRows] = await Promise.all([
    db.select().from(workItems).where(isAdmin ? undefined : eq(workItems.assigneeId, currentUser.id)).orderBy(desc(workItems.createdAt)),
    db.select({ identity: user, profile: memberProfiles, microsoftObjectId: account.accountId }).from(user)
      .leftJoin(memberProfiles, eq(memberProfiles.userId, user.id))
      .leftJoin(account, and(eq(account.userId, user.id), eq(account.providerId, "microsoft")))
      .where(orgAdmin ? undefined : isAdmin ? sql`${user.role} IS DISTINCT FROM 'requester'` : eq(user.id, currentUser.id)),
    db.select().from(projects),
    db.select().from(projectMembers),
    db.select().from(projectPhases).orderBy(projectPhases.position, projectPhases.name),
    db.select().from(leaves).where(isAdmin ? undefined : eq(leaves.userId, currentUser.id)),
    db.select().from(holidays), db.select().from(settings).where(eq(settings.id, 1)),
    db.select({ userId: snapshots.userId, weekStart: snapshots.weekStart, value: snapshots.value }).from(snapshots).where(isAdmin ? undefined : eq(snapshots.userId, currentUser.id)),
    // The tech lead reviews everyone's requests. A developer sees only their own.
    db.select().from(ticketRequests).where(isAdmin ? undefined : eq(ticketRequests.requesterId, currentUser.id)).orderBy(desc(ticketRequests.createdAt)).limit(200),
    db.select().from(dueDateRequests).where(isAdmin ? undefined : eq(dueDateRequests.requesterId, currentUser.id)).orderBy(desc(dueDateRequests.createdAt)).limit(200),
    loadDepartments(),
    db.select().from(leaveRequests).where(isAdmin ? undefined : eq(leaveRequests.requesterId, currentUser.id)).orderBy(desc(leaveRequests.createdAt)),
  ]);
  const itemIds = itemRows.map((item) => item.id);
  // The tech lead triages every team's requests. A developer sees the requests behind their own tickets and bugs.
  const techRequestRows = isAdmin ? await loadTechRequests(undefined, 500, currentUser.role)
    : itemIds.length ? await loadTechRequests(inArray(techRequests.itemId, itemIds), 500, "developer") : [];
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
  // An admin reads the whole activity log. A tech lead reads the tech team's: not changes to teams outside tech or their people.
  const requesterIds = orgAdmin || !isAdmin ? [] : (await db.select({ id: user.id }).from(user).where(eq(user.role, "requester"))).map((row) => row.id);
  const activityRows = isAdmin
    ? await db.select().from(activities).where(orgAdmin ? undefined : and(sql`${activities.action} NOT LIKE 'department.%'`,
      // A removed requester has no account to match any more, so their removal is matched by the role it records.
      sql`NOT (${activities.action} LIKE 'member.%' AND ${activities.payload}->>'role' = 'requester')`,
      requesterIds.length ? notInArray(activities.entityId, requesterIds) : undefined)).orderBy(desc(activities.createdAt))
    : await db.select().from(activities).where(or(
      itemIds.length ? inArray(activities.entityId, itemIds) : undefined,
      and(inArray(activities.entityId, [...visibleProjectIds]), eq(activities.action, "project.target_changed")),
    )).orderBy(desc(activities.createdAt));
  const appSettings = withDefaults(settingRows[0]?.value);
  const manageable = new Set(manageableRoles(currentUser));
  const members: Member[] = identities.map(({ identity, profile, microsoftObjectId }) => ({
    id: identity.id, name: identity.name, email: identity.email,
    role: memberRole(identity.role), image: identity.image,
    capacity: profile?.capacity ?? (leadsWork(memberRole(identity.role)) ? appSettings.defaultLeadCapacityHours : appSettings.defaultDevCapacityHours),
    isActive: !identity.banned && profile?.isActive !== false,
    joinedOn: profile?.joinedOn, departmentId: profile?.departmentId ?? null, isTeamLead: profile?.isTeamLead ?? false,
    ...(identity.id === currentUser.id ? { emailNotifications: profile?.emailNotifications ?? true } : {}),
    // A Microsoft ID shows whether someone has signed in. Only people who may change that person receive it.
    ...(microsoftObjectId && manageable.has(memberRole(identity.role)) ? { microsoftObjectId } : {}),
  }));
  return {
    currentUser: members.find((member) => member.id === currentUser.id) ?? currentUser, members,
    projects: visibleProjects.map((project) => {
      const rows = membershipRows.filter((row) => row.projectId === project.id);
      return { ...project, memberIds: rows.map((row) => row.userId), primaryMemberId: rows.find((row) => row.isPrimary)?.userId ?? null };
    }),
    phases: phaseRows.filter((phase) => visibleProjectIds.has(phase.projectId)),
    items: itemRows.map(serializeItem), requests: requestRows.map(serializeRequest), dueDateRequests: dueDateRows.map(serializeDueDateRequest), activities: activityRows.map((activity) => ({ ...activity, createdAt: activity.createdAt.toISOString() })),
    leaveRequests: leaveRequestRows.map(r => ({ ...r, reviewedAt: r.reviewedAt?.toISOString() ?? null, createdAt: r.createdAt.toISOString() })), leaves: leaveRows, holidays: holidayRows, settings: appSettings, mode: "live", snapshots: snapshotRows,
    departments: departmentRows, techRequests: techRequestRows,
  };
}
