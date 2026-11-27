import { describe, expect, it } from 'vitest';
import { createDemoData } from '@/lib/demo';
import type { TechRequest, WorkItem } from '@/lib/types';
import { mutateDemo, requestPermissions, requestStage, requestWork, roleLabel, viewAs } from '../lib';

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
    expect(requestStage(data, { ...request, status: 'new' })).toBe('with_pm');
    expect(requestStage(data, { ...request, status: 'forwarded' })).toBe('with_lead');
    expect(requestStage(data, { ...request, status: 'declined' })).toBe('declined');
  });

  it('sends a new request straight to the tech lead when the workspace has no project manager', () => {
    const data = { ...demo(), noProjectManager: true };
    const request = data.techRequests.find(r => r.status === 'new')!;
    expect(requestStage(data, request)).toBe('with_lead');
    expect(requestStage(data, { ...request, status: 'forwarded' })).toBe('with_lead');
    // The tech lead can still assign or decline it, and the requester can still change it.
    const lead = data.members.find(m => m.role === 'tech_lead')!;
    expect(requestPermissions({ ...data, currentUser: lead }, request)).toMatchObject({ assign: true, decline: true });
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

  it('files a request under the requester’s own team, refuses anyone without a team, and only the tech lead assigns it', () => {
    let data = demo();
    const priya = data.members.find(m => m.id === 'demo-priya')!;
    // Without a team, nobody can raise a request, so nobody can pick a team and read its requests.
    const noTeam = { ...data, members: data.members.map(m => m.id === 'demo-priya' ? { ...m, departmentId: null } : m) };
    expect(() => mutateDemo(noTeam, { action: 'createTechRequest', ...ask, departmentId: 'demo-team-2' }, { ...priya, departmentId: null })).toThrow('add you to your team');
    expect(() => mutateDemo(data, { action: 'createTechRequest', ...ask, departmentId: 'demo-team-2' }, priya)).toThrow('your own team only');
    data = mutateDemo(data, { action: 'createTechRequest', ...ask, departmentId: 'demo-team-1' }, priya);
    const raised = data.techRequests.find(r => r.title === ask.title)!;
    expect(raised).toMatchObject({ status: 'new', requesterId: 'demo-priya', requesterName: 'Priya Kapoor', key: 'REQ-009', tool: '' });
    expect(raised.departmentId).toBe('demo-team-1');

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
    // People in other teams ask for a new tool or a new feature. A project manager files it as broken when it is.
    expect(() => mutateDemo(data, { action: 'createTechRequest', ...ask, title: 'Checkout button missing', category: 'problem', departmentId: 'demo-team-2' }, rahul)).toThrow('New tool or New feature');
    data = mutateDemo(data, { action: 'createTechRequest', ...ask, title: 'Checkout button missing', category: 'feature', departmentId: 'demo-team-2' }, rahul);
    const broken = data.techRequests.find(r => r.title === 'Checkout button missing')!;
    data = mutateDemo(data, { action: 'editTechRequest', id: broken.id, patch: { category: 'problem' } }, data.members.find(m => m.role === 'project_manager')!);
    data = mutateDemo(data, { action: 'assignTechRequest', id: broken.id, type: 'bug', assigneeId: 'demo-arjun', title: broken.title, projectId: 'demo-commerce', phaseId: null, priority: 'urgent', severity: 'critical' }, data.currentUser);
    const bug = data.items.find(i => i.id === data.techRequests.find(r => r.id === broken.id)!.itemId)!;
    expect(bug).toMatchObject({ type: 'bug', status: 'open', severity: 'critical', estimateHours: 0, dueDate: null });

    data = mutateDemo(data, { action: 'updateDepartment', id: 'demo-team-2', isArchived: true }, data.currentUser);
    expect(() => mutateDemo(data, { action: 'createTechRequest', ...ask, departmentId: 'demo-team-2' }, rahul)).toThrow('no longer takes requests');
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

  it('passes a request from the project manager to the tech lead, and keeps each step in its history', () => {
    let data = demo();
    const priya = data.members.find(m => m.id === 'demo-priya')!;
    const kavya = data.members.find(m => m.id === 'demo-kavya')!;
    const lead = data.currentUser;
    data = mutateDemo(data, { action: 'createTechRequest', ...ask, tool: 'Shopify', departmentId: 'demo-team-1' }, priya);
    const id = data.techRequests.find(r => r.title === ask.title)!.id;
    const now = () => data.techRequests.find(r => r.id === id)!;
    expect(requestStage(data, now())).toBe('with_pm');
    // A project manager cannot assign. They correct the request, then forward it with a note only the tech side reads.
    expect(() => mutateDemo(data, { action: 'assignTechRequest', id, type: 'task', assigneeId: 'demo-aarav', title: ask.title, projectId: 'demo-commerce', phaseId: null, priority: 'medium', estimateHours: 4, dueDate: null }, kavya)).toThrow();
    data = mutateDemo(data, { action: 'editTechRequest', id, patch: { title: 'Size chart under the size picker' } }, kavya);
    data = mutateDemo(data, { action: 'forwardTechRequest', id, priority: 'high', note: 'Finance agreed. Start with the shirts.' }, kavya);
    expect(now()).toMatchObject({ status: 'forwarded', priority: 'high', forwardedById: 'demo-kavya', title: 'Size chart under the size picker' });
    expect(requestStage(data, now())).toBe('with_lead');
    expect(now().comments).toMatchObject([{ body: 'Finance agreed. Start with the shirts.', internal: true, authorRole: 'project_manager' }]);
    // Once forwarded, the requester and the project manager can no longer change it. Comments still work.
    expect(() => mutateDemo(data, { action: 'updateTechRequest', id, patch: { priority: 'urgent' } }, priya)).toThrow('already forwarded');
    expect(() => mutateDemo(data, { action: 'declineTechRequest', id, reason: 'Not now' }, kavya)).toThrow('already forwarded');
    data = mutateDemo(data, { action: 'addRequestComment', requestId: id, body: 'The size chart images are in the shared drive.' }, priya);
    // The tech lead sends it back with a reason, and the project manager forwards it again.
    data = mutateDemo(data, { action: 'returnTechRequest', id, reason: 'Which product types need it?' }, lead);
    expect(now()).toMatchObject({ status: 'new', forwardedById: null, forwardedAt: null });
    data = mutateDemo(data, { action: 'forwardTechRequest', id }, kavya);
    data = mutateDemo(data, { action: 'assignTechRequest', id, type: 'task', assigneeId: 'demo-aarav', title: now().title, projectId: 'demo-commerce', phaseId: null, priority: 'high', estimateHours: 6, dueDate: '2026-11-09', note: 'Aarav starts Monday.' }, lead);
    expect(requestStage(data, now())).toBe('assigned');
    expect(now().history.map(e => e.action)).toEqual(['tech_request.created', 'tech_request.updated', 'tech_request.forwarded', 'tech_request.returned', 'tech_request.forwarded', 'tech_request.assigned']);

    // The requester sees their own words and the public steps, never the tech side's notes.
    const view = viewAs(data, 'demo-priya').techRequests.find(r => r.id === id)!;
    expect(view.comments.map(c => c.body)).toEqual(['The size chart images are in the shared drive.']);
    expect(view.history.map(e => e.action)).toEqual(['tech_request.created', 'tech_request.updated', 'tech_request.forwarded', 'tech_request.forwarded', 'tech_request.assigned']);
    expect(view.history.find(e => e.action === 'tech_request.forwarded')?.note).toBeNull();
    expect(view.history.at(-1)?.note).toBe('Aarav starts Monday.');
  });

  it('lets the tech lead act on a new request when no project manager has reviewed it', () => {
    let data = demo();
    const request = data.techRequests.find(r => r.status === 'new')!;
    const lead = data.currentUser;
    expect(requestPermissions(data, request)).toMatchObject({ assign: true, decline: true, edit: true, sendBack: false });
    expect(() => mutateDemo(data, { action: 'returnTechRequest', id: request.id, reason: 'Check it' }, lead)).toThrow('still with a project manager');
    data = mutateDemo(data, { action: 'declineTechRequest', id: request.id, reason: 'Already possible in the CMS.' }, lead);
    expect(requestStage(data, data.techRequests.find(r => r.id === request.id)!)).toBe('declined');
  });

  it('gives a project manager every team’s requests and nothing from the tech team', () => {
    const data = demo();
    const view = viewAs(data, 'demo-kavya');
    expect(view.currentUser.role).toBe('project_manager');
    expect(view.techRequests.map(r => r.id)).toEqual(data.techRequests.map(r => r.id));
    expect(view).toMatchObject({ items: [], projects: [], leaves: [], requests: [], activities: [] });
    expect(view.members.map(m => m.id)).toEqual(['demo-kavya']);
    // The tech side's notes come along for a project manager.
    expect(view.techRequests.some(r => r.comments.some(c => c.internal))).toBe(true);
    const forwarded = view.techRequests.find(r => r.status === 'forwarded')!;
    const fresh = view.techRequests.find(r => r.status === 'new')!;
    expect(requestPermissions(view, fresh)).toMatchObject({ forward: true, decline: true, edit: true, assign: false, sendBack: false });
    expect(requestPermissions(view, forwarded)).toMatchObject({ forward: false, decline: false, edit: false, assign: false });
    expect(roleLabel(data, view.currentUser)).toBe('Project manager');
  });

  it('keeps tech-side comments from requesters, and lets people remove only their own comments', () => {
    let data = demo();
    const neha = data.members.find(m => m.id === 'demo-neha')!;
    const kavya = data.members.find(m => m.id === 'demo-kavya')!;
    const request = data.techRequests.find(r => r.requesterId === 'demo-neha' && r.comments.length)!;
    expect(viewAs(data, 'demo-neha').techRequests.find(r => r.id === request.id)!.comments.every(c => !c.internal)).toBe(true);
    expect(() => mutateDemo(data, { action: 'addRequestComment', requestId: request.id, body: 'Secret', internal: true }, neha)).toThrow();
    data = mutateDemo(data, { action: 'addRequestComment', requestId: request.id, body: 'Monday 10 am is the launch.' }, neha);
    const added = data.techRequests.find(r => r.id === request.id)!.comments.at(-1)!;
    expect(() => mutateDemo(data, { action: 'deleteRequestComment', id: added.id }, kavya)).toThrow('only your own');
    data = mutateDemo(data, { action: 'deleteRequestComment', id: added.id }, data.currentUser);
    expect(data.techRequests.find(r => r.id === request.id)!.comments.some(c => c.id === added.id)).toBe(false);
  });

  it('keeps a plan as a draft for the tech side, sends it in versions, and lets the requester confirm the one they read', () => {
    let data = demo();
    const kavya = data.members.find(m => m.id === 'demo-kavya')!;
    const neha = data.members.find(m => m.id === 'demo-neha')!;
    const request = data.techRequests.find(r => r.requesterId === 'demo-neha' && r.status === 'forwarded')!;
    const plan = { features: [{ id: 'a', text: 'Meta pixel on the landing page' }, { id: 'b', text: 'Purchase event' }], timeline: [{ id: 't2', title: 'Live', date: '2026-11-09' }, { id: 't1', title: 'Test event', date: '2026-11-06' }], notes: 'Add-to-cart is not included.' };
    data = mutateDemo(data, { action: 'savePlan', id: request.id, plan }, kavya);
    const now = () => data.techRequests.find(r => r.id === request.id)!;
    // The timeline is kept in date order. A draft is not sent, so the requester sees nothing yet.
    expect(now().plan?.timeline.map(t => t.title)).toEqual(['Test event', 'Live']);
    expect(now().sharedPlan).toBeNull();
    expect(viewAs(data, 'demo-neha').techRequests.find(r => r.id === request.id)?.plan).toBeNull();
    expect(() => mutateDemo(data, { action: 'confirmPlan', id: request.id, version: 1 }, neha)).toThrow('no plan');
    data = mutateDemo(data, { action: 'sharePlan', id: request.id, plan, message: 'Please check the dates.' }, kavya);
    expect(now().sharedPlan).toMatchObject({ version: 1, sharedById: 'demo-kavya', confirmedAt: null });
    const nehaView = viewAs(data, 'demo-neha').techRequests.find(r => r.id === request.id)!;
    expect(nehaView.sharedPlan?.features).toHaveLength(2);
    expect(nehaView.history.find(e => e.action === 'tech_request.plan_shared')).toMatchObject({ note: 'Please check the dates.', payload: { version: 1 } });
    // A second version arrives before Neha confirms. Confirming the first one is refused, so nobody agrees to a plan they did not read.
    data = mutateDemo(data, { action: 'sharePlan', id: request.id, plan: { ...plan, notes: 'Add-to-cart comes next month.' } }, kavya);
    expect(() => mutateDemo(data, { action: 'confirmPlan', id: request.id, version: 1 }, neha)).toThrow('newer version');
    expect(() => mutateDemo(data, { action: 'confirmPlan', id: request.id, version: 2 }, kavya)).toThrow();
    data = mutateDemo(data, { action: 'confirmPlan', id: request.id, version: 2 }, neha);
    expect(now().sharedPlan).toMatchObject({ version: 2, confirmedById: 'demo-neha' });
    // Every version stays in the conversation.
    expect(now().history.filter(e => e.action === 'tech_request.plan_shared').map(e => e.payload.version)).toEqual([1, 2]);
    expect(now().history.at(-1)?.action).toBe('tech_request.plan_confirmed');
    expect(() => mutateDemo(data, { action: 'savePlan', id: request.id, plan }, neha)).toThrow();
  });
});

