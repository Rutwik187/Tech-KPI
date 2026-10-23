import { describe, expect, it } from 'vitest';
import type { DashboardData, Member, Project } from '@/lib/types';
import { defaultSettings } from '@/lib/kpi';
import { ADHOC_PROJECT, ADHOC_PROJECT_ID } from '@/lib/project-defaults';
import { ownerChoices, ownerHomeProject, withOwner, withProject, type PickedByHand, type WorkClassification } from '../lib';

const person = (id: string, role: Member['role'] = 'developer'): Member => ({ id, name: id, email: `${id}@example.com`, role, image: null, capacity: 33, isActive: true });
const admin = person('admin', 'admin');
const [arshad, gayatri, pratik, arpit] = ['arshad', 'gayatri', 'pratik', 'arpit'].map(id => person(id));
const project = (id: string, primary: Member, ...others: Member[]): Project => ({
  id, name: id, color: '#2563eb', description: '', isArchived: false, isAdhoc: false, startDate: null, targetDate: null, originalTargetDate: null,
  memberIds: [primary.id, ...others.map(m => m.id)], primaryMemberId: primary.id,
});
const data: DashboardData = {
  currentUser: admin, members: [admin, arshad, gayatri, pratik, arpit],
  projects: [{ ...ADHOC_PROJECT }, project('dm-portal', gayatri, arshad), project('im-portal', arshad), project('npd', pratik, gayatri), project('price-tracker', arpit)],
  phases: [], items: [], activities: [], leaves: [], holidays: [], settings: defaultSettings, mode: 'demo',
};
const start: WorkClassification = { projectId: ADHOC_PROJECT_ID, phaseId: null, assigneeId: arshad.id };
const none: PickedByHand = { project: false, owner: false };

describe('project and owner auto-fill', () => {
  it('fills the primary developer when a project is picked first', () => {
    expect(withProject(data, start, 'npd', { ...none, project: true }).assigneeId).toBe(pratik.id);
  });

  it('keeps a hand-picked owner who is on the picked project', () => {
    expect(withProject(data, { ...start, assigneeId: gayatri.id }, 'npd', { project: true, owner: true }).assigneeId).toBe(gayatri.id);
  });

  it('replaces a hand-picked owner who is not on the picked project', () => {
    expect(withProject(data, { ...start, assigneeId: arpit.id }, 'npd', { project: true, owner: true }).assigneeId).toBe(pratik.id);
  });

  it('fills the main project when an owner is picked first', () => {
    expect(withOwner(data, start, arpit.id, { ...none, owner: true }).projectId).toBe('price-tracker');
    // Lead projects come before projects where the person is a secondary developer.
    expect(ownerHomeProject(data, arshad.id)).toBe('im-portal');
    expect(ownerHomeProject(data, admin.id)).toBe(ADHOC_PROJECT_ID);
  });

  it('never moves a hand-picked project when the owner changes', () => {
    const value = { projectId: 'npd', phaseId: null, assigneeId: pratik.id };
    expect(withOwner(data, value, gayatri.id, { project: true, owner: true })).toEqual({ ...value, assigneeId: gayatri.id });
  });

  it('lets any developer be picked until a project is picked; admins own no tickets', () => {
    expect(ownerChoices(data, 'im-portal', false).map(m => m.id)).toEqual(data.members.filter(m => m.role === 'developer').map(m => m.id));
    expect(ownerChoices(data, 'im-portal', true).map(m => m.id)).toEqual([arshad.id]);
  });

  it('settles after each pick, so the two fields cannot keep changing each other', () => {
    let picked = none;
    let value = start;
    picked = { ...picked, owner: true }; value = withOwner(data, value, gayatri.id, picked);
    expect(value).toEqual({ projectId: 'dm-portal', phaseId: null, assigneeId: gayatri.id });
    picked = { ...picked, project: true }; value = withProject(data, value, 'npd', picked);
    expect(value).toEqual({ projectId: 'npd', phaseId: null, assigneeId: gayatri.id });
    // Different people can now own work in different projects without the form pulling them back.
    value = withOwner(data, value, pratik.id, picked);
    expect(value.projectId).toBe('npd');
    value = withProject(data, value, 'price-tracker', picked);
    expect(value).toEqual({ projectId: 'price-tracker', phaseId: null, assigneeId: arpit.id });
    expect(withProject(data, value, 'price-tracker', picked)).toEqual(value);
  });
});
