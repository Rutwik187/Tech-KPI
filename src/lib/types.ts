/**
 * Who someone is in the workspace. An admin can do everything. The tech lead runs the tech team. A project manager reviews
 * requests from other teams and forwards them to the tech lead. A requester belongs to a team outside tech, such as Sales:
 * they raise requests and follow them, and see nothing else. What each role may do is in `src/lib/permissions.ts`.
 */
export type Role = 'admin' | 'tech_lead' | 'project_manager' | 'developer' | 'requester';
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
/** Leave proposed by a developer. Only approval records these dates as leave. */
export interface LeaveRequest { id: string; requesterId: string; dates: string[]; type: Leave['type']; note: string; status: 'pending' | 'approved' | 'declined'; reviewedById: string | null; reviewedAt: string | null; reviewNote: string | null; createdAt: string; }
/** A day off for the whole team. A half-day holiday takes half the day's hours. */
export interface Holiday { id: string; date: string; name: string; type: 'full_day' | 'half_day'; }
/** `requestDomains`: people with a work email on these domains may sign in to raise requests. Empty, the default, means only the people the tech lead adds to a team. */
export interface Settings { requestDomains: string[]; timezone: string; trackingStartDate: string; workingDays: number[]; workdayStart: string; workdayEnd: string; defaultDevCapacityHours: number; defaultLeadCapacityHours: number; deliveryWeight: number; bugWeight: number; leadTeamWeight: number; leadOwnWeight: number; criticalTargetHours: number; normalTargetHours: number; bandOnTarget: number; bandBelowTarget: number; }
/** A ticket a developer asked for. The tech lead approves it into a ticket or declines it with a reason. */
export interface TicketRequest { id: string; requesterId: string; title: string; description: string; note: string; projectId: string; phaseId: string | null; estimateHours: number; dueDate: string | null; priority: Priority; status: 'pending' | 'approved' | 'declined'; reviewedById: string | null; reviewedAt: string | null; reviewNote: string | null; itemId: string | null; createdAt: string; }
/** A developer's ask for more hours on their ticket. Approval adds the hours to the estimate and moves the date by them. */
export interface DueDateRequest { id: string; itemId: string; requesterId: string; fromDate: string | null; fromEstimate: number; hours: number; approvedHours: number | null; reasonCategory: 'scope_change' | 'blocked_dependency' | 'underestimated' | 'other'; reason: string; status: 'pending' | 'approved' | 'declined'; reviewedById: string | null; reviewedAt: string | null; reviewNote: string | null; createdAt: string; }
/** A team outside tech, such as Sales or Creative. People call it a team; the code calls it a department, so it never mixes with the tech team. */
export interface Department { id: string; name: string; position: number; isArchived: boolean; }
/** What kind of help a request asks for. It helps the tech lead decide between a ticket and a bug. */
export type RequestCategory = 'feature' | 'tool' | 'change' | 'problem' | 'data' | 'access' | 'other';
/**
 * Where a request is in its flow. `new` waits for a project manager. `forwarded` waits for the tech lead.
 * `assigned` became a ticket or a bug. `declined` was closed with a reason the requester reads.
 */
export type TechRequestStatus = 'new' | 'forwarded' | 'assigned' | 'declined';
/** A message on a request. An internal one is for the tech side only: project managers, the tech lead, and developers. */
export interface RequestComment { id: string; requestId: string; authorId: string; authorName: string; authorRole: Role; body: string; internal: boolean; createdAt: string; }
/** One step in a request's history, such as raised, forwarded, or assigned. A requester gets only the steps meant for them. */
export interface RequestEvent { id: string; action: string; actorId: string; actorName: string; note: string | null; payload: Record<string, unknown>; createdAt: string; }
/**
 * Work another team asks the tech team for. A project manager forwards it, then the tech lead assigns it, which makes a ticket or a bug.
 * After that, `work` follows that item, so a requester sees progress without seeing any tickets.
 */
export interface TechRequest {
  id: string; key: string; requesterId: string; requesterName: string; departmentId: string;
  title: string; description: string; category: RequestCategory; tool: string; priority: Priority; neededBy: string | null;
  status: TechRequestStatus; forwardedById: string | null; forwardedAt: string | null;
  reviewedById: string | null; reviewedAt: string | null; reviewNote: string | null;
  itemId: string | null; work: RequestWork | null; createdAt: string; updatedAt: string;
  comments: RequestComment[]; history: RequestEvent[]; attachmentCount: number;
}
/** A file on a ticket, a bug, or a request, as the attachments endpoint returns it. Links expire after a few minutes. */
export interface Attachment { id: string; name: string; size: number; mimeType: string; createdAt: string; uploadedById: string; uploadedByName: string; canDelete: boolean; url: string; viewUrl: string | null; }
/** The ticket or bug a request became, as its requester may see it. */
export interface RequestWork { key: string; type: WorkItem['type']; status: WorkItem['status']; assigneeId: string; assigneeName: string; dueDate: string | null; doneAt: string | null; }
export interface DashboardData { currentUser: Member; members: Member[]; projects: Project[]; phases: Phase[]; items: WorkItem[]; requests: TicketRequest[]; dueDateRequests: DueDateRequest[]; activities: Activity[]; leaves: Leave[]; leaveRequests: LeaveRequest[]; holidays: Holiday[]; settings: Settings; mode: 'live' | 'demo'; departments: Department[]; techRequests: TechRequest[]; snapshots?: Array<{userId: string; weekStart: string; value: Record<string, unknown>}>; }
