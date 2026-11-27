/** Node-only local test utility. There is no HTTP route that creates sessions. This does not test Microsoft OAuth. */
import { randomUUID } from "node:crypto";
import { serializeSignedCookie } from "better-call";
import { and, eq, or } from "drizzle-orm";
import { db } from "@/db";
import { account, activities, memberProfiles, session, snapshots, user } from "@/db/schema";
import { auth } from "@/lib/auth";
import type { Member, Role } from "@/lib/types";
import { storedRole } from "./authz";

const LOCAL_HOSTS = ["localhost", "127.0.0.1", "[::1]", "::1"];
/**
 * Test people may only be made on a local server with a local database. .env.local holds the production database,
 * so a test run without an exported scratch DATABASE_URL would otherwise write test records to the live workspace.
 */
function assertLocal(baseURL: string): URL {
  const url = new URL(baseURL);
  if (process.env.VERCEL || !LOCAL_HOSTS.includes(url.hostname)) throw new Error("Offline session fixtures are limited to a local test server.");
  let databaseHost = "";
  try { databaseHost = new URL(process.env.DATABASE_URL ?? "").hostname; } catch { /* no usable address */ }
  if (!LOCAL_HOSTS.includes(databaseHost)) throw new Error("Offline session fixtures need a local test database. Export a scratch DATABASE_URL on localhost first; .env.local points at production.");
  return url;
}
export async function createOfflineSessionForUser(userId: string, baseURL: string) {
  const url = assertLocal(baseURL);
  const ctx = await auth.$context;
  const saved = await ctx.internalAdapter.createSession(userId);
  if (!saved) throw new Error("Could not create the temporary test session.");
  const spec = ctx.authCookies.sessionToken;
  const serialized = await serializeSignedCookie(spec.name, saved.token, ctx.secret, spec.attributes);
  const cookieHeader = serialized.split(";")[0];
  const value = cookieHeader.slice(cookieHeader.indexOf("=") + 1);
  return {
    cookieHeader,
    cookie: { name: spec.name, value, url: url.origin, httpOnly: true, secure: url.protocol === "https:", sameSite: "Lax" as const },
    dispose: async () => { await db.delete(session).where(eq(session.id, saved.id)); },
  };
}
export async function createOfflineSessionFixture({ baseURL, role, name }: { baseURL: string; role: Role; name?: string }) {
  assertLocal(baseURL);
  const id = randomUUID(); const objectId = randomUUID();
  const member: Member = { id, name: name ?? `Verification ${id.slice(0, 8)}`, email: `${id}@example.invalid`, role, image: null, capacity: role === "admin" ? 10 : 33, isActive: true, microsoftObjectId: objectId };
  await db.transaction(async (tx) => {
    await tx.insert(user).values({ id, name: member.name, email: member.email, role: storedRole(role), emailVerified: false });
    await tx.insert(memberProfiles).values({ userId: id, capacity: member.capacity });
    await tx.insert(account).values({ id: randomUUID(), providerId: "microsoft", accountId: objectId, userId: id });
  });
  try {
    const identity = await createOfflineSessionForUser(id, baseURL);
    return {
      ...identity, userId: id, member,
      dispose: () => disposeOfflineFixture(id, member.email),
    };
  } catch (error) {
    await db.delete(user).where(eq(user.id, id));
    throw error;
  }
}

/** Removes a temporary test person and what they left: sessions, scores, and history. Only the exact id and email match. */
export async function disposeOfflineFixture(id: string, email: string) {
  await db.transaction(async (tx) => {
    await tx.delete(activities).where(or(eq(activities.actorId, id), eq(activities.entityId, id)));
    await tx.delete(snapshots).where(eq(snapshots.userId, id));
    await tx.delete(user).where(and(eq(user.id, id), eq(user.email, email)));
  });
}

