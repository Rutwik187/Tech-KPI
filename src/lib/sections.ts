/** Every page in the workspace. The demo uses the same list under /demo. */
export const SECTIONS = ['dashboard', 'tickets', 'bugs', 'approvals', 'standup', 'team', 'projects', 'settings', 'account'] as const;
export type Section = (typeof SECTIONS)[number];
export const ADMIN_SECTIONS: readonly Section[] = ['standup', 'team', 'settings'];
export function isSection(value: string): value is Section { return (SECTIONS as readonly string[]).includes(value); }
