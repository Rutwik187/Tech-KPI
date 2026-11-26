import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { departments, memberProfiles, notifications, requestComments, techRequests, user, workItems } from "@/db/schema";
import type { Member, Role } from "@/lib/types";
import { memberRole } from "./authz";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Person = { id: string; name: string; email: string };

/**
 * The steps that send email. Each is written in the same transaction as the change, so an email is never lost
 * and never sent for a change that did not happen.
 */
export type NotifyEvent =
  | { kind: "request.created"; requestId: string }
  | { kind: "request.forwarded"; requestId: string; note?: string }
  | { kind: "request.returned"; requestId: string; reason: string }
  | { kind: "request.assigned"; requestId: string; note?: string }
  | { kind: "request.declined"; requestId: string; reason: string }
  | { kind: "request.commented"; requestId: string; commentId: string }
  | { kind: "plan.shared"; requestId: string; version: number; message?: string }
  | { kind: "plan.confirmed"; requestId: string; version: number }
  | { kind: "request.done"; requestId: string };

/** Active people with these roles who want request emails. */
async function peopleWithRoles(tx: Tx, roles: Role[]): Promise<Person[]> {
  return tx.select({ id: user.id, name: user.name, email: user.email }).from(user)
    .leftJoin(memberProfiles, eq(memberProfiles.userId, user.id))
    .where(and(inArray(user.role, roles), sql`${user.banned} IS NOT TRUE`, sql`${memberProfiles.isActive} IS NOT FALSE`, sql`${memberProfiles.emailNotifications} IS NOT FALSE`));
}
async function person(tx: Tx, id: string | null | undefined): Promise<Person[]> {
  if (!id) return [];
  return tx.select({ id: user.id, name: user.name, email: user.email }).from(user)
    .leftJoin(memberProfiles, eq(memberProfiles.userId, user.id))
    .where(and(eq(user.id, id), sql`${user.banned} IS NOT TRUE`, sql`${memberProfiles.isActive} IS NOT FALSE`, sql`${memberProfiles.emailNotifications} IS NOT FALSE`));
}
/** Project managers review new requests. With none, the tech lead and admins hear about them, so nothing waits unseen. */
async function projectManagers(tx: Tx) {
  const managers = await peopleWithRoles(tx, ["project_manager"]);
  return managers.length ? managers : techLeads(tx);
}
/** The tech lead assigns forwarded requests. With no tech lead, the admins hear about them. */
async function techLeads(tx: Tx) {
  const leads = await peopleWithRoles(tx, ["tech_lead"]);
  return leads.length ? leads : peopleWithRoles(tx, ["admin"]);
}

const escape = (text: string) => text.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
function appUrl(path: string) {
  const base = (process.env.APP_URL ?? process.env.BETTER_AUTH_URL ?? "").replace(/\/$/, "");
  return `${base}${path}`;
}

/** A short, plain email: a heading, a sentence or two, a few facts, an optional quote, and one button. */
function compose(input: { subject: string; heading: string; intro: string; facts?: [string, string][]; quote?: string; quoteLabel?: string; button: { label: string; path: string } }) {
  const url = appUrl(input.button.path);
  const facts = (input.facts ?? []).filter(([, value]) => value);
  const html = `<!doctype html><html><body style="margin:0;padding:24px;background:#f4f5f7;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#1f2430">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:12px;border:1px solid #e3e6eb">
<tr><td style="padding:24px 28px 8px;font-size:13px;color:#6b7280;letter-spacing:.02em">Urban Gabru · Tech requests</td></tr>
<tr><td style="padding:0 28px;font-size:19px;font-weight:600;line-height:1.35">${escape(input.heading)}</td></tr>
<tr><td style="padding:10px 28px 0;font-size:14.5px;line-height:1.6">${escape(input.intro)}</td></tr>
${facts.length ? `<tr><td style="padding:14px 28px 0"><table role="presentation" cellpadding="0" cellspacing="0" style="font-size:13.5px;line-height:1.6">${facts.map(([label, value]) => `<tr><td style="padding:2px 16px 2px 0;color:#6b7280;white-space:nowrap;vertical-align:top">${escape(label)}</td><td style="padding:2px 0">${escape(value)}</td></tr>`).join("")}</table></td></tr>` : ""}
${input.quote ? `<tr><td style="padding:14px 28px 0">${input.quoteLabel ? `<div style="font-size:12.5px;color:#6b7280;margin-bottom:4px">${escape(input.quoteLabel)}</div>` : ""}<div style="padding:10px 14px;border-left:3px solid #3b5bdb;background:#f6f7fb;border-radius:0 8px 8px 0;font-size:14px;line-height:1.6;white-space:pre-wrap">${escape(input.quote)}</div></td></tr>` : ""}
<tr><td style="padding:20px 28px 26px"><a href="${escape(url)}" style="display:inline-block;padding:10px 18px;border-radius:8px;background:#3b5bdb;color:#ffffff;text-decoration:none;font-size:14px;font-weight:600">${escape(input.button.label)}</a></td></tr>
</table>
<p style="max-width:560px;margin:14px auto 0;font-size:12px;color:#8a8f98;line-height:1.5">You get this because you work with requests in the Urban Gabru tech workspace. Turn these emails off on My account.</p>
</body></html>`;
  const text = [input.heading, "", input.intro, ...facts.map(([label, value]) => `${label}: ${value}`), ...(input.quote ? ["", `${input.quoteLabel ?? ""}`.trim(), input.quote] : []), "", `${input.button.label}: ${url}`].join("\n");
  return { subject: input.subject, html, text };
}

/** The first word of a name, for friendly sentences. */
const first = (name: string) => name.split(" ")[0];

/**
 * Writes the emails for one step. The person who took the step never emails themselves, and each person gets one email.
 * Returns how many were written. They are sent after the transaction commits.
 */
export async function notify(tx: Tx, actor: Member, event: NotifyEvent): Promise<number> {
  const [row] = await tx.select({ request: techRequests, requesterName: user.name, requesterEmail: user.email, team: departments.name })
    .from(techRequests).innerJoin(user, eq(user.id, techRequests.requesterId)).leftJoin(departments, eq(departments.id, techRequests.departmentId))
    .where(eq(techRequests.id, event.requestId));
  if (!row) return 0;
  const { request } = row;
  const key = `REQ-${String(request.sequence).padStart(3, "0")}`;
  const team = row.team ?? "their team";
  const link = { path: `/requests?request=${key}` };
  const tag = `[${key}]`;
  const facts: [string, string][] = [["Request", `${key} · ${request.title}`], ["Team", team], ["Asked by", row.requesterName]];
  const requester = () => person(tx, request.requesterId);
  // `receipt` is for the person who took the step, such as the confirmation after raising a request.
  const letters: { to: Person[]; mail: ReturnType<typeof compose>; receipt?: boolean }[] = [];

  switch (event.kind) {
    case "request.created": {
      letters.push({ to: await projectManagers(tx), mail: compose({ subject: `${tag} New request from ${row.requesterName} (${team}): ${request.title}`, heading: "A new request needs review",
        intro: `${row.requesterName} from ${team} asked the tech team for something. Review it, ask any questions in the comments, then forward it to the tech lead or decline it.`,
        facts: [...facts, ["Kind", request.category === "tool" ? "New tool" : request.category === "feature" ? "New feature" : request.category], ["Tool", request.tool], ["Needed by", request.neededBy ?? ""]], quote: request.description, quoteLabel: "Details", button: { label: "Review the request", ...link } }) });
      letters.push({ to: await requester(), mail: compose({ subject: `${tag} We got your request: ${request.title}`, heading: "Your request was sent",
        intro: "A project manager reviews it next. You will get an email at each step, and you can follow it any time in the workspace.", facts, button: { label: "Follow your request", ...link } }), receipt: true });
      break;
    }
    case "request.forwarded": {
      letters.push({ to: await techLeads(tx), mail: compose({ subject: `${tag} Forwarded to you: ${request.title}`, heading: "A request is ready to assign",
        intro: `${actor.name} reviewed this request from ${team} and forwarded it to you. Assign it to a developer, or decline it with a reason.`,
        facts: [...facts, ["Urgency", request.priority]], quote: event.note || request.description, quoteLabel: event.note ? `Note from ${first(actor.name)}` : "Details", button: { label: "Assign the request", ...link } }) });
      letters.push({ to: await requester(), mail: compose({ subject: `${tag} Your request is with the tech lead`, heading: "Your request moved forward",
        intro: "A project manager reviewed your request and sent it to the tech lead, who chooses a developer for it.", facts, button: { label: "Follow your request", ...link } }) });
      break;
    }
    case "request.returned":
      letters.push({ to: await projectManagers(tx), mail: compose({ subject: `${tag} Sent back to project managers: ${request.title}`, heading: "The tech lead sent a request back",
        intro: `${actor.name} sent this request back for another look before it is assigned.`, facts, quote: event.reason, quoteLabel: "What to check", button: { label: "Open the request", ...link } }) });
      break;
    case "request.assigned": {
      const [work] = request.itemId ? await tx.select({ item: workItems, ownerName: user.name }).from(workItems).innerJoin(user, eq(user.id, workItems.assigneeId)).where(eq(workItems.id, request.itemId)) : [];
      const workKey = work ? `${work.item.type === "bug" ? "BUG" : "UG"}-${String(work.item.sequence).padStart(3, "0")}` : "";
      letters.push({ to: await requester(), mail: compose({ subject: `${tag} ${work ? first(work.ownerName) : "A developer"} is working on your request`, heading: "Your request was assigned",
        intro: `${work ? work.ownerName : "A developer"} will work on it.${work?.item.dueDate ? ` It is planned for ${work.item.dueDate}.` : ""}`, facts, quote: event.note, quoteLabel: `Note from ${first(actor.name)}`, button: { label: "Follow your request", ...link } }) });
      if (work) letters.push({ to: await person(tx, work.item.assigneeId), mail: compose({ subject: `${tag} New ${work.item.type === "bug" ? "bug" : "ticket"} for you: ${work.item.title}`, heading: `${actor.name} assigned you ${workKey}`,
        intro: `It comes from a request by ${row.requesterName} (${team}). The request, its files, and its comments are linked from the ticket.`,
        facts: [["Ticket", `${workKey} · ${work.item.title}`], ["Date", work.item.dueDate ?? ""], ["Request", key]], quote: request.description, quoteLabel: "What they asked for",
        button: { label: "Open the ticket", path: `/${work.item.type === "bug" ? "bugs" : "tickets"}?open=${workKey}` } }) });
      break;
    }
    case "request.declined":
      letters.push({ to: await requester(), mail: compose({ subject: `${tag} Your request was declined: ${request.title}`, heading: "Your request was declined",
        intro: `${actor.name} read your request and will not take it forward. Their reason is below. You can reply in the request's conversation.`, facts, quote: event.reason, quoteLabel: "Why", button: { label: "Open the request", ...link } }) });
      break;
    case "request.commented": {
      const [comment] = await tx.select().from(requestComments).where(eq(requestComments.id, event.commentId));
      if (!comment) break;
      const fromRequester = actor.id === request.requesterId || memberRole(actor.role) === "requester";
      // A requester's comment goes to whoever has the request now. The tech side's public comment goes to the requester.
      // A note only the tech team sees goes to whoever has the request on the tech side.
      const holders = request.status === "new" ? await projectManagers(tx) : request.status === "forwarded" ? await techLeads(tx)
        : request.itemId ? await person(tx, (await tx.select({ id: workItems.assigneeId }).from(workItems).where(eq(workItems.id, request.itemId)))[0]?.id) : [];
      const to = comment.internal || fromRequester ? holders : await requester();
      letters.push({ to, mail: compose({ subject: `${tag} ${actor.name} commented: ${request.title}`, heading: `${actor.name} wrote on ${key}`,
        intro: comment.internal ? "A note only the tech team sees." : fromRequester ? `${first(actor.name)} from ${team} added to their request.` : "The tech team replied on your request. You can answer in the conversation.",
        facts, quote: comment.body, button: { label: "Reply in the conversation", ...link } }) });
      break;
    }
    case "plan.shared":
      letters.push({ to: await requester(), mail: compose({ subject: `${tag} A plan for your request is ready (version ${event.version})`, heading: "Please check the plan for your request",
        intro: `${actor.name} wrote down what will be built and when. Read it, then select Looks good, or ask for changes in the conversation.`, facts, quote: event.message, quoteLabel: `Message from ${first(actor.name)}`, button: { label: "Read the plan", ...link } }) });
      break;
    case "plan.confirmed": {
      const sharer = request.planShared?.sharedById;
      const to = [...await person(tx, sharer), ...await projectManagers(tx)];
      letters.push({ to, mail: compose({ subject: `${tag} ${first(row.requesterName)} confirmed the plan (version ${event.version})`, heading: "The plan was confirmed",
        intro: `${row.requesterName} read version ${event.version} of the plan and said it looks good.`, facts, button: { label: "Open the request", ...link } }) });
      break;
    }
    case "request.done":
      letters.push({ to: await requester(), mail: compose({ subject: `${tag} Done: ${request.title}`, heading: "Your request is done",
        intro: "The tech team finished the work you asked for. If something is not right, reply in the request's conversation.", facts, button: { label: "Open the request", ...link } }) });
      break;
  }

  const seen = new Set<string>();
  const rows = letters.flatMap(({ to, mail, receipt }) => to.filter((p) => (receipt || p.id !== actor.id) && !seen.has(p.id) && seen.add(p.id)).map((p) => ({
    userId: p.id, email: p.email, kind: event.kind, entityId: request.id, subject: mail.subject, html: mail.html, text: mail.text,
  })));
  if (rows.length) await tx.insert(notifications).values(rows);
  return rows.length;
}
