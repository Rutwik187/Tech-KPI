import { and, eq, lt, sql } from "drizzle-orm";
import { db } from "@/db";
import { notifications } from "@/db/schema";

/**
 * Sends the workspace's emails through Microsoft Graph, from the mailbox in MAIL_FROM, with the Microsoft app the sign-in uses.
 * The app needs the Microsoft Graph application permission Mail.Send, with admin consent. Until MAIL_FROM is set, emails wait
 * in the notification table, and those from the last three days go out once sending works.
 */
const KEEP_WAITING_DAYS = 3;
const MAX_ATTEMPTS = 5;

export function mailSender(): string | null {
  const from = process.env.MAIL_FROM?.trim();
  const ready = from && process.env.MICROSOFT_TENANT_ID && process.env.MICROSOFT_CLIENT_ID && process.env.MICROSOFT_CLIENT_SECRET;
  return ready ? from : null;
}

let cachedToken: { value: string; expiresAt: number } | null = null;
async function graphToken(): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) return cachedToken.value;
  const response = await fetch(`https://login.microsoftonline.com/${process.env.MICROSOFT_TENANT_ID}/oauth2/v2.0/token`, {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, signal: AbortSignal.timeout(15_000),
    body: new URLSearchParams({ client_id: process.env.MICROSOFT_CLIENT_ID!, client_secret: process.env.MICROSOFT_CLIENT_SECRET!, scope: "https://graph.microsoft.com/.default", grant_type: "client_credentials" }),
  });
  const body = await response.json().catch(() => ({})) as { access_token?: string; expires_in?: number; error_description?: string };
  if (!response.ok || !body.access_token) throw new Error(`Microsoft sign-in for email failed: ${body.error_description?.split("\r\n")[0] ?? response.status}`);
  cachedToken = { value: body.access_token, expiresAt: Date.now() + (body.expires_in ?? 3600) * 1000 };
  return cachedToken.value;
}

/** Sends one email. Throws a short reason when Microsoft refuses it, for example when Mail.Send was not granted. */
export async function sendMail(message: { to: string; subject: string; html: string }) {
  const from = mailSender();
  if (!from) throw new Error("Email is not set up. Add MAIL_FROM and grant the Microsoft app the Mail.Send permission.");
  const response = await fetch(`https://graph.microsoft.com/v1.0/users/${encodeURIComponent(from)}/sendMail`, {
    method: "POST", signal: AbortSignal.timeout(20_000),
    headers: { Authorization: `Bearer ${await graphToken()}`, "Content-Type": "application/json" },
    body: JSON.stringify({ message: { subject: message.subject, body: { contentType: "HTML", content: message.html }, toRecipients: [{ emailAddress: { address: message.to } }] }, saveToSentItems: false }),
  });
  if (!response.ok) {
    // A permission granted a moment ago is only in a new token, so the next try asks Microsoft for one.
    if (response.status === 401 || response.status === 403) cachedToken = null;
    const body = await response.json().catch(() => ({})) as { error?: { code?: string; message?: string } };
    const code = body.error?.code ?? String(response.status);
    throw new Error(code === "ErrorAccessDenied" || response.status === 403
      ? "Microsoft refused to send: the app needs the Mail.Send permission with admin consent."
      : `Microsoft refused to send (${code}): ${body.error?.message?.slice(0, 200) ?? ""}`);
  }
}

/**
 * Sends waiting emails, oldest first. Each row is claimed before sending, so two runs never send it twice.
 * Rows older than three days expire instead of going out late. Returns how many were sent.
 */
export async function deliverPending(limit = 25): Promise<number> {
  await db.update(notifications).set({ status: "expired" })
    .where(and(eq(notifications.status, "pending"), lt(notifications.createdAt, sql`now() - make_interval(days => ${KEEP_WAITING_DAYS})`)));
  if (!mailSender()) return 0;
  const waiting = await db.select().from(notifications).where(eq(notifications.status, "pending")).orderBy(notifications.createdAt).limit(limit);
  let sent = 0;
  for (const row of waiting) {
    const [claimed] = await db.update(notifications).set({ attempts: row.attempts + 1 })
      .where(and(eq(notifications.id, row.id), eq(notifications.status, "pending"), eq(notifications.attempts, row.attempts))).returning({ id: notifications.id });
    if (!claimed) continue;
    try {
      await sendMail({ to: row.email, subject: row.subject, html: row.html });
      await db.update(notifications).set({ status: "sent", sentAt: new Date(), lastError: null }).where(eq(notifications.id, row.id));
      sent++;
    } catch (error) {
      const reason = error instanceof Error ? error.message.slice(0, 500) : "Unknown error";
      await db.update(notifications).set({ lastError: reason, ...(row.attempts + 1 >= MAX_ATTEMPTS ? { status: "failed" as const } : {}) }).where(eq(notifications.id, row.id));
    }
  }
  return sent;
}
