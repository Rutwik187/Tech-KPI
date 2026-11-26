import { and, eq, lt, sql } from "drizzle-orm";
import { db } from "@/db";
import { mailAccount, notifications } from "@/db/schema";
import { open, seal } from "./secret-box";

/**
 * Sends the workspace's emails through Microsoft Graph. There are two ways to send:
 *
 * 1. A connected mailbox (preferred). Someone signs in once as the sending mailbox, such as tech@urbangabru.in, with
 *    `npm run mail:connect`. That gives the app the delegated permission Mail.Send for that one mailbox, which a person
 *    can grant for themselves. No organisation-wide admin consent is needed. The sign-in is stored encrypted in
 *    tech_kpi_mail_account and renewed each time it is used.
 * 2. The app's own permission. If the Microsoft app has the application permission Mail.Send with admin consent,
 *    it sends from the mailbox in MAIL_FROM.
 *
 * Until one of these works, emails wait in the notification table, and those from the last three days go out later.
 */
const KEEP_WAITING_DAYS = 3;
const MAX_ATTEMPTS = 5;
const LOGIN = "https://login.microsoftonline.com";
export const MAILBOX_SCOPE = "offline_access https://graph.microsoft.com/Mail.Send https://graph.microsoft.com/User.Read";

export type MailSetup = {
  from: string; via: "mailbox" | "app";
  connectedAt?: string; lastUsedAt?: string | null; lastError?: string | null;
};

function microsoftReady() {
  return !!(process.env.MICROSOFT_TENANT_ID && process.env.MICROSOFT_CLIENT_ID && process.env.MICROSOFT_CLIENT_SECRET);
}

async function connectedMailbox() {
  try {
    const [row] = await db.select().from(mailAccount).where(eq(mailAccount.id, 1)).limit(1);
    return row ?? null;
  } catch (error) {
    // Before migration 0016 runs, the table is missing. Then no mailbox is connected yet.
    const code = (error as { code?: string; cause?: { code?: string } }).cause?.code ?? (error as { code?: string }).code;
    if (code === "42P01") return null;
    throw error;
  }
}

/** How the workspace sends email, or null when it cannot send yet. */
export async function mailSetup(): Promise<MailSetup | null> {
  if (!microsoftReady()) return null;
  const mailbox = await connectedMailbox();
  if (mailbox) return { from: mailbox.email, via: "mailbox", connectedAt: mailbox.connectedAt.toISOString(), lastUsedAt: mailbox.lastUsedAt?.toISOString() ?? null, lastError: mailbox.lastError };
  const from = process.env.MAIL_FROM?.trim();
  return from ? { from, via: "app" } : null;
}

/** Stores the sign-in for the sending mailbox. It replaces any mailbox connected before. */
export async function saveMailbox(input: { email: string; refreshToken: string; connectedById?: string | null }) {
  const values = { email: input.email.toLowerCase(), refreshToken: seal(input.refreshToken), connectedById: input.connectedById ?? null, connectedAt: new Date(), lastUsedAt: null, lastError: null };
  await db.insert(mailAccount).values({ id: 1, ...values }).onConflictDoUpdate({ target: mailAccount.id, set: values });
  mailboxToken = null;
}

async function tokenRequest(params: Record<string, string>) {
  const response = await fetch(`${LOGIN}/${process.env.MICROSOFT_TENANT_ID}/oauth2/v2.0/token`, {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, signal: AbortSignal.timeout(15_000),
    body: new URLSearchParams({ client_id: process.env.MICROSOFT_CLIENT_ID!, client_secret: process.env.MICROSOFT_CLIENT_SECRET!, ...params }),
  });
  const body = await response.json().catch(() => ({})) as { access_token?: string; refresh_token?: string; expires_in?: number; error?: string; error_description?: string };
  return { ok: response.ok && !!body.access_token, body };
}

// Access tokens last about an hour. Each server instance keeps its own and asks for a new one shortly before it ends.
let appToken: { value: string; expiresAt: number } | null = null;
let mailboxToken: { key: string; value: string; expiresAt: number } | null = null;

async function appAccessToken(): Promise<string> {
  if (appToken && appToken.expiresAt > Date.now() + 60_000) return appToken.value;
  const { ok, body } = await tokenRequest({ scope: "https://graph.microsoft.com/.default", grant_type: "client_credentials" });
  if (!ok) throw new Error(`Microsoft sign-in for email failed: ${body.error_description?.split("\r\n")[0] ?? body.error ?? "no token"}`);
  appToken = { value: body.access_token!, expiresAt: Date.now() + (body.expires_in ?? 3600) * 1000 };
  return appToken.value;
}

async function mailboxAccessToken(mailbox: typeof mailAccount.$inferSelect): Promise<string> {
  const key = `${mailbox.email}:${mailbox.connectedAt.getTime()}`;
  if (mailboxToken?.key === key && mailboxToken.expiresAt > Date.now() + 60_000) return mailboxToken.value;
  const fail = async (reason: string): Promise<never> => {
    await db.update(mailAccount).set({ lastError: reason }).where(eq(mailAccount.id, 1));
    throw new Error(reason);
  };
  let refreshToken: string;
  try { refreshToken = open(mailbox.refreshToken); }
  catch { return fail(`The stored sign-in for ${mailbox.email} cannot be read. Connect the mailbox again with npm run mail:connect.`); }
  const { ok, body } = await tokenRequest({ grant_type: "refresh_token", refresh_token: refreshToken, scope: MAILBOX_SCOPE });
  if (!ok) {
    const expired = body.error === "invalid_grant" || body.error === "interaction_required";
    return fail(expired
      ? `The sign-in for ${mailbox.email} expired or was withdrawn. Connect the mailbox again with npm run mail:connect.`
      : `Microsoft sign-in for ${mailbox.email} failed: ${body.error_description?.split("\r\n")[0] ?? body.error ?? "no token"}`);
  }
  // Microsoft hands out a new refresh token each time. Keeping the newest one keeps the sign-in alive while it is used.
  await db.update(mailAccount).set({ ...(body.refresh_token ? { refreshToken: seal(body.refresh_token) } : {}), lastUsedAt: new Date(), lastError: null })
    .where(and(eq(mailAccount.id, 1), eq(mailAccount.connectedAt, mailbox.connectedAt)));
  mailboxToken = { key, value: body.access_token!, expiresAt: Date.now() + (body.expires_in ?? 3600) * 1000 };
  return mailboxToken.value;
}

/** Sends one email. Throws a short reason when it cannot, for example when no mailbox is connected. */
export async function sendMail(message: { to: string; subject: string; html: string }) {
  if (!microsoftReady()) throw new Error("Email is not set up. The Microsoft sign-in settings are missing on the server.");
  const mailbox = await connectedMailbox();
  const from = process.env.MAIL_FROM?.trim();
  if (!mailbox && !from) throw new Error("Email is not set up. Connect the sending mailbox with npm run mail:connect.");
  const token = mailbox ? await mailboxAccessToken(mailbox) : await appAccessToken();
  const path = mailbox ? "me" : `users/${encodeURIComponent(from!)}`;
  const response = await fetch(`https://graph.microsoft.com/v1.0/${path}/sendMail`, {
    method: "POST", signal: AbortSignal.timeout(20_000),
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ message: { subject: message.subject, body: { contentType: "HTML", content: message.html }, toRecipients: [{ emailAddress: { address: message.to } }] }, saveToSentItems: false }),
  });
  if (!response.ok) {
    // A permission granted a moment ago is only in a new token, so the next try asks Microsoft for one.
    if (response.status === 401 || response.status === 403) { appToken = null; mailboxToken = null; }
    const body = await response.json().catch(() => ({})) as { error?: { code?: string; message?: string } };
    const code = body.error?.code ?? String(response.status);
    if (code === "ErrorAccessDenied" || response.status === 403) {
      throw new Error(mailbox
        ? `Microsoft refused to send from ${mailbox.email}. Connect the mailbox again with npm run mail:connect.`
        : "Microsoft refused to send: the app needs the Mail.Send permission with admin consent, or connect a mailbox with npm run mail:connect.");
    }
    throw new Error(`Microsoft refused to send (${code}): ${body.error?.message?.slice(0, 200) ?? ""}`);
  }
}

/** Addresses under the reserved .invalid domain belong to test people. They can never receive email. */
export const isTestAddress = (email: string) => /\.invalid$/i.test(email.trim());

/**
 * Sends waiting emails, oldest first. Each row is claimed before sending, so two runs never send it twice.
 * Rows older than three days expire instead of going out late. Returns how many were sent.
 */
export async function deliverPending(limit = 25): Promise<number> {
  await db.update(notifications).set({ status: "expired" })
    .where(and(eq(notifications.status, "pending"), lt(notifications.createdAt, sql`now() - make_interval(days => ${KEEP_WAITING_DAYS})`)));
  const setup = await mailSetup();
  if (!setup) return 0;
  if (setup.via === "mailbox") {
    // When the mailbox sign-in has expired, emails keep waiting instead of using up their tries. The error shows in Settings.
    const mailbox = await connectedMailbox();
    if (!mailbox) return 0;
    try { await mailboxAccessToken(mailbox); } catch { return 0; }
  }
  const waiting = await db.select().from(notifications).where(eq(notifications.status, "pending")).orderBy(notifications.createdAt).limit(limit);
  let sent = 0;
  for (const row of waiting) {
    const [claimed] = await db.update(notifications).set({ attempts: row.attempts + 1 })
      .where(and(eq(notifications.id, row.id), eq(notifications.status, "pending"), eq(notifications.attempts, row.attempts))).returning({ id: notifications.id });
    if (!claimed) continue;
    if (isTestAddress(row.email)) {
      await db.update(notifications).set({ status: "expired", lastError: "A test address. Not sent." }).where(eq(notifications.id, row.id));
      continue;
    }
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
