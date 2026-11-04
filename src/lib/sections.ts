/** Every page in the workspace. The demo uses the same list under /demo. */
export const SECTIONS = ['dashboard', 'tickets', 'bugs', 'approvals', 'requests', 'standup', 'team', 'other-teams', 'projects', 'settings', 'account'] as const;
export type Section = (typeof SECTIONS)[number];
export const ADMIN_SECTIONS: readonly Section[] = ['standup', 'team', 'other-teams', 'settings'];
/** The whole workspace of someone from another team. Their overview is their list of requests. */
export const REQUESTER_SECTIONS: readonly Section[] = ['dashboard', 'requests', 'account'];
export function isSection(value: string): value is Section { return (SECTIONS as readonly string[]).includes(value); }
