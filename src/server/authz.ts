import { and, eq } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db } from "@/db";
import { account, memberProfiles, user } from "@/db/schema";
import type { Member } from "@/lib/types";
import { AppError } from "./errors";

export async function requireSession(headers: Headers): Promise<Member> {
  const result = await auth.api.getSession({ headers, query: { disableCookieCache: true } });
  if (!result) throw new AppError("Please sign in to continue.", 401);
  // Read role and active state on each request, so a disabled account loses access immediately.
  const [identity] = await db.select({ user, profile: memberProfiles }).from(user)
    .innerJoin(account, and(eq(account.userId, user.id), eq(account.providerId, "microsoft")))
    .leftJoin(memberProfiles, eq(memberProfiles.userId, user.id)).where(eq(user.id, result.user.id));
  if (!identity) throw new AppError("Sign in with your linked Microsoft account.", 401);
  if (identity.user.banned || identity.profile?.isActive === false) throw new AppError("This account is inactive. Contact your team lead.", 403);
  return {
    id: identity.user.id, name: identity.user.name, email: identity.user.email,
    role: identity.user.role === "admin" ? "admin" : "developer", image: identity.user.image,
    capacity: identity.profile?.capacity ?? (identity.user.role === "admin" ? 10 : 33), isActive: true,
    joinedOn: identity.profile?.joinedOn,
  };
}
export function requireAdmin(member: Member): void {
  if (member.role !== "admin") throw new AppError("Only the team lead can make this change.", 403);
}
export function assertSameOrigin(request: Request): void {
  const origin = request.headers.get("origin");
  const requestUrl = new URL(request.url);
  const host = request.headers.get("host");
  // Next can use its bind address in request.url. The browser's Host keeps localhost and custom domains valid.
  const protocol = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim() ?? requestUrl.protocol.slice(0, -1);
  const expectedOrigins = new Set([requestUrl.origin]);
  if (host && (protocol === "http" || protocol === "https")) expectedOrigins.add(`${protocol}://${host}`);
  if (process.env.BETTER_AUTH_URL) expectedOrigins.add(new URL(process.env.BETTER_AUTH_URL).origin);
  if (origin && !expectedOrigins.has(origin)) throw new AppError("This request came from an untrusted page.", 403);
  if (request.headers.get("sec-fetch-site") === "cross-site") throw new AppError("This request came from an untrusted page.", 403);
}
