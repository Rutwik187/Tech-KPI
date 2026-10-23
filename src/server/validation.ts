import { z } from "zod";

const shortText = z.string().trim().min(1, "Enter a name or title.").max(200);
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a valid calendar date.").refine((value) => {
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}, "Use a valid calendar date.");
const uuid = z.uuid();
const priority = z.enum(["low", "medium", "high", "urgent"]);
const severity = z.enum(["normal", "critical"]);
const role = z.enum(["admin", "developer"]);
const capacity = z.number().min(0.01).max(168).multipleOf(0.01);
const color = z.string().regex(/^#[a-fA-F0-9]{6}$/, "Use a six digit color code.");
const description = z.string().trim().max(20_000);
const memberIds = z.array(z.string().min(1).max(200)).max(250).refine((ids) => new Set(ids).size === ids.length, "Project members must be unique.");
const phaseName = z.string().trim().min(1, "Enter a phase name.").max(100)
  .refine((name) => name.replace(/\s+/g, " ").toLowerCase() !== "ad hoc", "Ad hoc is the built-in option for work without a phase.");
const phaseDescription = z.string().trim().max(2000);
const phases = z.array(z.object({ name: phaseName, description: phaseDescription.optional() }).strict()).max(50)
  .refine((list) => new Set(list.map((phase) => phase.name.toLowerCase())).size === list.length, "Phase names must be unique within a project.");
const extensionReason = z.enum(["scope_change", "blocked_dependency", "underestimated", "other"]);
const reason = z.string().trim().max(2000);
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
export const actionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("createItem"), type: z.enum(["task", "bug"]), ...itemFields }).strict(),
  z.object({ action: z.literal("updateItem"), id: uuid, patch: z.object({ ...itemFields,
    status: z.enum(["todo", "in_progress", "blocked", "in_review", "done", "open", "fixed", "verified"]).optional(),
    blocker: z.string().trim().max(2000).nullable().optional(),
  }).partial().strict(), reason: reason.optional(), reasonCategory: extensionReason.optional() }).strict(),
  z.object({ action: z.literal("createMember"), name: shortText, email: z.email(), microsoftObjectId: uuid.optional(), role: role.optional(), capacity: capacity.optional() }).strict(),
  z.object({ action: z.literal("updateMember"), id: z.string().min(1), patch: z.object({ name: shortText.optional(), email: z.email().optional(), capacity: capacity.optional(), isActive: z.boolean().optional(), role: role.optional(), microsoftObjectId: uuid.optional() }).strict() }).strict(),
  z.object({ action: z.literal("createProject"), name: shortText, color: color.optional(), description: description.optional(), memberIds: memberIds.default([]), primaryMemberId: z.string().min(1).max(200).nullable().optional(), phases: phases.default([]), startDate: date.nullable().optional(), targetDate: date.nullable().optional() }).strict()
    .refine(timelineOrder, timelineOrderMessage),
  z.object({ action: z.literal("updateProject"), id: uuid, patch: z.object({ name: shortText.optional(), color: color.optional(), description: description.optional(), isArchived: z.boolean().optional(), memberIds: memberIds.optional(), primaryMemberId: z.string().min(1).max(200).nullable().optional(), startDate: date.nullable().optional(), targetDate: date.optional() }).strict().refine(timelineOrder, timelineOrderMessage), reason: reason.optional(), reasonCategory: extensionReason.optional() }).strict(),
  z.object({ action: z.literal("createPhase"), projectId: uuid, name: phaseName, description: phaseDescription.optional() }).strict(),
  z.object({ action: z.literal("updatePhase"), id: uuid, name: phaseName.optional(), description: phaseDescription.optional() }).strict(),
  z.object({ action: z.literal("saveSettings"), settings: settingsSchema }).strict(),
  z.object({ action: z.literal("addLeave"), userId: z.string().min(1), date, endDate: date.optional(), type: z.enum(["full_day", "half_day"]), note: z.string().trim().max(2000).optional() }).strict()
    .refine((leave) => !leave.endDate || leave.endDate >= leave.date, "The last day of leave must be on or after the first day.")
    .refine((leave) => !leave.endDate || leave.endDate === leave.date || leave.type === "full_day", "A half day covers one date only."),
  z.object({ action: z.literal("addHoliday"), date, name: shortText }).strict(),
  z.object({ action: z.literal("deleteLeave"), ids: z.array(uuid).min(1).max(62) }).strict(),
  z.object({ action: z.literal("deleteHoliday"), id: uuid }).strict(),
  // A developer asks for a ticket. It becomes one only after an admin approves it.
  z.object({ action: z.literal("requestTicket"), ...requestFields, description: description.optional(), note: description.optional() }).strict(),
  z.object({ action: z.literal("approveTicketRequest"), id: uuid, patch: z.object(requestFields).partial().strict().optional(), note: reason.optional() }).strict(),
  z.object({ action: z.literal("declineTicketRequest"), id: uuid, reason: z.string().trim().min(3, "Say why you are declining, so the developer can adjust.").max(2000) }).strict(),
  z.object({ action: z.literal("withdrawTicketRequest"), id: uuid }).strict(),
]);
export type DataAction = z.infer<typeof actionSchema>;
