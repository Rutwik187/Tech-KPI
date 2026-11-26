import { z } from "zod";

const shortText = z.string().trim().min(1, "Enter a name or title.").max(200);
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a valid calendar date.").refine((value) => {
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}, "Use a valid calendar date.");
const uuid = z.uuid();
const priority = z.enum(["low", "medium", "high", "urgent"]);
const severity = z.enum(["normal", "critical"]);
const role = z.enum(["admin", "tech_lead", "project_manager", "developer", "requester"]);
const capacity = z.number().min(0.01).max(168).multipleOf(0.01);
const color = z.string().regex(/^#[a-fA-F0-9]{6}$/, "Use a six digit color code.");
const description = z.string().trim().max(20_000);
const memberIds = z.array(z.string().min(1).max(200)).max(250).refine((ids) => new Set(ids).size === ids.length, "Project members must be unique.");
const developerIds = z.array(z.string().min(1).max(200)).min(1, "Choose at least one developer.").max(250).refine((ids) => new Set(ids).size === ids.length, "Choose each developer once.");
const dayLength = z.enum(["full_day", "half_day"]);
const phaseName = z.string().trim().min(1, "Enter a phase name.").max(100)
  .refine((name) => name.replace(/\s+/g, " ").toLowerCase() !== "ad hoc", "Ad hoc is the built-in option for work without a phase.");
const phaseDescription = z.string().trim().max(2000);
const phases = z.array(z.object({ name: phaseName, description: phaseDescription.optional() }).strict()).max(50)
  .refine((list) => new Set(list.map((phase) => phase.name.toLowerCase())).size === list.length, "Phase names must be unique within a project.");
const extensionReason = z.enum(["scope_change", "blocked_dependency", "underestimated", "other"]);
const extraHours = z.number().min(0.5, "Ask for at least half an hour.").max(80).multipleOf(0.5, "Use steps of half an hour.");
const reason = z.string().trim().max(2000);
const domain = z.string().trim().toLowerCase().max(253)
  .regex(/^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$/, "Enter a domain such as urbangabru.in, without the @.");
const departmentName = z.string().trim().min(1, "Enter a team name.").max(60);
const requestCategory = z.enum(["feature", "tool", "change", "problem", "data", "access", "other"]);
/** What a requester fills in. Details are required, so the tech team can act without a meeting. */
const techRequestFields = {
  title: shortText, description: z.string().trim().min(10, "Describe what you need in a sentence or two.").max(20_000),
  category: requestCategory, priority, neededBy: date.nullable(), departmentId: uuid,
  tool: z.string().trim().max(120, "Keep the tool name under 120 characters.").optional(),
};
const commentBody = z.string().trim().min(1, "Write a comment first.").max(5000, "Keep a comment under 5,000 characters.");
const timelineOrder = (value: { startDate?: string | null; targetDate?: string | null }) => !value.startDate || !value.targetDate || value.targetDate >= value.startDate;
const timelineOrderMessage = "The target date must be on or after the start date.";
const itemFields = {
  title: shortText, description: description.optional(), projectId: uuid.optional(), phaseId: uuid.nullable().optional(), assigneeId: z.string().min(1),
  priority: priority.optional(), severity: severity.optional(), estimateHours: z.number().min(0).max(80).multipleOf(0.01).optional(),
  dueDate: date.nullable().optional(), taskId: uuid.nullable().optional(),
};
const requestFields = {
  title: shortText, projectId: uuid.optional(), phaseId: uuid.nullable().optional(), priority: priority.optional(),
  estimateHours: z.number().gt(0, "Estimate the hours this work needs.").max(80).multipleOf(0.01), dueDate: date.nullable().optional(),
};
export const settingsSchema = z.object({
  requestDomains: z.array(domain).max(20).refine((list) => new Set(list).size === list.length, "Enter each domain once."),
  timezone: z.literal("Asia/Kolkata"), trackingStartDate: date,
  workingDays: z.array(z.number().int().min(1).max(7)).min(1).max(7).refine((days) => new Set(days).size === days.length, "Working days must be unique."),
  workdayStart: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/), workdayEnd: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  defaultDevCapacityHours: capacity, defaultLeadCapacityHours: capacity,
  deliveryWeight: z.number().int().min(0).max(100), bugWeight: z.number().int().min(0).max(100),
  leadTeamWeight: z.number().int().min(0).max(100), leadOwnWeight: z.number().int().min(0).max(100),
  criticalTargetHours: z.number().positive().max(168), normalTargetHours: z.number().positive().max(336),
  bandOnTarget: z.number().min(0).max(100), bandBelowTarget: z.number().min(0).max(100),
}).strict().superRefine((value, ctx) => {
  if (value.deliveryWeight + value.bugWeight !== 100 || value.leadTeamWeight + value.leadOwnWeight !== 100) ctx.addIssue({ code: "custom", message: "Each pair of score weights must add to 100%." });
  if (value.workdayEnd <= value.workdayStart) ctx.addIssue({ code: "custom", message: "Office end time must be after start time." });
  if (value.bandOnTarget <= value.bandBelowTarget) ctx.addIssue({ code: "custom", message: "On target must be above the lower score band." });
});
/**
 * The days of a leave request: each day picked on the calendar (`dates`), or a first and last day (`date` and `endDate`).
 * Older pages send the range, so the server accepts both.
 */
const leaveDays = {
  dates: z.array(date).min(1, "Pick at least one day.").max(62, "Pick up to 62 days at a time.").optional(),
  date: date.optional(), endDate: date.optional(),
  type: dayLength, note: z.string().trim().max(2000).optional(),
};
function leaveRules(leave: { dates?: string[]; date?: string; endDate?: string; type: string }, context: z.RefinementCtx) {
  const fail = (message: string) => context.addIssue({ code: "custom", message });
  if (leave.dates) {
    if (leave.date || leave.endDate) fail("Send the picked days or a range, not both.");
    if (new Set(leave.dates).size !== leave.dates.length) fail("Pick each day once.");
    if (leave.dates.length > 1 && leave.type !== "full_day") fail("A half day covers one date only.");
    return;
  }
  if (!leave.date) return fail("Pick at least one day.");
  if (leave.endDate && leave.endDate < leave.date) fail("The last day must be on or after the first day.");
  if (leave.endDate && leave.endDate !== leave.date && leave.type !== "full_day") fail("A half day covers one date only.");
}

export const actionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("createItem"), type: z.enum(["task", "bug"]), ...itemFields }).strict(),
  // The same ticket for several developers. With doneOn, it records an event they already attended as finished work.
  z.object({ action: z.literal("createTickets"), assigneeIds: developerIds, title: shortText, description: description.optional(), projectId: uuid.optional(), phaseId: uuid.nullable().optional(),
    priority: priority.optional(), estimateHours: z.number().gt(0, "Estimate the hours this work needs.").max(80).multipleOf(0.01), dueDate: date.nullable().optional(), doneOn: date.optional() }).strict()
    .refine((tickets) => !tickets.doneOn || !tickets.dueDate, "Work that is already done has no date."),
  z.object({ action: z.literal("updateItem"), id: uuid, patch: z.object({ ...itemFields,
    status: z.enum(["todo", "in_progress", "blocked", "in_review", "done", "open", "fixed", "verified"]).optional(),
    blocker: z.string().trim().max(2000).nullable().optional(),
  }).partial().strict(), reason: reason.optional(), reasonCategory: extensionReason.optional() }).strict(),
  z.object({ action: z.literal("createMember"), name: shortText, email: z.email(), microsoftObjectId: uuid.optional(), role: role.optional(), capacity: capacity.optional(), departmentId: uuid.nullable().optional(), isTeamLead: z.boolean().optional() }).strict()
    .refine((member) => member.role !== "requester" || !!member.departmentId, "Choose a team for this person.")
    .refine((member) => !member.isTeamLead || member.role === "requester", "Only someone in a team outside tech can lead it."),
  // Removes a person: deleted when they never signed in and left no trace, otherwise their access is turned off and their history stays.
  z.object({ action: z.literal("removeMember"), id: z.string().min(1).max(200) }).strict(),
  z.object({ action: z.literal("updateMember"), id: z.string().min(1), patch: z.object({ name: shortText.optional(), email: z.email().optional(), capacity: capacity.optional(), isActive: z.boolean().optional(), role: role.optional(), microsoftObjectId: uuid.optional(), departmentId: uuid.nullable().optional(), isTeamLead: z.boolean().optional() }).strict() }).strict(),
  z.object({ action: z.literal("createProject"), name: shortText, color: color.optional(), description: description.optional(), memberIds: memberIds.default([]), primaryMemberId: z.string().min(1).max(200).nullable().optional(), phases: phases.default([]), startDate: date.nullable().optional(), targetDate: date.nullable().optional() }).strict()
    .refine(timelineOrder, timelineOrderMessage),
  z.object({ action: z.literal("updateProject"), id: uuid, patch: z.object({ name: shortText.optional(), color: color.optional(), description: description.optional(), isArchived: z.boolean().optional(), memberIds: memberIds.optional(), primaryMemberId: z.string().min(1).max(200).nullable().optional(), startDate: date.nullable().optional(), targetDate: date.optional() }).strict().refine(timelineOrder, timelineOrderMessage), reason: reason.optional(), reasonCategory: extensionReason.optional() }).strict(),
  z.object({ action: z.literal("createPhase"), projectId: uuid, name: phaseName, description: phaseDescription.optional() }).strict(),
  z.object({ action: z.literal("updatePhase"), id: uuid, name: phaseName.optional(), description: phaseDescription.optional() }).strict(),
  z.object({ action: z.literal("saveSettings"), settings: settingsSchema }).strict(),
  z.object({ action: z.literal("requestLeave"), ...leaveDays }).strict().superRefine(leaveRules),
  z.object({ action: z.literal("approveLeaveRequest"), id: uuid }).strict(),
  z.object({ action: z.literal("declineLeaveRequest"), id: uuid, reason: reason.min(1, "Enter a reason.") }).strict(),
  z.object({ action: z.literal("withdrawLeaveRequest"), id: uuid }).strict(),
  z.object({ action: z.literal("addLeave"), userIds: developerIds, ...leaveDays }).strict().superRefine(leaveRules),
  z.object({ action: z.literal("addHoliday"), date, name: shortText, type: dayLength.default("full_day") }).strict(),
  z.object({ action: z.literal("deleteLeave"), ids: z.array(uuid).min(1).max(62) }).strict(),
  z.object({ action: z.literal("deleteHoliday"), id: uuid }).strict(),
  // A developer asks for a ticket. It becomes one only after the tech lead approves it.
  z.object({ action: z.literal("requestTicket"), ...requestFields, description: description.optional(), note: description.optional() }).strict(),
  z.object({ action: z.literal("approveTicketRequest"), id: uuid, patch: z.object(requestFields).partial().strict().optional(), note: reason.optional() }).strict(),
  z.object({ action: z.literal("declineTicketRequest"), id: uuid, reason: z.string().trim().min(3, "Say why you are declining, so the developer can adjust.").max(2000) }).strict(),
  z.object({ action: z.literal("withdrawTicketRequest"), id: uuid }).strict(),
  // A ticket needs more hours. The tech lead's extension applies at once. A developer's waits for the tech lead to approve it.
  z.object({ action: z.literal("extendTicket"), itemId: uuid, hours: extraHours, reasonCategory: extensionReason, reason: z.string().trim().min(3, "Say why the ticket needs more time.").max(2000) }).strict(),
  z.object({ action: z.literal("approveDueDateRequest"), id: uuid, hours: extraHours.optional(), note: reason.optional() }).strict(),
  z.object({ action: z.literal("declineDueDateRequest"), id: uuid, reason: z.string().trim().min(3, "Say why you are declining, so the developer can adjust.").max(2000) }).strict(),
  z.object({ action: z.literal("withdrawDueDateRequest"), id: uuid }).strict(),
  // Another team asks for tech work. Only requesters raise, change, and withdraw these.
  // The page may choose the new request's id, so it can attach files to it right after.
  // A request always goes to the requester's own team. Older pages still send the team, and it must be theirs.
  z.object({ action: z.literal("createTechRequest"), id: uuid.optional(), ...techRequestFields, departmentId: uuid.optional() }).strict(),
  z.object({ action: z.literal("updateTechRequest"), id: uuid, patch: z.object(techRequestFields).partial().strict() }).strict(),
  z.object({ action: z.literal("withdrawTechRequest"), id: uuid }).strict(),
  // A project manager or the tech lead corrects a request before it is assigned, forwards it, or returns it.
  z.object({ action: z.literal("editTechRequest"), id: uuid, patch: z.object(techRequestFields).partial().strict() }).strict(),
  z.object({ action: z.literal("forwardTechRequest"), id: uuid, priority: priority.optional(), note: z.string().trim().max(5000).optional() }).strict(),
  z.object({ action: z.literal("returnTechRequest"), id: uuid, reason: z.string().trim().min(3, "Say what the project manager should check.").max(5000) }).strict(),
  // Anyone who can see a request can comment on it. Only the tech side can mark a comment internal.
  z.object({ action: z.literal("addRequestComment"), requestId: uuid, body: commentBody, internal: z.boolean().optional() }).strict(),
  z.object({ action: z.literal("deleteRequestComment"), id: uuid }).strict(),
  // Assigning makes a ticket, which needs an estimate, or a bug, which runs on its fix-by time instead.
  z.object({ action: z.literal("assignTechRequest"), id: uuid, type: z.enum(["task", "bug"]), assigneeId: z.string().min(1), title: shortText,
    projectId: uuid.optional(), phaseId: uuid.nullable().optional(), priority: priority.optional(), severity: severity.optional(),
    estimateHours: z.number().gt(0, "Estimate the hours this work needs.").max(80).multipleOf(0.01).optional(), dueDate: date.nullable().optional(), note: reason.optional() }).strict()
    .refine((assign) => assign.type === "bug" || assign.estimateHours !== undefined, "Estimate the hours this work needs.")
    .refine((assign) => assign.type === "task" || (assign.estimateHours === undefined && !assign.dueDate), "A bug has a fix-by time instead of an estimate or a date."),
  z.object({ action: z.literal("declineTechRequest"), id: uuid, reason: z.string().trim().min(3, "Say why you are declining, so the team knows what to do next.").max(2000) }).strict(),
  z.object({ action: z.literal("createDepartment"), name: departmentName }).strict(),
  z.object({ action: z.literal("updateDepartment"), id: uuid, name: departmentName.optional(), isArchived: z.boolean().optional() }).strict(),
]);
export type DataAction = z.infer<typeof actionSchema>;
