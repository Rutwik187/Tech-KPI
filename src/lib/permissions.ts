import type { Role } from './types';

/**
 * What each role may do. The server checks every change against this list, and the pages use it to show only what a
 * person may use. A role never gets a page or a button for something the server would refuse.
 *
 * - Admin: everything in the organisation.
 * - Tech lead: runs the tech team: tickets, bugs, projects, approvals, leave, standup, KPI settings, assigning requests,
 *   and the developers and project managers on the team.
 * - Project manager: reviews requests from other teams and forwards them to the tech lead.
 * - Developer: their own tickets, bugs, leave, and the requests behind their work.
 * - Other team (requester): raises requests for their team and follows them.
 */
export type Capability =
  | 'org.manage'        // Teams outside tech, who can sign in, admin and tech lead accounts.
  | 'activity.view'     // The organisation's activity log.
  | 'people.manage'     // Add and change people. Which roles depends on `manageableRoles`.
  | 'work.manage'       // Every ticket, bug, project, approval, leave record, and score.
  | 'settings.manage'   // Working hours, score weights, bug targets, and holidays.
  | 'requests.review'   // Correct, forward, and decline new requests.
  | 'requests.assign'   // Assign, decline, and send back requests, at any review stage.
  | 'requests.raise'    // Raise requests for a team outside tech.
  | 'work.own';         // Own tickets and bugs, request tickets, hours, and leave.

const ROLE_CAPABILITIES: Record<Role, readonly Capability[]> = {
  admin: ['org.manage', 'activity.view', 'people.manage', 'work.manage', 'settings.manage', 'requests.review', 'requests.assign'],
  tech_lead: ['people.manage', 'work.manage', 'settings.manage', 'requests.review', 'requests.assign'],
  project_manager: ['requests.review'],
  developer: ['work.own'],
  requester: ['requests.raise'],
};

export const ROLES: readonly Role[] = ['admin', 'tech_lead', 'project_manager', 'developer', 'requester'];
/** What people read for each role. Someone from another team is a "requester" in the code. */
export const ROLE_NAMES: Record<Role, string> = { admin: 'Admin', tech_lead: 'Tech lead', project_manager: 'Project manager', developer: 'Developer', requester: 'Other team' };
/** One sentence per role, for the people form. */
export const ROLE_HELP: Record<Role, string> = {
  admin: 'Admins can do everything: people and roles, teams outside tech, who can sign in, the activity log, and all of the tech lead’s work.',
  tech_lead: 'The tech lead runs the tech team: tickets, bugs, projects, approvals, leave, KPI settings, and assigning requests. They add developers and project managers.',
  project_manager: 'Project managers review requests from every team. They ask questions, correct the details, and forward each request to the tech lead or decline it. They never see tickets or scores.',
  developer: 'Developers see and update their own tickets and bugs, and can request tickets and leave for themselves.',
  requester: 'People from other teams, such as Sales, raise requests for their team and follow them. They see their team’s requests, never tickets or scores.',
};

type WithRole = Role | { role: Role };
const roleOf = (who: WithRole): Role => typeof who === 'string' ? who : who.role;

export function can(who: WithRole, capability: Capability): boolean {
  return ROLE_CAPABILITIES[roleOf(who)].includes(capability);
}
/** The admin and the tech lead: the people who manage the tech team's work and see every ticket and score. */
export function leadsWork(who: WithRole): boolean { return can(who, 'work.manage'); }
/** Only an admin. */
export function isOrgAdmin(who: WithRole): boolean { return can(who, 'org.manage'); }
/** The roles a person may give to someone, and the people they may change. A tech lead manages developers and project managers. */
export function manageableRoles(who: WithRole): Role[] {
  const role = roleOf(who);
  return role === 'admin' ? [...ROLES] : role === 'tech_lead' ? ['developer', 'project_manager'] : [];
}
/** People who join projects, own or oversee tickets, and appear on the Team page. */
export function isTechTeam(who: WithRole): boolean {
  const role = roleOf(who);
  return role === 'admin' || role === 'tech_lead' || role === 'developer';
}
/** People who own no tickets and join no projects. A person must hand over open work before taking one of these roles. */
export function ownsNoWork(who: WithRole): boolean {
  const role = roleOf(who);
  return role === 'requester' || role === 'project_manager';
}

/**
 * The capability each change needs, by its action name. A person needs one of the listed capabilities. `null` means anyone
 * signed in, with the record checked when the change runs: comments on a request the person can see.
 * Some changes check more when they run: a developer updates only their own tickets, and a tech lead changes only developers
 * and project managers. The server refuses any action missing from this table.
 */
export const ACTION_CAPABILITY = {
  createItem: ['work.manage'], createTickets: ['work.manage'], approveTicketRequest: ['work.manage'], declineTicketRequest: ['work.manage'],
  approveDueDateRequest: ['work.manage'], declineDueDateRequest: ['work.manage'], approveLeaveRequest: ['work.manage'], declineLeaveRequest: ['work.manage'],
  addLeave: ['work.manage'], deleteLeave: ['work.manage'], createProject: ['work.manage'], updateProject: ['work.manage'], createPhase: ['work.manage'], updatePhase: ['work.manage'],
  updateItem: ['work.manage', 'work.own'], extendTicket: ['work.manage', 'work.own'],
  requestTicket: ['work.own'], withdrawTicketRequest: ['work.own'], withdrawDueDateRequest: ['work.own'], requestLeave: ['work.own'], withdrawLeaveRequest: ['work.own'],
  createMember: ['people.manage'], updateMember: ['people.manage'], removeMember: ['people.manage'],
  saveSettings: ['settings.manage'], addHoliday: ['settings.manage'], deleteHoliday: ['settings.manage'],
  createDepartment: ['org.manage'], updateDepartment: ['org.manage'],
  createTechRequest: ['requests.raise'], updateTechRequest: ['requests.raise'], withdrawTechRequest: ['requests.raise'],
  editTechRequest: ['requests.review'], forwardTechRequest: ['requests.review'], declineTechRequest: ['requests.review'],
  assignTechRequest: ['requests.assign'], returnTechRequest: ['requests.assign'],
  addRequestComment: null, deleteRequestComment: null,
} as const satisfies Record<string, readonly Capability[] | null>;
export type ActionName = keyof typeof ACTION_CAPABILITY;
/** Whether this person's role may make this kind of change at all. */
export function mayDo(who: WithRole, action: ActionName): boolean {
  const needed: readonly Capability[] | null = ACTION_CAPABILITY[action];
  return !needed || needed.some((capability) => can(who, capability));
}

/** Why a change was refused, by the capability it needed. The server and the demo say the same thing. */
export const DENIED: Record<Capability, string> = {
  'org.manage': 'Only an admin can make this change.',
  'activity.view': 'Only an admin can see the activity log.',
  'people.manage': 'Only an admin or the tech lead can change people.',
  'work.manage': 'Only the tech lead or an admin can make this change.',
  'settings.manage': 'Only the tech lead or an admin can change settings.',
  'requests.review': 'Only a project manager, the tech lead, or an admin can review requests.',
  'requests.assign': 'Only the tech lead or an admin can assign requests.',
  'requests.raise': 'Requests come from other teams. Add a ticket instead.',
  'work.own': 'This is for developers, for their own work.',
};
/** The reason to show when this person may not make this kind of change, or null when they may. */
export function refusal(who: WithRole, action: ActionName): string | null {
  const needed: readonly Capability[] | null = ACTION_CAPABILITY[action];
  return mayDo(who, action) || !needed ? null : DENIED[needed[0]];
}

/** "an admin", "a tech lead": a role's name with the right article, for messages. */
export function aRole(role: Role): string {
  if (role === 'requester') return 'someone from another team';
  const name = ROLE_NAMES[role].toLowerCase();
  return `${/^[aeiou]/.test(name) ? 'an' : 'a'} ${name}`;
}
