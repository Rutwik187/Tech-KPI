import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { account, activities, memberProfiles, user } from "@/db/schema";
import { AppError } from "./errors";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
/** Explicit admin provisioning only. Microsoft verifies this OID before it can be used to sign in. */
export async function linkMicrosoftAccount(tx: Tx, userId: string, rawObjectId: string): Promise<boolean> {
  const objectId = z.uuid().parse(rawObjectId).toLowerCase();
  await tx.execute(sql`SELECT pg_advisory_xact_lock(7201203)`);
  const [owner] = await tx.select().from(account).where(and(eq(account.providerId, "microsoft"), eq(account.accountId, objectId))).for("update");
  if (owner && owner.userId !== userId) throw new AppError("This Microsoft account is already linked to another team member.", 409);
  const linked = await tx.select().from(account).where(and(eq(account.providerId, "microsoft"), eq(account.userId, userId)));
  if (linked.some((entry) => entry.accountId !== objectId)) throw new AppError("This member already has a Microsoft account. Account replacement requires a deliberate database recovery.", 409);
  if (owner) return false;
  await tx.insert(account).values({ id: randomUUID(), userId, providerId: "microsoft", accountId: objectId });
  return true;
}

/**
 * First sign-in of a member an admin added by email. The claims come from the code exchange with this tenant's token endpoint.
 * The sign-in name (UPN) is set by the tenant's administrators, and guest names carry #EXT#, so they cannot match a work email.
 * The link is made once. Later sign-ins match the Object ID only, so a renamed account cannot take over another member.
 */
export async function claimMicrosoftInvitation(claims: { oid?: unknown; tid?: unknown; preferred_username?: unknown }, tenantId: string): Promise<{ email: string; name: string } | null> {
  const objectId = z.uuid().safeParse(claims.oid);
  const signInName = z.email().safeParse(typeof claims.preferred_username === "string" ? claims.preferred_username.trim().toLowerCase() : "");
  if (!objectId.success || !signInName.success || typeof claims.tid !== "string" || claims.tid.toLowerCase() !== tenantId.toLowerCase()) return null;
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(7201203)`);
    const [invited] = await tx.select({ id: user.id, email: user.email, name: user.name }).from(user)
      .innerJoin(memberProfiles, eq(memberProfiles.userId, user.id))
      .where(and(eq(user.email, signInName.data), sql`${user.banned} IS NOT TRUE`, eq(memberProfiles.isActive, true))).for("update");
    if (!invited) return null;
    const [existing] = await tx.select({ id: account.id }).from(account).where(and(eq(account.userId, invited.id), eq(account.providerId, "microsoft")));
    if (existing) return null;
    await linkMicrosoftAccount(tx, invited.id, objectId.data);
    await tx.insert(activities).values({ entityId: invited.id, actorId: invited.id, action: "member.microsoft_linked", payload: { microsoftObjectId: objectId.data.toLowerCase(), via: "work_email" } });
    return { email: invited.email, name: invited.name };
  });
}
