import { describe, expect, it } from 'vitest';
import { createDemoData } from '@/lib/demo';
import type { TechRequest, WorkItem } from '@/lib/types';
import { mutateDemo, requestStage, requestWork, roleLabel, viewAs } from '../lib';

const demo = () => createDemoData(new Date('2026-11-04T12:00:00+05:30'));
const ask = { title: 'Size chart on product pages', description: 'Customers ask which size fits. Add a size chart under the size picker.', category: 'feature', priority: 'medium', neededBy: null } as const;

describe('requests from other teams', () => {
  it('reads each stage from the work a request became', () => {
    const data = demo();
    const request = data.techRequests.find(r => r.status === 'assigned')!;
    const withStatus = (status: WorkItem['status']) => ({ ...data, items: data.items.map(item => item.id === request.itemId ? { ...item, status } : item) });
    expect(requestStage(withStatus('todo'), request)).toBe('assigned');
    expect(requestStage(withStatus('in_progress'), request)).toBe('in_progress');
    // A blocker is the tech team's to clear, so the requester sees work in progress.
    expect(requestStage(withStatus('blocked'), request)).toBe('in_progress');
    expect(requestStage(withStatus('in_review'), request)).toBe('checking');
    expect(requestStage(withStatus('done'), request)).toBe('done');
    expect(requestStage(data, { ...request, status: 'new' })).toBe('waiting');
    expect(requestStage(data, { ...request, status: 'declined' })).toBe('declined');
  });

  it('prefers the live ticket over the server summary, and uses the summary when the ticket is not visible', () => {
    const data = demo();
    const request = data.techRequests.find(r => r.status === 'assigned')!;
    const stale: TechRequest = { ...request, work: { ...request.work!, status: 'todo', assigneeName: 'Someone else' } };
    const item = data.items.find(i => i.id === request.itemId)!;
    expect(requestWork(data, stale)).toMatchObject({ key: item.key, status: item.status, assigneeId: item.assigneeId });
    expect(requestWork({ ...data, items: [] }, stale)).toMatchObject({ status: 'todo', assigneeName: 'Someone else' });
  });

  it('shows a requester their own and their team’s requests, with progress, and nothing from the tech team', () => {
    const data = demo();
    const view = viewAs(data, 'demo-rahul');
    expect(view.currentUser.role).toBe('requester');
    expect(view.items).toEqual([]);
    expect(view.members.map(m => m.id)).toEqual(['demo-rahul']);
    expect(view.projects).toEqual([]);
    expect(view.techRequests.length).toBeGreaterThan(0);
    expect(view.techRequests.every(r => r.departmentId === 'demo-team-2')).toBe(true);
    // Progress comes along, because the requester cannot see the ticket itself.
    const assigned = view.techRequests.find(r => r.status === 'assigned')!;
    expect(requestStage(view, assigned)).toBe(requestStage(data, assigned));
    expect(assigned.work?.assigneeName).toBe('Arjun Patil');
  });

  it('gives a developer only the requests behind their own work', () => {
    const data = demo();
    const view = viewAs(data, 'demo-arjun');
    const own = new Set(view.items.map(item => item.id));
    expect(view.techRequests.length).toBeGreaterThan(0);
    expect(view.techRequests.every(r => r.itemId && own.has(r.itemId))).toBe(true);
  });

  it('remembers a requester’s team from their first request, and only the admin decides on it', () => {
    let data = demo();
    data.members = data.members.map(m => m.id === 'demo-priya' ? { ...m, departmentId: null } : m);
    const priya = data.members.find(m => m.id === 'demo-priya')!;
    data = mutateDemo(data, { action: 'createTechRequest', ...ask, departmentId: 'demo-team-1' }, priya);
    const raised = data.techRequests.find(r => r.title === ask.title)!;
    expect(raised).toMatchObject({ status: 'new', requesterId: 'demo-priya', requesterName: 'Priya Kapoor', key: 'REQ-008' });
    expect(data.members.find(m => m.id === 'demo-priya')?.departmentId).toBe('demo-team-1');

    const admin = data.currentUser;
    data = mutateDemo(data, { action: 'assignTechRequest', id: raised.id, type: 'task', assigneeId: 'demo-aarav', title: ask.title, projectId: 'demo-commerce', phaseId: null, priority: 'high', estimateHours: 6, dueDate: '2026-11-09' }, admin);
    const assigned = data.techRequests.find(r => r.id === raised.id)!;
    const ticket = data.items.find(i => i.id === assigned.itemId)!;
    expect(ticket).toMatchObject({ type: 'task', status: 'todo', assigneeId: 'demo-aarav', estimateHours: 6, dueDate: '2026-11-09', description: ask.description });
    expect(assigned.work).toMatchObject({ key: ticket.key, assigneeName: 'Aarav Mehta' });
    // Once reviewed, a request no longer changes, and it cannot be decided twice.
    expect(() => mutateDemo(data, { action: 'updateTechRequest', id: raised.id, patch: { priority: 'urgent' } }, priya)).toThrow();
    expect(() => mutateDemo(data, { action: 'declineTechRequest', id: raised.id, reason: 'Too late' }, admin)).toThrow();
  });

  it('turns a broken thing into a bug with no estimate or date, and refuses archived or duplicate teams', () => {
    let data = demo();
    const rahul = data.members.find(m => m.id === 'demo-rahul')!;
    data = mutateDemo(data, { action: 'createTechRequest', ...ask, title: 'Checkout button missing', category: 'problem', departmentId: 'demo-team-2' }, rahul);
    const broken = data.techRequests.find(r => r.title === 'Checkout button missing')!;
    data = mutateDemo(data, { action: 'assignTechRequest', id: broken.id, type: 'bug', assigneeId: 'demo-arjun', title: broken.title, projectId: 'demo-commerce', phaseId: null, priority: 'urgent', severity: 'critical' }, data.currentUser);
    const bug = data.items.find(i => i.id === data.techRequests.find(r => r.id === broken.id)!.itemId)!;
    expect(bug).toMatchObject({ type: 'bug', status: 'open', severity: 'critical', estimateHours: 0, dueDate: null });

    data = mutateDemo(data, { action: 'updateDepartment', id: 'demo-team-6', isArchived: true }, data.currentUser);
    expect(() => mutateDemo(data, { action: 'createTechRequest', ...ask, departmentId: 'demo-team-6' }, rahul)).toThrow('Choose a team from the list.');
    expect(() => mutateDemo(data, { action: 'createDepartment', name: ' sales ' }, data.currentUser)).toThrow('A team with this name already exists.');
  });

  it('lets several members of a team raise requests, and each sees the others’ requests', () => {
    const data = demo();
    expect(new Set(data.members.map(m => m.id)).size).toBe(data.members.length);
    const ecommerce = data.members.filter(m => m.role === 'requester' && m.departmentId === 'demo-team-2');
    expect(ecommerce.map(m => [m.name, roleLabel(data, m)])).toEqual([['Rahul Verma', 'E-commerce team lead'], ['Zoya Khan', 'E-commerce team']]);
    const zoyas = data.techRequests.filter(r => r.requesterId === 'demo-zoya').map(r => r.id);
    const rahuls = data.techRequests.filter(r => r.requesterId === 'demo-rahul').map(r => r.id);
    expect(zoyas.length).toBeGreaterThan(0);
    expect(rahuls.length).toBeGreaterThan(0);
    for (const id of ['demo-rahul', 'demo-zoya']) expect(viewAs(data, id).techRequests.map(r => r.id)).toEqual(expect.arrayContaining([...zoyas, ...rahuls]));
    // Another team sees neither.
    expect(viewAs(data, 'demo-priya').techRequests.some(r => [...zoyas, ...rahuls].includes(r.id))).toBe(false);
  });

  it('marks who leads a team, and clears it when the person moves to the tech team', () => {
    let data = demo();
    const admin = data.currentUser;
    data = mutateDemo(data, { action: 'createMember', name: 'Ira Sen', email: 'ira@example.com', role: 'requester', capacity: 33, departmentId: 'demo-team-1', isTeamLead: false }, admin);
    let ira = data.members.find(m => m.email === 'ira@example.com')!;
    expect(roleLabel(data, ira)).toBe('Sales team');
    data = mutateDemo(data, { action: 'updateMember', id: ira.id, patch: { isTeamLead: true } }, admin);
    ira = data.members.find(m => m.id === ira.id)!;
    // A team can have more than one lead.
    expect(data.members.filter(m => m.departmentId === 'demo-team-1' && m.isTeamLead).map(m => m.name)).toEqual(['Priya Kapoor', 'Ira Sen']);
    expect(roleLabel(data, ira)).toBe('Sales team lead');
    data = mutateDemo(data, { action: 'updateMember', id: ira.id, patch: { role: 'developer', capacity: 33 } }, admin);
    expect(data.members.find(m => m.id === ira.id)).toMatchObject({ role: 'developer', departmentId: null, isTeamLead: false });
    expect(() => mutateDemo(data, { action: 'updateMember', id: ira.id, patch: { isTeamLead: true } }, admin)).toThrow('Only someone in a team outside tech can lead it.');
    // A developer added from the Team page never leads another team.
    data = mutateDemo(data, { action: 'createMember', name: 'Dev Rao', email: 'dev@example.com', role: 'developer', capacity: 33, isTeamLead: true }, admin);
    expect(data.members.find(m => m.email === 'dev@example.com')).toMatchObject({ departmentId: null, isTeamLead: false });
    expect(roleLabel(data, { ...ira, role: 'requester', departmentId: null, isTeamLead: false })).toBe('No team yet');
  });
});
