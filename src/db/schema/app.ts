import { sql } from "drizzle-orm";
import { boolean, check, date, foreignKey, index, integer, jsonb, numeric, pgEnum, pgTable, primaryKey, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import type { Settings } from "@/lib/types";
import { ADHOC_PROJECT_ID } from "@/lib/project-defaults";
import { user } from "./auth";

export const workItemType = pgEnum("tech_kpi_item_type", ["task", "bug"]);
export const workStatus = pgEnum("tech_kpi_work_status", ["todo", "in_progress", "blocked", "in_review", "done", "open", "fixed", "verified"]);
export const priority = pgEnum("tech_kpi_priority", ["low", "medium", "high", "urgent"]);
export const severity = pgEnum("tech_kpi_severity", ["normal", "critical"]);
const stamp = (name: string) => timestamp(name, { withTimezone: true });
const hours = (name: string) => numeric(name, { precision: 6, scale: 2, mode: "number" });
const adhocProjectId = sql.raw(`'${ADHOC_PROJECT_ID}'::uuid`);

export const projects = pgTable("tech_kpi_project", {
  id: uuid("id").defaultRandom().primaryKey(), name: text("name").notNull().unique(),
  color: text("color").notNull().default("#2563eb"), description: text("description").notNull().default(""),
  isAdhoc: boolean("is_adhoc").notNull().default(false),
  isArchived: boolean("is_archived").notNull().default(false), createdAt: stamp("created_at").defaultNow().notNull(),
  startDate: date("start_date", { mode: "string" }), targetDate: date("target_date", { mode: "string" }),
  originalTargetDate: date("original_target_date", { mode: "string" }),
}, (t) => [
  check("tech_kpi_project_adhoc_reserved", sql`(${t.id} = ${adhocProjectId} AND ${t.isAdhoc} = true AND ${t.name} = 'Ad hoc' AND ${t.isArchived} = false) OR (${t.id} <> ${adhocProjectId} AND ${t.isAdhoc} = false AND lower(${t.name}) <> 'ad hoc')`),
  check("tech_kpi_project_adhoc_no_timeline", sql`${t.id} <> ${adhocProjectId} OR (${t.startDate} IS NULL AND ${t.targetDate} IS NULL AND ${t.originalTargetDate} IS NULL)`),
  check("tech_kpi_project_timeline_order", sql`${t.startDate} IS NULL OR ${t.targetDate} IS NULL OR ${t.targetDate} >= ${t.startDate}`),
]);
export const projectMembers = pgTable("tech_kpi_project_member", {
  projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  // The primary developer leads the project. Every other member is a secondary developer.
  isPrimary: boolean("is_primary").notNull().default(false),
}, (t) => [primaryKey({ columns: [t.projectId, t.userId] }), index("tech_kpi_project_member_user_idx").on(t.userId), check("tech_kpi_project_member_not_adhoc", sql`${t.projectId} <> ${adhocProjectId}`),
  uniqueIndex("tech_kpi_project_member_one_primary").on(t.projectId).where(sql`${t.isPrimary}`)]);
export const projectPhases = pgTable("tech_kpi_project_phase", {
  id: uuid("id").defaultRandom().primaryKey(),
  projectId: uuid("project_id").notNull().references(() => projects.id),
  name: text("name").notNull(), description: text("description").notNull().default(""),
  position: integer("position").notNull().default(0),
}, (t) => [
  uniqueIndex("tech_kpi_project_phase_project_id_idx").on(t.projectId, t.id),
  uniqueIndex("tech_kpi_project_phase_name_idx").on(t.projectId, sql`lower(${t.name})`),
  index("tech_kpi_project_phase_position_idx").on(t.projectId, t.position),
  check("tech_kpi_project_phase_position_nonnegative", sql`${t.position} >= 0`),
  check("tech_kpi_project_phase_not_adhoc", sql`${t.projectId} <> ${adhocProjectId}`),
  check("tech_kpi_project_phase_name_not_adhoc", sql`length(btrim(${t.name})) > 0 AND lower(regexp_replace(btrim(${t.name}), '[[:space:]]+', ' ', 'g')) <> 'ad hoc'`),
]);
export const memberProfiles = pgTable("tech_kpi_member_profile", {
  userId: text("user_id").primaryKey().references(() => user.id, { onDelete: "cascade" }),
  capacity: hours("capacity").notNull().default(33), isActive: boolean("is_active").notNull().default(true),
  joinedOn: date("joined_on", { mode: "string" }).notNull().default(sql`(now() AT TIME ZONE 'Asia/Kolkata')::date`),
}, (t) => [check("tech_kpi_capacity_range", sql`${t.capacity} > 0 AND ${t.capacity} <= 168`)]);
export const workItems = pgTable("tech_kpi_work_item", {
  id: uuid("id").defaultRandom().primaryKey(), sequence: integer("sequence").generatedAlwaysAsIdentity().notNull().unique(),
  type: workItemType("type").notNull(), title: text("title").notNull(), description: text("description").notNull().default(""),
  projectId: uuid("project_id").notNull().references(() => projects.id),
  phaseId: uuid("phase_id"),
  assigneeId: text("assignee_id").notNull().references(() => user.id),
  createdById: text("created_by_id").notNull().references(() => user.id),
  status: workStatus("status").notNull(), priority: priority("priority").notNull().default("medium"), severity: severity("severity").notNull().default("normal"),
  estimateHours: hours("estimate_hours").notNull().default(0), originalEstimateHours: hours("original_estimate_hours").notNull().default(0),
  dueDate: date("due_date", { mode: "string" }), originalDueDate: date("original_due_date", { mode: "string" }),
  createdAt: stamp("created_at").defaultNow().notNull(), updatedAt: stamp("updated_at").defaultNow().notNull(),
  startedAt: stamp("started_at"), submittedAt: stamp("submitted_at"), completedAt: stamp("completed_at"),
  fixedAt: stamp("fixed_at"), reportedAt: stamp("reported_at").defaultNow().notNull(), verifiedAt: stamp("verified_at"),
  blocker: text("blocker"), taskId: uuid("task_id"), reopenCount: integer("reopen_count").notNull().default(0),
}, (t) => [
  index("tech_kpi_item_assignee_status_idx").on(t.assigneeId, t.status), index("tech_kpi_item_project_idx").on(t.projectId),
  index("tech_kpi_item_completed_idx").on(t.completedAt),
  index("tech_kpi_item_project_phase_idx").on(t.projectId, t.phaseId),
  foreignKey({ name: "tech_kpi_item_project_phase_fk", columns: [t.projectId, t.phaseId], foreignColumns: [projectPhases.projectId, projectPhases.id] }),
  check("tech_kpi_item_estimate_range", sql`(${t.type} = 'task' AND ${t.estimateHours} > 0 AND ${t.estimateHours} <= 80) OR (${t.type} = 'bug' AND ${t.estimateHours} = 0)`),
  check("tech_kpi_item_status_type", sql`(${t.type} = 'task' AND ${t.status} IN ('todo', 'in_progress', 'blocked', 'in_review', 'done')) OR (${t.type} = 'bug' AND ${t.status} IN ('open', 'in_progress', 'fixed', 'verified'))`),
]);
/** A developer's proposed ticket. It becomes a ticket only when an admin approves it, so its estimate cannot change a score before then. */
export const ticketRequests = pgTable("tech_kpi_ticket_request", {
  id: uuid("id").defaultRandom().primaryKey(),
  requesterId: text("requester_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  title: text("title").notNull(), description: text("description").notNull().default(""), note: text("note").notNull().default(""),
  projectId: uuid("project_id").notNull().references(() => projects.id), phaseId: uuid("phase_id"),
  estimateHours: hours("estimate_hours").notNull(), dueDate: date("due_date", { mode: "string" }),
  priority: priority("priority").notNull().default("medium"),
  status: text("status").$type<"pending" | "approved" | "declined">().notNull().default("pending"),
  reviewedById: text("reviewed_by_id").references(() => user.id, { onDelete: "set null" }), reviewedAt: stamp("reviewed_at"), reviewNote: text("review_note"),
  itemId: uuid("item_id").references(() => workItems.id, { onDelete: "set null" }),
  createdAt: stamp("created_at").defaultNow().notNull(),
}, (t) => [
  index("tech_kpi_ticket_request_status_idx").on(t.status, t.createdAt),
  index("tech_kpi_ticket_request_requester_idx").on(t.requesterId),
  foreignKey({ name: "tech_kpi_ticket_request_project_phase_fk", columns: [t.projectId, t.phaseId], foreignColumns: [projectPhases.projectId, projectPhases.id] }),
  check("tech_kpi_ticket_request_estimate_range", sql`${t.estimateHours} > 0 AND ${t.estimateHours} <= 80`),
  check("tech_kpi_ticket_request_status", sql`${t.status} IN ('pending', 'approved', 'declined')`),
  check("tech_kpi_ticket_request_reviewed", sql`(${t.status} = 'pending') = (${t.reviewedAt} IS NULL)`),
]);
/**
 * A developer's ask for more hours on their ticket. When an admin approves, the hours join the estimate
 * and the due date moves by those working hours. `fromDate` and `fromEstimate` record the ticket as it was asked.
 */
export const dueDateRequests = pgTable("tech_kpi_due_date_request", {
  id: uuid("id").defaultRandom().primaryKey(),
  itemId: uuid("item_id").notNull().references(() => workItems.id, { onDelete: "cascade" }),
  requesterId: text("requester_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  fromDate: date("from_date", { mode: "string" }).notNull(), fromEstimate: hours("from_estimate").notNull(),
  hours: hours("hours").notNull(), approvedHours: hours("approved_hours"),
  reasonCategory: text("reason_category").$type<"scope_change" | "blocked_dependency" | "underestimated" | "other">().notNull(),
  reason: text("reason").notNull(),
  status: text("status").$type<"pending" | "approved" | "declined">().notNull().default("pending"),
  reviewedById: text("reviewed_by_id").references(() => user.id, { onDelete: "set null" }), reviewedAt: stamp("reviewed_at"), reviewNote: text("review_note"),
  createdAt: stamp("created_at").defaultNow().notNull(),
}, (t) => [
  index("tech_kpi_due_date_request_status_idx").on(t.status, t.createdAt),
  uniqueIndex("tech_kpi_due_date_request_one_pending").on(t.itemId).where(sql`${t.status} = 'pending'`),
  check("tech_kpi_due_date_request_hours", sql`${t.hours} > 0 AND ${t.hours} <= 80 AND (${t.approvedHours} IS NULL OR (${t.approvedHours} > 0 AND ${t.approvedHours} <= 80))`),
  check("tech_kpi_due_date_request_category", sql`${t.reasonCategory} IN ('scope_change', 'blocked_dependency', 'underestimated', 'other')`),
  check("tech_kpi_due_date_request_status", sql`${t.status} IN ('pending', 'approved', 'declined')`),
  check("tech_kpi_due_date_request_reviewed", sql`(${t.status} = 'pending') = (${t.reviewedAt} IS NULL)`),
]);
export const activities = pgTable("tech_kpi_activity", {
  id: uuid("id").defaultRandom().primaryKey(), entityId: text("entity_id").notNull(),
  actorId: text("actor_id").notNull().references(() => user.id), action: text("action").notNull(), reason: text("reason"),
  payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}), createdAt: stamp("created_at").defaultNow().notNull(),
}, (t) => [index("tech_kpi_activity_entity_idx").on(t.entityId, t.createdAt)]);
export const leaves = pgTable("tech_kpi_leave", {
  id: uuid("id").defaultRandom().primaryKey(), userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  date: date("date", { mode: "string" }).notNull(), type: text("type").$type<"full_day" | "half_day">().notNull(), note: text("note").notNull().default(""),
}, (t) => [uniqueIndex("tech_kpi_leave_user_date_idx").on(t.userId, t.date), check("tech_kpi_leave_type", sql`${t.type} IN ('full_day','half_day')`)]);
export const holidays = pgTable("tech_kpi_holiday", {
  id: uuid("id").defaultRandom().primaryKey(), date: date("date", { mode: "string" }).notNull().unique(), name: text("name").notNull(),
});
export const settings = pgTable("tech_kpi_settings", {
  id: integer("id").primaryKey().default(1), value: jsonb("value").$type<Settings>().notNull(),
  updatedAt: stamp("updated_at").defaultNow().notNull(),
}, (t) => [check("tech_kpi_settings_singleton", sql`${t.id} = 1`)]);
export const snapshots = pgTable("tech_kpi_weekly_snapshot", {
  userId: text("user_id").notNull().references(() => user.id), weekStart: date("week_start", { mode: "string" }).notNull(),
  value: jsonb("value").$type<Record<string, unknown>>().notNull(), computedAt: stamp("computed_at").defaultNow().notNull(),
}, (t) => [primaryKey({ columns: [t.userId, t.weekStart] })]);
export const attachments = pgTable("tech_kpi_attachment", {
  id: uuid("id").defaultRandom().primaryKey(), itemId: uuid("item_id").notNull().references(() => workItems.id, { onDelete: "cascade" }),
  uploadedById: text("uploaded_by_id").notNull().references(() => user.id), name: text("name").notNull(),
  mimeType: text("mime_type").notNull(), size: integer("size").notNull(), objectKey: text("object_key").notNull(),
  createdAt: stamp("created_at").defaultNow().notNull(),
}, (t) => [index("tech_kpi_attachment_item_idx").on(t.itemId)]);
