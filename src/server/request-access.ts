import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { techRequests, workItems } from "@/db/schema";
import type { Member } from "@/lib/types";
import { can } from "@/lib/permissions";
import { AppError } from "./errors";

type Executor = Pick<typeof db, "select">;
type RequestRow = typeof techRequests.$inferSelect;

/**
 * Who may see a request, its comments, and its files. Admins, the tech lead, and project managers see every request.
 * A requester sees their own and their team's. A developer sees the request behind their own ticket or bug.
 */
export async function canSeeRequest(executor: Executor, actor: Member, request: Pick<RequestRow, "requesterId" | "departmentId" | "itemId">): Promise<boolean> {
  if (can(actor, "requests.review")) return true;
  if (actor.role === "requester") return request.requesterId === actor.id || (!!actor.departmentId && request.departmentId === actor.departmentId);
  if (!request.itemId) return false;
  const [item] = await executor.select({ id: workItems.id }).from(workItems)
    .where(and(eq(workItems.id, request.itemId), eq(workItems.assigneeId, actor.id)));
  return !!item;
}

/** The request, when this person may see it. Otherwise "not found", so a request id reveals nothing. */
export async function visibleRequest(executor: Executor, actor: Member, id: string): Promise<RequestRow> {
  const [request] = await executor.select().from(techRequests).where(eq(techRequests.id, id));
  if (!request || !(await canSeeRequest(executor, actor, request))) throw new AppError("This request was not found.", 404);
  return request;
}
