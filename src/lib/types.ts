/** A requester belongs to a team outside tech, such as Sales. They raise requests for tech work and see only those requests. An admin marks who leads each team. */
export type Role = 'admin' | 'developer' | 'requester';
export type TaskStatus = 'todo' | 'in_progress' | 'blocked' | 'in_review' | 'done';
export type BugStatus = 'open' | 'in_progress' | 'fixed' | 'verified';
export type Priority = 'low' | 'medium' | 'high' | 'urgent';
export type Severity = 'normal' | 'critical';
/** Why a due date or project target moved. Estimate revisions always use `scope_change`. */
export type ExtensionReason = 'blocked_dependency' | 'scope_change' | 'underestimated' | 'other';
export interface Member { id: string; name: string; email: string; role: Role; image: string | null; capacity: number; isActive: boolean; joinedOn?: string; microsoftObjectId?: string; departmentId?: string | null; isTeamLead?: boolean; }
/** `targetDate` is the current deadline. `originalTargetDate` is the first one set, so extensions stay visible. */
export interface Project { id: string; name: string; color: string; description: string; isArchived: boolean; memberIds: string[]; primaryMemberId: string | null; isAdhoc: boolean; startDate: string | null; targetDate: string | null; originalTargetDate: string | null; }
export interface Phase { id: string; projectId: string; name: string; description: string; position: number; }
export interface WorkItem { id: string; key: string; type: 'task' | 'bug'; title: string; description: string; projectId: string; phaseId: string | null; assigneeId: string; status: TaskStatus | BugStatus; priority: Priority; severity: Severity; estimateHours: number; dueDate: string | null; originalDueDate: string | null; createdAt: string; updatedAt: string; startedAt: string | null; completedAt: string | null; fixedAt: string | null; reportedAt: string; blocker: string | null; taskId: string | null; reopenCount: number; }
export interface Activity { id: string; entityId: string; actorId: string; action: string; reason: string | null; payload: Record<string, unknown>; createdAt: string; }
export interface Leave { id: string; userId: string; date: string; type: 'full_day' | 'half_day'; note: string; }
/** A day off for the whole team. A half-day holiday takes half the day's hours, and the office stays open. */
export interface Holiday { id: string; date: string; name: string; type: 'full_day' | 'half_day'; }
/** `requestDomains`: people with a work email on these domains may sign in to raise requests. Empty, the default, means only the people an admin adds to a team. */
export interface Settings { requestDomains: string[]; timezone: string; trackingStartDate: string; workingDays: number[]; workdayStart: string; workdayEnd: string; defaultDevCapacityHours: number; defaultLeadCapacityHours: number; deliveryWeight: number; bugWeight: number; leadTeamWeight: number; leadOwnWeight: number; criticalTargetHours: number; normalTargetHours: number; bandOnTarget: number; bandBelowTarget: number; }
/** A ticket a developer asked for. An admin approves it into a ticket or declines it with a reason. */
export interface TicketRequest { id: string; requesterId: string; title: string; description: string; note: string; projectId: string; phaseId: string | null; estimateHours: number; dueDate: string | null; priority: Priority; status: 'pending' | 'approved' | 'declined'; reviewedById: string | null; reviewedAt: string | null; reviewNote: string | null; itemId: string | null; createdAt: string; }
/** A developer's ask for more hours on their ticket. Approval adds the hours to the estimate and moves the date by them. */
export interface DueDateRequest { id: string; itemId: string; requesterId: string; fromDate: string | null; fromEstimate: number; hours: number; approvedHours: number | null; reasonCategory: 'scope_change' | 'blocked_dependency' | 'underestimated' | 'other'; reason: string; status: 'pending' | 'approved' | 'declined'; reviewedById: string | null; reviewedAt: string | null; reviewNote: string | null; createdAt: string; }
/** A team outside tech, such as Sales or Creative. People call it a team; the code calls it a department, so it never mixes with the tech team. */
export interface Department { id: string; name: string; position: number; isArchived: boolean; }
/** What kind of help a request asks for. It helps the admin decide between a ticket and a bug. */
export type RequestCategory = 'feature' | 'change' | 'problem' | 'data' | 'access' | 'other';
/**
 * Work another team asks the tech team for. `new` waits for an admin. `assigned` became a ticket or a bug,
 * and `work` follows that item, so a requester sees progress without seeing any tickets.
 */
export interface TechRequest {
  id: string; key: string; requesterId: string; requesterName: string; departmentId: string;
  title: string; description: string; category: RequestCategory; priority: Priority; neededBy: string | null;
  status: 'new' | 'assigned' | 'declined'; reviewedById: string | null; reviewedAt: string | null; reviewNote: string | null;
  itemId: string | null; work: RequestWork | null; createdAt: string; updatedAt: string;
}
/** The ticket or bug a request became, as its requester may see it. */
export interface RequestWork { key: string; type: WorkItem['type']; status: WorkItem['status']; assigneeId: string; assigneeName: string; dueDate: string | null; doneAt: string | null; }
export interface DashboardData { currentUser: Member; members: Member[]; projects: Project[]; phases: Phase[]; items: WorkItem[]; requests: TicketRequest[]; dueDateRequests: DueDateRequest[]; activities: Activity[]; leaves: Leave[]; holidays: Holiday[]; settings: Settings; mode: 'live' | 'demo'; departments: Department[]; techRequests: TechRequest[]; snapshots?: Array<{userId: string; weekStart: string; value: Record<string, unknown>}>; }
