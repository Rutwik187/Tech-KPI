import { can, type Capability } from './permissions';
import type { Role } from './types';

/** Every page in the workspace. The demo uses the same list under /demo. */
export const SECTIONS = ['dashboard', 'requests', 'tickets', 'bugs', 'approvals', 'leave', 'standup', 'team', 'projects', 'people', 'other-teams', 'activity', 'settings', 'account'] as const;
export type Section = (typeof SECTIONS)[number];
export function isSection(value: string): value is Section { return (SECTIONS as readonly string[]).includes(value); }

/**
 * Who may open each page: anyone with one of these capabilities. Everyone has an overview and an account.
 * The overview shows each person their own home: requests for other teams and project managers, work for the tech team.
 * Pages only show what the server sends, and the server sends each person only what they may see.
 */
const ACCESS: Record<Section, readonly Capability[] | 'everyone'> = {
  dashboard: 'everyone', account: 'everyone',
  requests: ['requests.raise', 'requests.review'],
  tickets: ['work.manage', 'work.own'], bugs: ['work.manage', 'work.own'], approvals: ['work.manage', 'work.own'],
  leave: ['work.manage', 'work.own'], projects: ['work.manage', 'work.own'],
  standup: ['work.manage'], team: ['work.manage'],
  people: ['org.manage'], 'other-teams': ['org.manage'], activity: ['activity.view'],
  settings: ['settings.manage'],
};
export function canOpen(section: Section, role: Role): boolean {
  const needed = ACCESS[section];
  return needed === 'everyone' || needed.some((capability) => can(role, capability));
}
