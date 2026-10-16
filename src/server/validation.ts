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
const phaseNames = z.array(phaseName).max(50).refine((names) => new Set(names.map((name) => name.toLowerCase())).size === names.length, "Phase names must be unique within a project.");
const itemFields = {
  title: shortText, description: description.optional(), projectId: uuid.optional(), phaseId: uuid.nullable().optional(), assigneeId: z.string().min(1),
  priority: priority.optional(), severity: severity.optional(), estimateHours: z.number().min(0).max(80).multipleOf(0.01).optional(),
  dueDate: date.nullable().optional(), taskId: uuid.nullable().optional(),
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
  }).partial().strict(), reason: z.string().trim().max(2000).optional(), reasonCategory: z.enum(["scope_change", "blocked_dependency", "underestimated", "other"]).optional() }).strict(),
  z.object({ action: z.literal("createMember"), name: shortText, email: z.email(), microsoftObjectId: uuid, role: role.optional(), capacity: capacity.optional() }).strict(),
  z.object({ action: z.literal("updateMember"), id: z.string().min(1), patch: z.object({ name: shortText.optional(), capacity: capacity.optional(), isActive: z.boolean().optional(), role: role.optional(), microsoftObjectId: uuid.optional() }).strict() }).strict(),
  z.object({ action: z.literal("createProject"), name: shortText, color: color.optional(), description: description.optional(), memberIds: memberIds.default([]), phaseNames: phaseNames.default([]) }).strict(),
  z.object({ action: z.literal("updateProject"), id: uuid, patch: z.object({ name: shortText.optional(), color: color.optional(), description: description.optional(), isArchived: z.boolean().optional(), memberIds: memberIds.optional() }).strict() }).strict(),
  z.object({ action: z.literal("createPhase"), projectId: uuid, name: phaseName }).strict(),
  z.object({ action: z.literal("updatePhase"), id: uuid, name: phaseName }).strict(),
  z.object({ action: z.literal("saveSettings"), settings: settingsSchema }).strict(),
  z.object({ action: z.literal("addLeave"), userId: z.string().min(1), date, type: z.enum(["full_day", "half_day"]), note: z.string().trim().max(2000).optional() }).strict(),
  z.object({ action: z.literal("addHoliday"), date, name: shortText }).strict(),
  z.object({ action: z.literal("deleteLeave"), id: uuid }).strict(),
  z.object({ action: z.literal("deleteHoliday"), id: uuid }).strict(),
]);
export type DataAction = z.infer<typeof actionSchema>;
