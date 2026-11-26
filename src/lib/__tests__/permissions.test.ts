import { describe, expect, it } from 'vitest';
import { createDemoData } from '@/lib/demo';
import { ACTION_CAPABILITY, can, manageableRoles, mayDo, ROLES, type ActionName } from '../permissions';
import { canOpen, SECTIONS, type Section } from '../sections';
import { mutateDemo, viewAs } from '@/components/workspace/lib';

const demo = () => createDemoData(new Date('2026-11-04T12:00:00+05:30'));
const pages = (role: (typeof ROLES)[number]) => SECTIONS.filter(section => canOpen(section, role));

describe('roles', () => {
  it('opens each page only to the roles that use it', () => {
    expect(pages('admin')).toEqual([...SECTIONS]);
    expect(pages('tech_lead')).toEqual<Section[]>(['dashboard', 'requests', 'tickets', 'bugs', 'approvals', 'leave', 'standup', 'team', 'projects', 'settings', 'account']);
    expect(pages('project_manager')).toEqual<Section[]>(['dashboard', 'requests', 'account']);
    expect(pages('developer')).toEqual<Section[]>(['dashboard', 'tickets', 'bugs', 'approvals', 'leave', 'projects', 'account']);
    expect(pages('requester')).toEqual<Section[]>(['dashboard', 'requests', 'account']);
  });

  it('lets an admin make every change, and nobody else make organisation changes', () => {
    for (const action of Object.keys(ACTION_CAPABILITY) as ActionName[]) {
      const ownOnly = ['requestTicket', 'withdrawTicketRequest', 'withdrawDueDateRequest', 'requestLeave', 'withdrawLeaveRequest', 'createTechRequest', 'updateTechRequest', 'withdrawTechRequest'];
      expect(mayDo('admin', action), action).toBe(!ownOnly.includes(action));
    }
    for (const role of ['tech_lead', 'project_manager', 'developer', 'requester'] as const) {
      expect(mayDo(role, 'createDepartment')).toBe(false);
      expect(can(role, 'activity.view')).toBe(false);
    }
    expect(mayDo('project_manager', 'createItem')).toBe(false);
    expect(mayDo('project_manager', 'assignTechRequest')).toBe(false);
    expect(mayDo('developer', 'approveLeaveRequest')).toBe(false);
    expect(mayDo('tech_lead', 'assignTechRequest')).toBe(true);
  });

  it('lets a tech lead manage developers and project managers only', () => {
    expect(manageableRoles('admin')).toEqual([...ROLES]);
    expect(manageableRoles('tech_lead')).toEqual(['developer', 'project_manager']);
    expect(manageableRoles('project_manager')).toEqual([]);
    let data = demo();
    const lead = data.members.find(m => m.role === 'tech_lead')!;
    data = mutateDemo(data, { action: 'createMember', name: 'Nia Roy', email: 'nia@example.com', role: 'project_manager', capacity: 33 }, lead);
    expect(data.members.find(m => m.email === 'nia@example.com')?.role).toBe('project_manager');
    expect(() => mutateDemo(data, { action: 'createMember', name: 'Ola', email: 'ola@example.com', role: 'admin', capacity: 10 }, lead)).toThrow('Only an admin');
    expect(() => mutateDemo(data, { action: 'updateMember', id: 'demo-lead', patch: { isActive: false } }, lead)).toThrow('Only an admin can change an admin');
    expect(() => mutateDemo(data, { action: 'updateMember', id: 'demo-aarav', patch: { role: 'tech_lead' } }, lead)).toThrow('Only an admin');
    expect(() => mutateDemo(data, { action: 'createDepartment', name: 'Legal' }, lead)).toThrow('Only an admin');
    // A tech lead changes working hours and scores, not who can sign in.
    expect(() => mutateDemo(data, { action: 'saveSettings', settings: { ...data.settings, requestDomains: ['urbangabru.in'] } }, lead)).toThrow('Only an admin');
    expect(mutateDemo(data, { action: 'saveSettings', settings: { ...data.settings, normalTargetHours: 20 } }, lead).settings.normalTargetHours).toBe(20);
    // Nobody changes their own role.
    expect(() => mutateDemo(data, { action: 'updateMember', id: 'demo-lead', patch: { role: 'developer' } }, data.currentUser)).toThrow('your own');
  });

  it('gives a tech lead the tech team, and only an admin the people in other teams', () => {
    const data = demo();
    const admin = viewAs(data, 'demo-lead');
    expect(admin.members.some(m => m.role === 'requester')).toBe(true);
    const lead = viewAs(data, 'demo-siddharth');
    expect(lead.currentUser.role).toBe('tech_lead');
    expect(lead.members.some(m => m.role === 'requester')).toBe(false);
    expect(lead.items.length).toBe(data.items.length);
    expect(lead.techRequests.length).toBe(data.techRequests.length);
    expect(lead.activities.every(a => !a.action.startsWith('department.'))).toBe(true);
  });

  it('deletes an unused invite, keeps the history of someone who raised requests, and lets only an admin remove other teams', () => {
    let data = demo();
    const admin = data.currentUser;
    data = mutateDemo(data, { action: 'createMember', name: 'Typo Person', email: 'typo@example.com', role: 'requester', capacity: 33, departmentId: 'demo-team-1' }, admin);
    const typo = data.members.find(m => m.email === 'typo@example.com')!;
    const lead = data.members.find(m => m.role === 'tech_lead')!;
    expect(() => mutateDemo(data, { action: 'removeMember', id: typo.id }, lead)).toThrow('Only an admin can remove someone from another team');
    data = mutateDemo(data, { action: 'removeMember', id: typo.id }, admin);
    expect(data.members.some(m => m.id === typo.id)).toBe(false);
    // Priya raised requests, so she keeps them and only loses access.
    data = mutateDemo(data, { action: 'removeMember', id: 'demo-priya' }, admin);
    expect(data.members.find(m => m.id === 'demo-priya')?.isActive).toBe(false);
    expect(data.techRequests.some(r => r.requesterId === 'demo-priya')).toBe(true);
    expect(() => mutateDemo(data, { action: 'removeMember', id: admin.id }, admin)).toThrow('yourself');
    expect(() => mutateDemo(data, { action: 'removeMember', id: 'demo-aarav' }, admin)).toThrow('open tickets');
  });
});
