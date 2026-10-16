import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { account } from "@/db/schema";
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
