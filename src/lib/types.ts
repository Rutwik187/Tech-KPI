export type Role = 'admin' | 'developer';
export type TaskStatus = 'todo' | 'in_progress' | 'blocked' | 'in_review' | 'done';
export type BugStatus = 'open' | 'in_progress' | 'fixed' | 'verified';
export type Priority = 'low' | 'medium' | 'high' | 'urgent';
export type Severity = 'normal' | 'critical';
export interface Member { id: string; name: string; email: string; role: Role; image: string | null; capacity: number; isActive: boolean; joinedOn?: string; microsoftObjectId?: string; }
export interface Project { id: string; name: string; color: string; description: string; isArchived: boolean; memberIds: string[]; isAdhoc: boolean; }
export interface Phase { id: string; projectId: string; name: string; position: number; }
export interface WorkItem { id: string; key: string; type: 'task' | 'bug'; title: string; description: string; projectId: string; phaseId: string | null; assigneeId: string; status: TaskStatus | BugStatus; priority: Priority; severity: Severity; estimateHours: number; dueDate: string | null; createdAt: string; updatedAt: string; startedAt: string | null; completedAt: string | null; fixedAt: string | null; reportedAt: string; blocker: string | null; taskId: string | null; reopenCount: number; }
export interface Activity { id: string; entityId: string; actorId: string; action: string; reason: string | null; payload: Record<string, unknown>; createdAt: string; }
export interface Leave { id: string; userId: string; date: string; type: 'full_day' | 'half_day'; note: string; }
export interface Holiday { id: string; date: string; name: string; }
export interface Settings { timezone: string; trackingStartDate: string; workingDays: number[]; workdayStart: string; workdayEnd: string; defaultDevCapacityHours: number; defaultLeadCapacityHours: number; deliveryWeight: number; bugWeight: number; leadTeamWeight: number; leadOwnWeight: number; criticalTargetHours: number; normalTargetHours: number; bandOnTarget: number; bandBelowTarget: number; }
export interface DashboardData { currentUser: Member; members: Member[]; projects: Project[]; phases: Phase[]; items: WorkItem[]; activities: Activity[]; leaves: Leave[]; holidays: Holiday[]; settings: Settings; mode: 'live' | 'demo'; snapshots?: Array<{userId: string; weekStart: string; value: Record<string, unknown>}>; }
