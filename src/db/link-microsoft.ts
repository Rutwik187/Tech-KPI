import { config } from "dotenv";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";

config({ path: ".env.local", quiet: true });
async function main() {
  const { db, pool } = await import("./index");
  const { user, account, session, activities } = await import("./schema");
  const { linkMicrosoftAccount } = await import("../server/microsoft-accounts");
  try {
    const input = z.object({ clientId: z.uuid(), tenantId: z.uuid(), clientSecret: z.string().trim().min(1), objectId: z.uuid(), email: z.email() }).parse({
      clientId: process.env.MICROSOFT_CLIENT_ID, tenantId: process.env.MICROSOFT_TENANT_ID,
      clientSecret: process.env.MICROSOFT_CLIENT_SECRET, objectId: process.env.MICROSOFT_ADMIN_OBJECT_ID,
      email: process.env.SETUP_ADMIN_EMAIL || "rutwik.shinde@urbangabru.in",
    });
    await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(7201201)`);
      // The operator selects an existing local admin. Sign-in links only members an admin added, by their Microsoft sign-in name.
      const [admin] = await tx.select().from(user).where(and(eq(user.email, input.email.toLowerCase()), eq(user.role, "admin"))).for("update");
      if (!admin || admin.banned) throw new Error("An active admin profile with that email is required. Run setup:admin first.");
      const linked = await linkMicrosoftAccount(tx, admin.id, input.objectId);
      await tx.delete(account).where(and(eq(account.userId, admin.id), eq(account.providerId, "credential")));
      await tx.delete(session).where(eq(session.userId, admin.id));
      await tx.insert(activities).values({ entityId: admin.id, actorId: admin.id, action: "admin.microsoft_linked", payload: { microsoftObjectId: input.objectId.toLowerCase(), tenantId: input.tenantId.toLowerCase(), created: linked } });
    });
    console.log("Admin Microsoft identity linked. Legacy password access and old sessions were removed. Complete a Microsoft sign-in to verify the setup.");
  } finally { await pool.end(); }
}
main().catch((error) => { console.error(error instanceof z.ZodError ? "Microsoft setup requires valid tenant ID, client ID, client secret and admin Object ID." : error instanceof Error ? error.message : "Microsoft setup failed."); process.exitCode = 1; });
