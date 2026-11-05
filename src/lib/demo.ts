import type { Activity, DashboardData, Department, DueDateRequest, Member, Phase, Project, TechRequest, TicketRequest, WorkItem } from './types';
import { dateKey, defaultSettings, getWeekStart, localDate, shiftDate } from './kpi';
import { ADHOC_PROJECT } from './project-defaults';

/** Read-only sample data for /demo. This function never writes to the database. */
export function createDemoData(now = new Date()): DashboardData {
  const timezone = 'Asia/Kolkata';
  const week = getWeekStart(now, timezone);
  const today = dateKey(now, timezone);
  const dateAt = (day: number, time = '12:00', weekOffset = 0) => localDate(shiftDate(week, day + weekOffset * 7, timezone), time, timezone).toISOString();
  const lead: Member = { id: 'demo-lead', name: 'Rohan Desai', email: 'rohan@example.com', role: 'admin', image: null, capacity: 10, isActive: true };
  const developers: Member[] = [
    ['aarav', 'Aarav Mehta'], ['ananya', 'Ananya Rao'], ['vivaan', 'Vivaan Shah'],
    ['ishita', 'Ishita Nair'], ['arjun', 'Arjun Patil'], ['sanya', 'Sanya Gupta'], ['kabir', 'Kabir Sethi'],
  ].map(([id, name]) => ({ id: `demo-${id}`, name, email: `${id}@example.com`, role: 'developer', image: null, capacity: 33, isActive: true }));
  const day = (offset: number) => shiftDate(week, offset, timezone);
  // Each project shows a different timeline story: extended once, on track, extended twice and behind, and long-running.
  const projects: Project[] = [
    { id: 'demo-commerce', name: 'Commerce', color: '#ea6e3d', description: 'Storefront, checkout, payments and the order experience.', isArchived: false, isAdhoc: false, primaryMemberId: developers[0].id, memberIds: [developers[0].id, developers[4].id], startDate: day(-49), targetDate: day(11), originalTargetDate: day(4) },
    { id: 'demo-inventory', name: 'Inventory management', color: '#618f7a', description: 'Stock accuracy, warehouse operations and dispatch.', isArchived: false, isAdhoc: false, primaryMemberId: developers[1].id, memberIds: [developers[1].id, developers[5].id, lead.id], startDate: day(-49), targetDate: day(9), originalTargetDate: day(9) },
    { id: 'demo-creators', name: 'Creator marketplace', color: '#8b79af', description: 'Creator onboarding, campaigns and payouts.', isArchived: false, isAdhoc: false, primaryMemberId: developers[2].id, memberIds: [developers[2].id, developers[6].id], startDate: day(-42), targetDate: day(4), originalTargetDate: day(-10) },
    { id: 'demo-internal', name: 'Internal tools', color: '#6a91b6', description: 'PnL reporting, content operations and team tools.', isArchived: false, isAdhoc: false, primaryMemberId: developers[3].id, memberIds: [developers[3].id, lead.id], startDate: day(-35), targetDate: day(39), originalTargetDate: day(39) },
    { ...ADHOC_PROJECT, memberIds: [] },
  ];
  const phaseNames = [
    [['Checkout experience', 'Address, cart, and order review screens.'], ['Payments reliability', 'Payment callbacks, retries, and refunds.'], ['Storefront performance', '']],
    [['Stock accuracy', 'Counts that match the warehouse.'], ['Imports & mapping', 'Supplier files and SKU mapping.'], ['Warehouse dispatch', '']],
    [['Discovery & onboarding', 'Finding creators and signing them up.'], ['Campaign workflows', ''], ['Payout reconciliation', 'Match payouts to approved work.']],
    [['Reporting foundations', 'PnL and margin reports.'], ['Content operations', ''], ['Team workflows', 'Tools the team uses every day.']],
  ];
  const projectPhases: Phase[][] = phaseNames.map((names, projectIndex) => names.map(([name, description], position) => ({
    id: `${projects[projectIndex].id}-phase-${position + 1}`, projectId: projects[projectIndex].id, name, description, position,
  })));
  const phases = projectPhases.flat();
  function phaseForTitle(projectIndex: number, title: string): string {
    const lower = title.toLowerCase();
    const position = projectIndex === 0 ? /payment|callback/.test(lower) ? 1 : /cart|product page|storefront|discount/.test(lower) ? 2 : 0
      : projectIndex === 1 ? /sku|import|mapping/.test(lower) ? 1 : /dispatch|pick-list|export/.test(lower) ? 2 : 0
      : projectIndex === 2 ? /payout|fee/.test(lower) ? 2 : /campaign|budget|brief/.test(lower) ? 1 : 0
      : /cms|publishing|content/.test(lower) ? 1 : /revenue|margin|pnl|reporting|month/.test(lower) ? 0 : 2;
    return projectPhases[projectIndex][position].id;
  }
  let sequence = 0;
  const items: WorkItem[] = [];
  const addTask = (title: string, developerIndex: number, projectIndex: number, hours: number, status: WorkItem['status'], dueDay = 2, description = '', weekOffset = 0, blocker: string | null = null) => {
    sequence++;
    const completed = status === 'done' ? dateAt(Math.min(dueDay, 4), '12:00', weekOffset) : null;
    const finished = !!completed && new Date(completed) <= now;
    const item: WorkItem = {
      id: `demo-task-${sequence}`, key: `UG-${String(sequence).padStart(3, '0')}`, type: 'task', title,
      description: description || 'Confirm the acceptance criteria with the project owner, implement the change, and submit it for review.',
      projectId: projects[projectIndex].id, phaseId: phaseForTitle(projectIndex, title), assigneeId: developers[developerIndex].id,
      status: status === 'done' && !finished ? 'in_progress' : status, priority: status === 'blocked' ? 'high' : 'medium', severity: 'normal',
      estimateHours: hours, dueDate: day(dueDay + weekOffset * 7), originalDueDate: day(dueDay + weekOffset * 7),
      createdAt: dateAt(0, '10:00', weekOffset), updatedAt: finished && completed ? completed : dateAt(0, '11:00', weekOffset),
      startedAt: status === 'todo' ? null : dateAt(0, '10:30', weekOffset), completedAt: finished ? completed : null,
      fixedAt: null, reportedAt: dateAt(0, '10:00', weekOffset), blocker, taskId: null, reopenCount: 0,
    };
    items.push(item);
    return item;
  };

  addTask('Simplify the checkout address form', 0, 0, 8, 'in_review', 1, 'Remove duplicate address fields, preserve saved addresses, and test checkout on a phone.');
  addTask('Add retry handling for failed payment callbacks', 0, 0, 12, 'in_progress', 3);
  addTask('Show order status on the customer account page', 0, 0, 6, 'done', 0);
  addTask('Add a low-stock alert to the warehouse view', 1, 1, 10, 'in_progress', 2);
  addTask('Reconcile stock counts with the dispatch export', 1, 1, 8, 'done', 0);
  addTask('Validate SKU mapping in the import flow', 1, 1, 5, 'todo', 4);
  addTask('Finish creator payout reconciliation', 2, 2, 12, 'blocked', 1, 'Match payout batches to approved campaign deliverables.', 0, 'Waiting for the finance team to confirm the payout export columns.');
  addTask('Improve campaign filters for creator discovery', 2, 2, 6, 'done', 0);
  addTask('Add campaign budget limits', 2, 2, 8, 'todo', 4);
  addTask('Add a payout dispute workflow', 2, 2, 12, 'todo', 4);
  addTask('Add a campaign performance report', 6, 2, 10, 'todo', 4);
  addTask('Match creator payouts to tax forms', 6, 2, 14, 'todo', 4);
  addTask('Add revenue filters to the PnL dashboard', 3, 3, 10, 'in_review', 2);
  addTask('Fix rounding in monthly margin totals', 3, 3, 8, 'done', 0);
  addTask('Add product image checks to CMS publishing', 3, 3, 6, 'todo', 3);
  addTask('Make cart quantity updates feel instant', 4, 0, 8, 'in_progress', 2);
  addTask('Reduce product page image loading time', 4, 0, 6, 'done', 0);
  addTask('Test discount combinations at checkout', 4, 0, 5, 'todo', 4);
  addTask('Add an audit trail for stock adjustments', 5, 1, 12, 'in_progress', 3);
  addTask('Improve the warehouse pick-list export', 5, 1, 8, 'done', 0);
  addTask('Add campaign brief templates', 6, 2, 10, 'in_review', 1);
  addTask('Improve creator onboarding validation', 6, 2, 8, 'in_progress', 4);
  // Approvals earlier this week, so mid-week scores show a realistic mix rather than all zeros.
  addTask('Add saved card selection at checkout', 0, 0, 10, 'done', 1);
  addTask('Log payment callback failures with order IDs', 0, 0, 6, 'done', 3);
  addTask('Show stock history on the SKU page', 1, 1, 12, 'done', 2);
  addTask('Add creator search by follower count', 2, 2, 8, 'done', 1);
  addTask('Export monthly margin report to CSV', 3, 3, 14, 'done', 2);
  addTask('Cache product page images at the edge', 4, 0, 12, 'done', 1);
  addTask('Show discount savings in the cart', 4, 0, 5, 'done', 3);
  addTask('Add barcode scan to the dispatch screen', 5, 1, 10, 'done', 2);
  addTask('Add campaign brief preview for creators', 6, 2, 9, 'done', 1);

  // These actual sample completion records drive the trend. No chart values are hard-coded.
  // Rows run from last week backwards: a steady climb with one dip, so the trend has a story to tell.
  const previousHours = [[30, 28, 24, 33, 29, 31, 26], [27, 30, 28, 31, 34, 25, 30], [28, 26, 25, 30, 27, 29, 24], [22, 20, 18, 24, 21, 19, 17], [26, 24, 22, 27, 25, 23, 21], [24, 22, 20, 25, 23, 21, 19]];
  const historyTitles = ['Checkout improvements', 'Warehouse stock reconciliation', 'Campaign payout improvements', 'PnL reporting improvements', 'Storefront performance work', 'Dispatch workflow improvements', 'Creator onboarding improvements'];
  previousHours.forEach((hours, offset) => hours.forEach((estimate, developerIndex) => {
    addTask(`${historyTitles[developerIndex]} · part ${previousHours.length - offset}`, developerIndex, [0, 1, 2, 3, 0, 1, 2][developerIndex], estimate, 'done', 4, 'Completed sample work from a previous week. The estimate is the credited delivery.', -(offset + 1));
  }));

  const addBug = (title: string, developerIndex: number, projectIndex: number, critical: boolean, reported: string, fixed: string | null, status: WorkItem['status'] = 'open', blocker: string | null = null) => {
    sequence++;
    const effectiveReported = new Date(reported) > now ? now.toISOString() : reported;
    const effectiveFixed = fixed && new Date(fixed) <= now ? fixed : null;
    const linkedTask = projectIndex === 0 ? items.find(item => item.type === 'task' && item.projectId === projects[projectIndex].id && item.assigneeId === developers[developerIndex].id) : null;
    items.push({
      id: `demo-bug-${sequence}`, key: `UG-${String(sequence).padStart(3, '0')}`, type: 'bug', title,
      description: 'Reproduce the issue, fix the cause, and add the steps used to verify the result.', projectId: projects[projectIndex].id, phaseId: linkedTask?.phaseId ?? phaseForTitle(projectIndex, title),
      assigneeId: developers[developerIndex].id, status: fixed && !effectiveFixed ? 'open' : status,
      priority: critical ? 'urgent' : 'high', severity: critical ? 'critical' : 'normal', estimateHours: 0, dueDate: null, originalDueDate: null,
      createdAt: effectiveReported, updatedAt: effectiveFixed || effectiveReported, startedAt: null, completedAt: null,
      fixedAt: effectiveFixed, reportedAt: effectiveReported, blocker,
      taskId: linkedTask?.id ?? null, reopenCount: blocker ? 1 : 0,
    });
  };
  addBug('Checkout fails for a saved address', 0, 0, true, localDate(today, '10:00', timezone).toISOString(), null, 'in_progress');
  addBug('Stock import creates duplicate SKU rows', 1, 1, false, dateAt(4, '17:00', -1), null);
  addBug('Creator payout total misses the platform fee', 2, 2, true, dateAt(0, '17:00'), null);
  addBug('PnL date filter uses the wrong month boundary', 3, 3, false, dateAt(4, '17:00', -1), dateAt(0, '13:00'), 'verified');
  addBug('Coupon is applied twice on a cart refresh', 4, 0, true, dateAt(0, '11:00'), dateAt(0, '18:00'), 'fixed');
  addBug('Dispatch export drops one warehouse column', 5, 1, true, dateAt(4, '11:00', -1), null, 'open', 'Reopened after verification. The original report time still applies.');

  const activities: Activity[] = items.flatMap((item): Activity[] => {
    const entries: Activity[] = [{ id: `${item.id}-created`, entityId: item.id, actorId: lead.id, action: item.type === 'task' ? 'task.created' : 'bug.reported', reason: null, payload: { estimateHours: item.estimateHours, dueDate: item.dueDate, severity: item.severity }, createdAt: item.createdAt }];
    if (item.type === 'task' && item.status !== 'todo') entries.push({ id: `${item.id}-started`, entityId: item.id, actorId: item.assigneeId, action: 'task.status_changed', reason: null, payload: { from: 'todo', to: 'in_progress' }, createdAt: item.startedAt || item.createdAt });
    if (item.completedAt) entries.push({ id: `${item.id}-done`, entityId: item.id, actorId: lead.id, action: 'task.completed', reason: null, payload: { creditedHours: item.estimateHours }, createdAt: item.completedAt });
    if (item.fixedAt) entries.push({ id: `${item.id}-fixed`, entityId: item.id, actorId: item.assigneeId, action: 'bug.fixed', reason: null, payload: {}, createdAt: item.fixedAt });
    if (item.blocker) entries.push({ id: `${item.id}-blocked`, entityId: item.id, actorId: item.assigneeId, action: item.type === 'bug' ? 'bug.reopened' : 'task.status_changed', reason: item.blocker, payload: { from: 'in_progress', to: 'blocked' }, createdAt: item.updatedAt });
    return entries;
  });

  const past = (iso: string) => new Date(Math.min(Date.parse(iso), now.getTime())).toISOString();
  // One sample ticket extension, so the demo shows how a moved due date looks.
  const extended = items.find(item => item.title === 'Add retry handling for failed payment callbacks');
  if (extended?.dueDate) {
    extended.originalDueDate = shiftDate(extended.dueDate, -2, timezone);
    activities.push({
      id: `${extended.id}-extended`, entityId: extended.id, actorId: extended.assigneeId, action: 'task.due_changed',
      reason: 'The payment provider sandbox was down for a day.', payload: { from: extended.originalDueDate, to: extended.dueDate, reasonCategory: 'blocked_dependency' },
      createdAt: past(dateAt(1, '15:00')),
    });
  }
  // Project target moves. Each one needed a reason, like a ticket extension.
  const projectMove = (project: Project, from: string, to: string, reason: string, reasonCategory: string, at: string, suffix = '1') => activities.push({
    id: `${project.id}-target-${suffix}`, entityId: project.id, actorId: lead.id, action: 'project.target_changed', reason, payload: { from, to, reasonCategory }, createdAt: past(at),
  });
  projectMove(projects[0], day(4), day(11), 'The payment provider changed its callback format. Retries need a second pass.', 'scope_change', dateAt(1, '11:30'));
  projectMove(projects[2], day(-10), day(-3), 'Finance has not confirmed the payout export columns yet.', 'blocked_dependency', dateAt(-12, '16:00'), '1');
  projectMove(projects[2], day(-3), day(4), 'Payout reconciliation took longer than planned. Two edge cases need fixing.', 'underestimated', dateAt(-4, '12:00'), '2');
  for (const project of projects.filter(p => p.startDate)) activities.push({
    id: `${project.id}-created`, entityId: project.id, actorId: lead.id, action: 'project.created', reason: null,
    payload: { name: project.name, startDate: project.startDate, targetDate: project.originalTargetDate }, createdAt: localDate(project.startDate!, '10:00', timezone).toISOString(),
  });

  // Two requests wait for the admin. One was declined with a reason, so a developer sees what to change.
  const requests: TicketRequest[] = [
    { id: 'demo-request-1', requesterId: developers[0].id, title: 'Add UPI autopay to checkout', description: 'Offer UPI autopay for subscription orders, with a fallback to card.', note: 'Three support tickets this week asked for it.',
      projectId: projects[0].id, phaseId: null, estimateHours: 10, dueDate: day(9), priority: 'high', status: 'pending', reviewedById: null, reviewedAt: null, reviewNote: null, itemId: null, createdAt: past(dateAt(0, '10:20')) },
    { id: 'demo-request-2', requesterId: developers[1].id, title: 'Low-stock email digest for warehouse leads', description: 'A morning email listing SKUs below their reorder level.', note: '',
      projectId: projects[1].id, phaseId: null, estimateHours: 6, dueDate: null, priority: 'medium', status: 'pending', reviewedById: null, reviewedAt: null, reviewNote: null, itemId: null, createdAt: past(dateAt(-1, '16:05')) },
    { id: 'demo-request-3', requesterId: developers[3].id, title: 'Rebuild the PnL report charts', description: 'Move every PnL chart to the new charting library.', note: 'The old charts are slow on large months.',
      projectId: projects[3].id, phaseId: null, estimateHours: 30, dueDate: null, priority: 'low', status: 'declined', reviewedById: lead.id, reviewedAt: past(dateAt(-2, '12:00')), reviewNote: 'Too large for one ticket. Split it into the export and the chart work, then request each.', itemId: null, createdAt: past(dateAt(-3, '11:00')) },
  ];

  // One developer asks for 3 more hours. The estimate and due date change only when the admin approves.
  const lowStock = items.find(item => item.title === 'Add a low-stock alert to the warehouse view' && item.dueDate)!;
  const dueDateRequests: DueDateRequest[] = [
    { id: 'demo-extension-1', itemId: lowStock.id, requesterId: lowStock.assigneeId, fromDate: lowStock.dueDate!, fromEstimate: lowStock.estimateHours, hours: 3, approvedHours: null, reasonCategory: 'scope_change',
      reason: 'The warehouse team added a second alert threshold for slow-moving SKUs.', status: 'pending', reviewedById: null, reviewedAt: null, reviewNote: null, createdAt: past(dateAt(0, '09:40')) },
  ];
  activities.push({ id: 'demo-extension-1-asked', entityId: lowStock.id, actorId: lowStock.assigneeId, action: 'task.due_change_requested', reason: dueDateRequests[0].reason,
    payload: { requestId: 'demo-extension-1', from: dueDateRequests[0].fromDate, hours: 3, reasonCategory: 'scope_change' }, createdAt: dueDateRequests[0].createdAt });

  // Other teams raise requests. Some wait for the admin, some became tickets at different stages, and one was declined.
  const departments: Department[] = ['Sales', 'E-commerce', 'Influencer marketing', 'Digital marketing', 'Creative', 'Graphics']
    .map((name, position) => ({ id: `demo-team-${position + 1}`, name, position, isArchived: false }));
  const team = (name: string) => departments.find(department => department.name === name)!.id;
  // Each team has a lead. E-commerce also has a member, who raises requests too.
  const requesters: Member[] = ([
    ['priya', 'Priya Kapoor', 'Sales', true], ['rahul', 'Rahul Verma', 'E-commerce', true], ['zoya', 'Zoya Khan', 'E-commerce', false], ['tanvi', 'Tanvi Shah', 'Influencer marketing', true],
    ['neha', 'Neha Joshi', 'Digital marketing', true], ['meera', 'Meera Iyer', 'Creative', true],
  ] as const).map(([id, name, department, isTeamLead]) => ({ id: `demo-${id}`, name, email: `${id}@example.com`, role: 'requester', image: null, capacity: 33, isActive: true, departmentId: team(department), isTeamLead }));
  const requester = (id: string) => requesters.find(person => person.id === `demo-${id}`)!;
  let requestNumber = 0;
  const techRequests: TechRequest[] = [];
  const addRequest = (id: string, title: string, description: string, category: TechRequest['category'], priority: TechRequest['priority'], raised: string, neededBy: string | null, outcome?: { itemTitle?: string; declined?: string; note?: string }) => {
    const person = requester(id);
    const item = outcome?.itemTitle ? items.find(row => row.title === outcome.itemTitle) : undefined;
    const reviewedAt = item || outcome?.declined ? past(new Date(Date.parse(raised) + 3 * 3_600_000).toISOString()) : null;
    techRequests.push({
      id: `demo-tech-request-${++requestNumber}`, key: `REQ-${String(requestNumber).padStart(3, '0')}`, requesterId: person.id, requesterName: person.name, departmentId: person.departmentId!,
      title, description, category, priority, neededBy, status: item ? 'assigned' : outcome?.declined ? 'declined' : 'new',
      reviewedById: reviewedAt ? lead.id : null, reviewedAt, reviewNote: outcome?.declined ?? outcome?.note ?? null, itemId: item?.id ?? null,
      work: item ? { key: item.key, type: item.type, status: item.status, assigneeId: item.assigneeId, assigneeName: developers.find(d => d.id === item.assigneeId)?.name ?? 'A developer', dueDate: item.dueDate, doneAt: item.completedAt ?? item.fixedAt } : null,
      createdAt: past(raised), updatedAt: past(reviewedAt ?? raised),
    });
  };
  addRequest('rahul', 'Show customers how much they save in the cart', 'Customers ask how much a coupon saved them. Show the total saving under the cart total, on mobile and desktop.', 'feature', 'medium', dateAt(2, '11:00', -1), null,
    { itemTitle: 'Show discount savings in the cart', note: 'Arjun takes this one.' });
  addRequest('meera', 'Let us upload homepage banners ourselves', 'Every banner change needs a developer today. We want to upload and schedule homepage banners without waiting.', 'feature', 'medium', dateAt(3, '15:20', -1), null,
    { declined: 'The CMS already has banner uploads with scheduling. Rohan will show your team how on Friday.' });
  addRequest('tanvi', 'Templates for creator campaign briefs', 'We write every brief from scratch. Three templates would help: product launch, festive sale, and always-on.', 'feature', 'high', dateAt(4, '10:30', -1), day(3),
    { itemTitle: 'Add campaign brief templates' });
  addRequest('zoya', 'Cart feels slow when changing quantity', 'Changing the quantity in the cart takes two to three seconds on mobile. Customers tap twice and get the wrong quantity.', 'problem', 'high', dateAt(4, '12:10', -1), null,
    { itemTitle: 'Make cart quantity updates feel instant' });
  addRequest('tanvi', 'Campaign performance report per creator', 'Views, clicks, and orders for each creator in a campaign, so we can decide whom to work with again.', 'data', 'medium', dateAt(0, '09:30'), day(9),
    { itemTitle: 'Add a campaign performance report' });
  addRequest('neha', 'Add the Meta pixel to the new landing page', 'The Diwali landing page goes live on Monday. Ads need the Meta pixel and the purchase event on it before then.', 'change', 'urgent', dateAt(1, '10:45'), day(4));
  addRequest('priya', 'Bulk order form for corporate gifting', 'Companies ask for 50 to 500 gift boxes. We need a form on the website that collects company, quantity, budget, and delivery date, and emails the sales team.', 'feature', 'high', dateAt(2, '11:15'), day(11));

  return {
    currentUser: lead, members: [lead, ...developers, ...requesters], departments, techRequests, projects, phases, items, requests, dueDateRequests, activities,
    leaves: [
      { id: 'demo-leave-1', userId: developers[2].id, date: shiftDate(week, 1, timezone), type: 'half_day', note: 'Personal appointment' },
      { id: 'demo-leave-2', userId: developers[5].id, date: shiftDate(week, 4, timezone), type: 'full_day', note: 'Planned leave' },
    ],
    holidays: [],
    settings: { ...defaultSettings, trackingStartDate: day(-7 * previousHours.length) },
    mode: 'demo',
  };
}

export const getDemoData = createDemoData;
