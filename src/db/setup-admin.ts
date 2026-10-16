import { randomUUID } from "node:crypto";
import { config } from "dotenv";
import { createInterface } from "node:readline";
import { count, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { DEFAULT_SETTINGS } from "../server/default-settings";

config({ path: ".env.local", quiet: true });
function prompt(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => rl.question(question, (answer) => { rl.close(); resolve(answer); }));
}
async function main() {
  const { db, pool } = await import("./index");
  const { user, memberProfiles, projects, settings, activities } = await import("./schema");
  const { linkMicrosoftAccount } = await import("../server/microsoft-accounts");
  try {
    const input = z.object({ name: z.string().trim().min(1).max(200), email: z.email(), microsoftObjectId: z.uuid().optional() }).parse({
      name: process.env.SETUP_ADMIN_NAME || await prompt("Admin name: "),
      email: process.env.SETUP_ADMIN_EMAIL || await prompt("Admin email: "),
      microsoftObjectId: process.env.MICROSOFT_ADMIN_OBJECT_ID || undefined,
    });
    await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(7201201)`);
      const [existing] = await tx.select({ count: count() }).from(user).where(eq(user.role, "admin"));
      if (existing.count > 0) throw new Error("An admin already exists. Use setup:microsoft to link its Microsoft identity.");
      const id = randomUUID();
      await tx.insert(user).values({ id, name: input.name, email: input.email.toLowerCase(), role: "admin", emailVerified: false });
      if (input.microsoftObjectId) await linkMicrosoftAccount(tx, id, input.microsoftObjectId);
      await tx.insert(memberProfiles).values({ userId: id, capacity: 10 });
      await tx.insert(settings).values({ id: 1, value: DEFAULT_SETTINGS }).onConflictDoNothing();
      const [existingProject] = await tx.select().from(projects).limit(1);
      if (!existingProject) await tx.insert(projects).values({ name: "General", description: "Team tasks and bugs", color: "#7c3aed" });
      await tx.insert(activities).values({ entityId: id, actorId: id, action: "admin.bootstrapped", payload: { name: input.name, microsoftLinked: !!input.microsoftObjectId } });
    });
    console.log(`Admin profile created for ${input.email.toLowerCase()}. Configure Microsoft OAuth with npm run setup:microsoft.`);
  } finally { await pool.end(); }
}
main().catch((error) => { console.error(error instanceof Error ? error.message : "Setup failed."); process.exitCode = 1; });
