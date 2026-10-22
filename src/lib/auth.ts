import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";
import { admin } from "better-auth/plugins/admin";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import * as schema from "@/db/schema/auth";
import { claimMicrosoftInvitation } from "@/server/microsoft-accounts";

const tenantId = z.uuid().safeParse(process.env.MICROSOFT_TENANT_ID);
const clientId = z.uuid().safeParse(process.env.MICROSOFT_CLIENT_ID);
const microsoftConfigured = tenantId.success && clientId.success && !!process.env.MICROSOFT_CLIENT_SECRET?.trim();

export const auth = betterAuth({
  appName: "UrbanGabru Tech KPI",
  secret: process.env.BETTER_AUTH_SECRET,
  baseURL: process.env.BETTER_AUTH_URL,
  database: drizzleAdapter(db, { provider: "pg", schema, transaction: true }),
  emailAndPassword: { enabled: false, disableSignUp: true },
  socialProviders: microsoftConfigured ? {
    microsoft: {
      clientId: clientId.data!.toLowerCase(), clientSecret: process.env.MICROSOFT_CLIENT_SECRET!, tenantId: tenantId.data!.toLowerCase(),
      prompt: "select_account", disableSignUp: true, disableImplicitSignUp: true,
      disableProfilePhoto: true, overrideUserInfoOnSignIn: false,
      async mapProfileToUser(profile) {
        // The upstream provider verifies issuer, signature, audience and nonce. OID remains its accountSubject.
        const objectId = typeof profile.oid === "string" ? profile.oid.toLowerCase() : "";
        const [linked] = await db.select({ email: schema.user.email, name: schema.user.name }).from(schema.account)
          .innerJoin(schema.user, eq(schema.user.id, schema.account.userId))
          .where(and(eq(schema.account.providerId, "microsoft"), eq(schema.account.accountId, objectId)));
        // A member added by work email links their Microsoft account on first sign-in. Anyone else stays out.
        const invited = linked ?? await claimMicrosoftInvitation(profile, tenantId.data!);
        return { email: invited?.email ?? `${objectId}@unprovisioned.invalid`, name: invited?.name ?? "Uninvited account", emailVerified: false, image: "" };
      },
    },
  } : {},
  account: { encryptOAuthTokens: true, accountLinking: { enabled: false, disableImplicitLinking: true, trustedProviders: [] } },
  session: { expiresIn: 60 * 60 * 24 * 7, updateAge: 60 * 60 * 24 },
  rateLimit: { enabled: true, storage: "database", window: 60, max: 50 },
  // Team management goes through audited application routes and cannot bypass its guards.
  disabledPaths: ["/sign-in/email", "/sign-up/email", "/change-password", "/set-password", "/request-password-reset", "/reset-password", "/link-social", "/unlink-account", "/change-email", "/admin/create-user", "/admin/set-role", "/admin/set-user-password", "/admin/update-user", "/admin/ban-user", "/admin/unban-user", "/admin/remove-user", "/admin/impersonate-user"],
  plugins: [admin({ defaultRole: "user", adminRoles: ["admin"] }), nextCookies()],
});
