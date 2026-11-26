"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { toast } from 'sonner';
import { ArrowDownToLine, ArrowRight, Bell, Briefcase, Bug, Building2, CalendarDays, CalendarPlus, ChevronLeft, ChevronRight, ClipboardCheck, Coffee, Contact, Eye, FolderKanban, FolderPlus, History, Inbox, LayoutDashboard, ListTodo, Plus, RotateCcw, Search, Settings2, UserPlus, Users, UsersRound } from 'lucide-react';
import type { DashboardData, Project, TechRequest, WorkItem } from '@/lib/types';
import { can, isOrgAdmin, leadsWork } from '@/lib/permissions';
import { calculateTeamKpi, getWeekStart, shiftDate } from '@/lib/kpi';
import { Avatar, EmptyState, FormSelect, Kbd, Panel, StatusIcon } from '@/components/ui';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuShortcut, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Sidebar, SidebarContent, SidebarFooter, SidebarGroup, SidebarGroupContent, SidebarGroupLabel, SidebarHeader, SidebarInset, SidebarMenu, SidebarMenuBadge, SidebarMenuButton, SidebarMenuItem, SidebarProvider, SidebarTrigger, useSidebar } from '@/components/ui/sidebar';
import { ThemeToggle } from '@/components/theme-toggle';
import { calculateMemberKpi } from '@/lib/kpi';
import { canOpen, isSection, type Section } from '@/lib/sections';
import { attentionItems, bands, DEMO_DATA_KEY, demoSnapshot, demoViewer, displayDate, findMember, firstName, isDone, mutateDemo, OPEN_PARAM, REQUEST_PARAM, roleLabel, roleNames, routeFor, saveDemo, setDemoViewer, statusLabels, subscribeDemo, viewAs, downloadCsv, type ModalState, type Mutation, type MutationFn, type QuickAction, type RequestActionKind } from './lib';
import { Dashboard } from './dashboard';
import { Approvals } from './approvals';
import { LeavePage } from './leave';
import { MyRequests, RequestActionForm, RequestDrawer, RequestInbox, TechRequestForm } from './requests';
import { People } from './people';
import { ActivityLog } from './activity';
import { OrgOverview } from './org-overview';
import { DepartmentForm, OtherTeams } from './other-teams';
import { WorkList } from './work-list';
import { Standup } from './standup';
import { Team } from './team';
import { Projects } from './projects';
import { SettingsPage } from './settings';
import { Account } from './account';
import { HolidayForm, ItemForm, LeaveForm, MemberForm, ProjectForm, ReasonForm, TeamTicketForm } from './forms';
import { ItemDrawer } from './item-drawer';
import { ProjectDrawer } from './project-drawer';
import { ExtendForm } from './timeline';
import { celebrate, dayBrief, greeting } from './engagement';
import { CommandPalette, type PaletteModal } from './command-palette';
import { useSearchShortcut } from './use-choice';

type PageLink = { id: Section; label: string; icon: typeof LayoutDashboard };
/**
 * The menu, in three groups. Each person sees only the pages their role may open (`canOpen`), so the same menu serves
 * someone from Sales, a project manager, a developer, the tech lead, and an admin.
 */
const NAV: { label: string; pages: PageLink[] }[] = [
  { label: 'Workspace', pages: [
    { id: 'dashboard', label: 'Overview', icon: LayoutDashboard },
    { id: 'requests', label: 'Requests', icon: Inbox },
  ] },
  { label: 'Tech team', pages: [
    { id: 'tickets', label: 'Tickets', icon: ListTodo },
    { id: 'bugs', label: 'Bugs', icon: Bug },
    { id: 'approvals', label: 'Approvals', icon: ClipboardCheck },
    { id: 'leave', label: 'Leave', icon: CalendarDays },
    { id: 'standup', label: 'Daily standup', icon: Coffee },
    { id: 'team', label: 'Team', icon: Users },
    { id: 'projects', label: 'Projects', icon: FolderKanban },
  ] },
  { label: 'Organisation', pages: [
    { id: 'people', label: 'People', icon: Contact },
    { id: 'other-teams', label: 'Other teams', icon: Briefcase },
    { id: 'activity', label: 'Activity', icon: History },
  ] },
];

function headings(page: string, data: DashboardData, brief: string): { title: string; description: string } {
  const admin = leadsWork(data.currentUser);
  if (data.currentUser.role === 'requester') {
    const intro = 'Ask the tech team for a new tool, a change, or a fix, and follow each request here until it is done.';
    return page === 'account' ? { title: 'My account', description: 'Your profile and sign-in.' }
      : { title: page === 'requests' ? 'My requests' : greeting(data.currentUser.name, new Date(), data.settings.timezone), description: intro };
  }
  if (data.currentUser.role === 'project_manager') {
    const intro = 'Review what other teams ask for. Ask questions in the comments, correct the details, then forward each request to the tech lead or decline it.';
    return page === 'account' ? { title: 'My account', description: 'Your profile and sign-in.' }
      : { title: page === 'requests' ? 'Requests' : greeting(data.currentUser.name, new Date(), data.settings.timezone), description: intro };
  }
  switch (page) {
    case 'standup': return { title: 'Daily standup', description: 'Go through each developer’s open tickets and add new ones as you talk.' };
    case 'tickets': return admin ? { title: 'Tickets', description: 'Every ticket, who owns it, and its next step.' } : { title: 'My tickets', description: 'Your tickets and their next step. Request a ticket for new work you take on.' };
    case 'bugs': return { title: admin ? 'Bugs' : 'My bugs', description: 'Fix a bug before its fix-by time to earn full bug points.' };
    case 'approvals': return admin
      ? { title: 'Approvals', description: 'Leave requests, ticket requests, asks for more hours, and finished work that wait for you.' }
      : { title: 'Approvals', description: 'The leave, tickets, and hours you asked for, and finished work that waits for your tech lead.' };
    case 'leave': return admin
      ? { title: 'Leave', description: 'Who is away and when. Approve leave requests, and add leave for the team.' }
      : { title: 'My leave', description: 'Request leave, follow your requests, and see every day of leave you took or will take.' };
    case 'requests': return { title: 'Requests', description: 'What Sales, E-commerce, and other teams ask for. Project managers review each request and forward it. Assign forwarded requests to a developer, or decline them with a reason.' };
    case 'team': return { title: 'Team', description: 'The tech team and project managers, their hours at work, leave, and scores.' };
    case 'people': return { title: 'People', description: 'Everyone in the organisation: their role, their team, and their access. Change roles here.' };
    case 'activity': return { title: 'Activity', description: 'Every change across the workspace, newest first: who did what, when, and why.' };
    case 'other-teams': return { title: 'Other teams', description: 'Teams outside tech, such as Sales, and the people in them. Everyone you add to a team signs in with their Microsoft work account and raises requests for it.' };
    case 'projects': return { title: 'Projects', description: admin ? 'Projects, their phases, members, and progress.' : 'The projects you work on and their phases.' };
    case 'settings': return { title: 'Settings', description: isOrgAdmin(data.currentUser) ? 'Working hours, score weights, bug targets, and holidays.' : 'Working hours, score weights, bug targets, and holidays for the tech team.' };
    case 'account': return { title: 'My account', description: 'Your profile and sign-in.' };
    default: return { title: greeting(data.currentUser.name, new Date(), data.settings.timezone), description: brief };
  }
}

/** True while someone types in a field, so a single-key shortcut never steals a letter. */
function typing(target: EventTarget | null) {
  return target instanceof HTMLElement && !!target.closest('input, textarea, select, [contenteditable="true"], [role="combobox"], [role="listbox"], [role="menu"]');
}

export function Workspace({ initialData, children }: { initialData: DashboardData; children?: ReactNode }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const router = useRouter();
  const segment = pathname.split('/').filter(Boolean).at(-1) ?? 'dashboard';
  const page = isSection(segment) ? segment : 'dashboard';
  const demo = initialData.mode === 'demo';
  const [liveData, setLiveData] = useState(initialData);
  const savedDemo = useSyncExternalStore(subscribeDemo, () => demoSnapshot(initialData), () => initialData);
  const viewerId = useSyncExternalStore(subscribeDemo, demoViewer, () => null);
  const fullData = demo ? savedDemo : liveData;
  const data = useMemo(() => demo ? viewAs(fullData, viewerId) : fullData, [demo, fullData, viewerId]);
  const [week, setWeek] = useState(getWeekStart(new Date(), initialData.settings.timezone));
  const [modal, setModal] = useState<ModalState>(null);
  const [projectId, setProjectId] = useState<string | null>(null);
  const [quickAction, setQuickAction] = useState<QuickAction | null>(null);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  // Drawers belong to the page they were opened on.
  const [openedOn, setOpenedOn] = useState(pathname);
  if (openedOn !== pathname) { setOpenedOn(pathname); setProjectId(null); }
  const isAdmin = leadsWork(data.currentUser);
  const isRequester = data.currentUser.role === 'requester';
  const isManager = data.currentUser.role === 'project_manager';
  // Requesters and project managers work with requests only. They have no tickets, scores, or search.
  const requestsOnly = isRequester || isManager;
  const scores = useMemo(() => calculateTeamKpi(data, week), [data, week]);
  // The open ticket or bug lives in the address, so its link can be shared and survives a reload.
  const openKey = searchParams.get(OPEN_PARAM);
  const selected = openKey ? data.items.find(i => i.key === openKey) : undefined;
  const selectedProject = data.projects.find(p => p.id === projectId);
  const currentWeek = getWeekStart(new Date(), data.settings.timezone);
  const brief = useMemo(() => page === 'dashboard' && !requestsOnly ? dayBrief(data, isAdmin ? undefined : calculateMemberKpi(data.currentUser, data, currentWeek)) : '', [page, data, isAdmin, requestsOnly, currentWeek]);
  const { title, description } = headings(page, data, brief);
  // A requester's workspace is their requests and their account; a project manager's, every team's requests.
  // The Requests page is the inbox for project managers and the tech lead, so developers do not see it.
  const blocked = !canOpen(page, data.currentUser.role);
  // The open request also lives in the address. Anyone who can see it opens the same details, from any page.
  const requestKey = searchParams.get(REQUEST_PARAM);
  const selectedRequest = requestKey ? data.techRequests.find(r => r.key === requestKey) : undefined;
  // The list keeps its filters while a ticket opens and closes, so the open ticket is not part of its identity.
  const listQuery = useMemo(() => { const params = new URLSearchParams(searchParams.toString()); params.delete(OPEN_PARAM); return params.toString(); }, [searchParams]);

  const openItem = useCallback((id: string | null) => {
    const item = id ? data.items.find(i => i.id === id) : undefined;
    const params = new URLSearchParams(window.location.search);
    if (item) params.set(OPEN_PARAM, item.key); else params.delete(OPEN_PARAM);
    // A ticket opened from a request replaces the request's panel.
    if (item) params.delete(REQUEST_PARAM);
    const query = params.toString();
    window.history.replaceState(null, '', `${window.location.pathname}${query ? `?${query}` : ''}`);
  }, [data.items]);
  const openRequest = useCallback((request: TechRequest | null) => {
    const params = new URLSearchParams(window.location.search);
    if (request) { params.set(REQUEST_PARAM, request.key); params.delete(OPEN_PARAM); } else params.delete(REQUEST_PARAM);
    const query = params.toString();
    window.history.replaceState(null, '', `${window.location.pathname}${query ? `?${query}` : ''}`);
  }, []);
  const actOnRequest = useCallback((kind: RequestActionKind, request: TechRequest) => setModal({ type: 'requestAction', kind, request }), []);

  // Each save returns the whole workspace. Only the newest answer is applied, so a slow reply never undoes a later change.
  const latestRequest = useRef(0);
  const pending = useRef(0);
  // The first page load counts as a refresh, so focusing the window right away does not fetch again.
  const lastRefresh = useRef(0);
  const refresh = useCallback(async () => {
    if (demo || pending.current > 0 || document.visibilityState !== 'visible') return;
    const request = ++latestRequest.current;
    lastRefresh.current = Date.now();
    try {
      const response = await fetch('/api/data', { cache: 'no-store' });
      if (response.status === 401) { router.push('/login'); return; }
      if (response.ok && request === latestRequest.current && pending.current === 0) setLiveData(await response.json() as DashboardData);
    } catch { /* Offline for a moment. The next refresh tries again. */ }
  }, [demo, router]);
  useEffect(() => {
    if (demo) return;
    lastRefresh.current = Date.now();
    const onFocus = () => { if (Date.now() - lastRefresh.current > 15_000) void refresh(); };
    const timer = window.setInterval(() => void refresh(), 60_000);
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onFocus);
    return () => { window.clearInterval(timer); window.removeEventListener('focus', onFocus); document.removeEventListener('visibilitychange', onFocus); };
  }, [demo, refresh]);

  /** Saves a change. Optimistic changes show at once and are undone if the server refuses them. */
  const mutate: MutationFn = async (mutation: Mutation, message = 'Saved', options) => {
    const optimistic = !!options?.optimistic;
    const request = ++latestRequest.current;
    pending.current++;
    if (!optimistic) setBusy(true);
    try {
      if (demo) saveDemo(mutateDemo(fullData, mutation, data.currentUser));
      else {
        if (optimistic) {
          setLiveData(previous => { try { return mutateDemo(previous, mutation, data.currentUser); } catch { return previous; } });
          toast.success(message);
        }
        const response = await fetch('/api/data', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(mutation) });
        const body = await response.json();
        if (!response.ok) throw new Error(body.error ?? 'Could not save. Please try again.');
        if (request === latestRequest.current) setLiveData(body as DashboardData);
      }
      if (!optimistic || demo) toast.success(message);
      return true;
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not save. Please try again.');
      if (optimistic && !demo) { pending.current--; await refresh(); pending.current++; }
      return false;
    } finally {
      pending.current--;
      if (!optimistic) setBusy(false);
    }
  };
  /** Moves an item forward. Blocking, sending back, and reopening first ask for a reason. */
  function act(item: WorkItem, status: WorkItem['status']) {
    const reopening = ['done', 'fixed', 'verified'].includes(item.status) && ['in_progress', 'open'].includes(status);
    const sendingBack = item.status === 'in_review' && status === 'in_progress';
    if (status === 'blocked' || reopening || sendingBack) {
      setQuickAction({ item, patch: { status }, requireReason: true, label: status === 'blocked' ? 'Mark as blocked' : reopening ? 'Reopen' : 'Send back for changes' });
      return;
    }
    const owner = item.assigneeId === data.currentUser.id ? 'you' : firstName(findMember(data, item.assigneeId));
    const message = item.status === 'blocked' && status === 'in_progress' ? `${item.key} is unblocked and back in progress.`
      : status === 'done' ? `Ticket ${item.status === 'in_review' ? 'approved' : 'completed'}. +${item.estimateHours} h for ${owner}.`
      : status === 'verified' ? 'Fix verified. Nice catch.' : status === 'fixed' ? 'Marked fixed. Waiting for verification.'
      : status === 'in_review' ? 'Completed. Waiting for tech lead review.' : `Moved to ${statusLabels[status].toLowerCase()}`;
    if (status === 'done' || status === 'verified') celebrate();
    void mutate({ action: 'updateItem', id: item.id, patch: { status } }, message, { optimistic: true });
  }
  function exportScores() {
    downloadCsv([
      ['Week starting', 'Name', 'Role', 'Hours at work', 'Ticket hours done', 'Ticket hours %', 'Bug points', 'Bugs scored', 'Efficiency %', 'Status'],
      ...scores.members.map(s => [week, s.member.name, roleNames[s.member.role], s.capacityHours, s.creditedHours, s.deliveryScore, s.bugScore, s.bugsScored, s.efficiency, bands[s.band]]),
    ], `urban-gabru-scores-${week}.csv`);
    toast.success('Weekly report downloaded');
  }
  const addItem = useCallback((kind: 'task' | 'bug', assigneeId?: string) => setModal({ type: 'item', kind, assigneeId }), []);
  const raiseRequest = useCallback(() => setModal({ type: 'techRequest' }), []);
  const extendTicket = (item: WorkItem) => setModal({ type: 'extend', target: { kind: 'ticket', item } });
  const addHours = (item: WorkItem) => setModal({ type: 'extend', target: { kind: 'ticket', item, hours: true } });
  const extendProject = (project: Project) => setModal({ type: 'extend', target: { kind: 'project', project } });
  const editRequest = useCallback((request: TechRequest) => setModal({ type: 'techRequest', request }), []);
  // Someone from another team is a person with the requester role, so their form is the member form.
  const openModal = (type: PaletteModal) => setModal(type === 'otherTeamMember' ? { type: 'member', role: 'requester' } : { type } as ModalState);
  const searchKey = useSearchShortcut();

  // Shortcuts: ⌘K or Ctrl+K searches everywhere, / searches the list on the page, and C adds a ticket.
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      // Search also works over a ticket's details, but not over a form, so nothing typed is lost.
      if ((event.metaKey || event.ctrlKey) && !event.altKey && event.key.toLowerCase() === 'k') { if (requestsOnly) return; event.preventDefault(); setPaletteOpen(open => open ? false : !document.querySelector('[role="dialog"]:not(.drawer)')); return; }
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey || event.repeat || typing(event.target)) return;
      if (document.querySelector('[role="dialog"], [role="alertdialog"]')) return;
      if (event.key === '/') {
        event.preventDefault();
        const search = document.querySelector<HTMLInputElement>('[data-page-search]');
        if (search) search.focus(); else setPaletteOpen(true);
      } else if (event.key.toLowerCase() === 'c' && !blocked && !isManager) {
        event.preventDefault();
        if (isRequester) raiseRequest(); else addItem('task');
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [addItem, raiseRequest, blocked, isRequester, isManager, requestsOnly]);

  // A developer's new work starts as a request that the tech lead approves.
  const newTicket = <Button onClick={() => addItem('task')} aria-keyshortcuts="C"><Plus data-icon="inline-start" size={17} />{isAdmin ? 'New ticket' : 'Request ticket'}</Button>;
  const newRequest = <Button onClick={raiseRequest} aria-keyshortcuts="C"><Plus data-icon="inline-start" size={17} />Raise a request</Button>;
  const actions: Record<string, ReactNode> = isRequester ? { dashboard: newRequest, requests: newRequest } : isManager ? {} : {
    dashboard: <>{!isAdmin && <Button variant="outline" onClick={() => setModal({ type: 'leave' })}><CalendarPlus data-icon="inline-start" />Request leave</Button>}{isAdmin && <Button variant="outline" onClick={exportScores}><ArrowDownToLine data-icon="inline-start" size={16} />Export report</Button>}{newTicket}</>,
    tickets: newTicket,
    leave: <Button onClick={() => setModal({ type: 'leave' })}><CalendarPlus data-icon="inline-start" />{isAdmin ? 'Add leave' : 'Request leave'}</Button>,
    approvals: !isAdmin && <><Button variant="outline" onClick={() => setModal({ type: 'leave' })}><CalendarPlus data-icon="inline-start" />Request leave</Button>{newTicket}</>,
    standup: newTicket,
    bugs: isAdmin && <Button onClick={() => addItem('bug')}><Plus data-icon="inline-start" size={17} />Log bug</Button>,
    team: <><Button variant="outline" onClick={() => setModal({ type: 'leave' })}><CalendarPlus data-icon="inline-start" size={16} />Add leave</Button><Button variant="outline" onClick={() => setModal({ type: 'teamTicket' })}><UsersRound data-icon="inline-start" size={16} />Team ticket</Button><Button onClick={() => setModal({ type: 'member' })}><Plus data-icon="inline-start" size={17} />Add member</Button></>,
    projects: isAdmin && <Button onClick={() => setModal({ type: 'project' })}><Plus data-icon="inline-start" size={17} />New project</Button>,
    people: <Button onClick={() => setModal({ type: 'member' })}><UserPlus data-icon="inline-start" size={16} />Add person</Button>,
    'other-teams': <><Button variant="outline" onClick={() => setModal({ type: 'department' })}><Plus data-icon="inline-start" size={16} />New team</Button><Button onClick={() => setModal({ type: 'member', role: 'requester' })}><UserPlus data-icon="inline-start" size={16} />Add member</Button></>,
  };
  // Dialogs work on the latest copy of a record, so a refresh never shows stale dates.
  const extendTarget = modal?.type === 'extend' ? modal.target.kind === 'ticket'
    ? (() => { const { item: asked, hours } = modal.target as { item: WorkItem; hours?: boolean }; const item = data.items.find(i => i.id === asked.id); return item ? { kind: 'ticket' as const, item, hours } : null; })()
    : (() => { const project = data.projects.find(p => p.id === (modal.target as { project: Project }).project.id); return project ? { kind: 'project' as const, project } : null; })()
    : null;
  const weekLabel = week === currentWeek ? 'This week' : week < currentWeek ? 'Past week' : 'Future week';

  return <SidebarProvider className="workspace-shell">
    <WorkspaceSidebar data={data} page={page} />
    <SidebarInset className="main-shell">
      <header className="topbar">
        <div className="topbar-start">
          <SidebarTrigger aria-label="Open navigation" className="topbar-trigger" />
          {!requestsOnly && <button type="button" className="search-trigger" onClick={() => setPaletteOpen(true)} aria-keyshortcuts="Meta+K Control+K">
            <Search aria-hidden="true" /><span className="search-trigger-label">Search tickets, bugs, and projects…</span><Kbd className="search-trigger-kbd">{searchKey}</Kbd>
          </button>}
        </div>
        <div className="topbar-end">
          <Badge variant="outline" className="connection-status"><i />{demo ? 'Demo workspace' : 'Live workspace'}</Badge>
          {!blocked && !requestsOnly && <CreateMenu isAdmin={isAdmin} orgAdmin={isOrgAdmin(data.currentUser)} onItem={addItem} onModal={openModal} />}
          <ThemeToggle />
          {!isRequester && <AttentionMenu data={data} onOpen={openItem} />}
          <Link href={routeFor(data, 'account')} aria-label="Open my account" className="topbar-account"><Avatar member={data.currentUser} size="small" /></Link>
        </div>
      </header>
      {demo && <DemoBanner data={fullData} viewerId={data.currentUser.id} />}
      <div className="main-content" key={page}>
        <div className="page-heading">
          <div className="page-heading-text"><h1>{title}</h1>{description && <p>{description}</p>}</div>
          {!blocked && actions[page] && <div className="page-actions">{actions[page]}</div>}
        </div>
        {!blocked && !requestsOnly && ['dashboard', 'standup', 'team'].includes(page) && <div className="period-toolbar">
          <div className="week-control">
            <Button variant="ghost" size="icon-sm" aria-label="Previous week" onClick={() => setWeek(shiftDate(week, -7, data.settings.timezone))}><ChevronLeft size={16} /></Button>
            <span className="period-label"><CalendarDays size={15} aria-hidden="true" /><strong>{displayDate(week)} – {displayDate(shiftDate(week, 6, data.settings.timezone))}</strong></span>
            <Button variant="ghost" size="icon-sm" aria-label="Next week" onClick={() => setWeek(shiftDate(week, 7, data.settings.timezone))}><ChevronRight size={16} /></Button>
          </div>
          <Badge variant={week === currentWeek ? 'secondary' : 'outline'} className="period-badge">{weekLabel}</Badge>
          {week !== currentWeek && <Button variant="link" size="sm" onClick={() => setWeek(currentWeek)}>Back to this week</Button>}
        </div>}
        {blocked ? requestsOnly
          ? <Panel><EmptyState title="This page is for the tech team" description={isRequester ? 'Raise a request, and follow it on My requests.' : 'Review requests from other teams on Requests.'} action={<Button variant="outline" asChild><Link href={routeFor(data, 'requests')}>{isRequester ? 'Go to my requests' : 'Go to requests'}<ArrowRight data-icon="inline-end" /></Link></Button>} /></Panel>
          : <Panel><EmptyState title={['people', 'other-teams', 'activity'].includes(page) ? 'This page is for admins' : 'This page is for the tech lead'} description="Every page you can use is in the menu." action={<Button variant="outline" asChild><Link href={routeFor(data, 'dashboard')}>Go to my overview<ArrowRight data-icon="inline-end" /></Link></Button>} /></Panel>
        : isRequester ? <>
          {(page === 'dashboard' || page === 'requests') && <MyRequests data={data} onRaise={raiseRequest} onOpen={openRequest} onEdit={editRequest} mutate={mutate} busy={busy} />}
          {page === 'account' && <Account data={data} />}
        </> : isManager ? <>
          {(page === 'dashboard' || page === 'requests') && <RequestInbox key={`${data.currentUser.role}?${listQuery}`} data={data} onOpen={openRequest} onAct={actOnRequest} onOpenItem={openItem} busy={busy} />}
          {page === 'account' && <Account data={data} />}
        </> : <>
          {page === 'dashboard' && isAdmin && <OrgOverview data={data} />}
          {page === 'dashboard' && <Dashboard data={data} week={week} scores={scores} onOpen={openItem} onOpenProject={setProjectId} onAction={act} onExtend={extendTicket} onAddHours={addHours} onAdd={addItem} busy={busy} />}
          {(page === 'tickets' || page === 'bugs') && <WorkList key={`${page}?${listQuery}`} data={data} kind={page === 'tickets' ? 'task' : 'bug'} onOpen={openItem} onAction={act} onExtend={extendTicket} onAddHours={addHours} onAdd={addItem} busy={busy} />}
          {page === 'leave' && <LeavePage data={data} mutate={mutate} busy={busy} onAdd={start => setModal({ type: 'leave', userId: start?.userId, days: start?.days })} />}
          {page === 'approvals' && <Approvals data={data} onOpen={openItem} onAction={act} onRequest={() => addItem('task')} mutate={mutate} busy={busy} />}
          {page === 'requests' && <RequestInbox key={`${data.currentUser.role}?${listQuery}`} data={data} onOpen={openRequest} onAct={actOnRequest} onOpenItem={openItem} busy={busy} />}
          {page === 'standup' && <Standup data={data} week={week} onOpen={openItem} onAction={act} onAdd={addItem} mutate={mutate} busy={busy} />}
          {page === 'team' && <Team data={data} week={week} onEdit={m => setModal({ type: 'member', member: m })} onLeave={userId => setModal({ type: 'leave', userId })} mutate={mutate} onOpen={openItem} />}
          {page === 'other-teams' && <OtherTeams data={data} mutate={mutate} busy={busy} onAddMember={departmentId => setModal({ type: 'member', role: 'requester', departmentId })} onEditMember={m => setModal({ type: 'member', member: m })} onTeam={department => setModal({ type: 'department', department })} />}
          {page === 'projects' && <Projects data={data} onEdit={p => setModal({ type: 'project', project: p })} onOpen={setProjectId} onExtend={extendProject} mutate={mutate} />}
          {page === 'people' && <People data={data} onEdit={m => setModal({ type: 'member', member: m })} mutate={mutate} busy={busy} />}
          {page === 'activity' && <ActivityLog data={data} onOpenItem={openItem} onOpenRequest={openRequest} />}
          {page === 'settings' && <SettingsPage key={JSON.stringify(data.settings)} data={data} mutate={mutate} busy={busy} onHoliday={() => setModal({ type: 'holiday' })} />}
          {page === 'account' && <Account data={data} />}
        </>}
        {children}
        <footer className="workspace-footer">{requestsOnly
          ? <><span>Urban Gabru tech workspace · India time (Asia/Kolkata)</span>{isRequester ? <span>Press <Kbd>C</Kbd> to raise a request</span> : <span>Press <Kbd>/</Kbd> to search requests</span>}</>
          : <><span>Urban Gabru tech workspace · {weekLabel === 'This week' ? 'India time (Asia/Kolkata)' : `Showing the week of ${displayDate(week)}`}</span><span>Press <Kbd>{searchKey}</Kbd> to search · <Kbd>C</Kbd> to add a ticket</span></>}</footer>
      </div>
    </SidebarInset>
    {!requestsOnly && <CommandPalette data={data} open={paletteOpen} onOpenChange={setPaletteOpen} onOpenItem={openItem} onOpenProject={setProjectId} onOpenRequest={openRequest} onCreate={kind => addItem(kind)} onModal={openModal} />}
    {modal?.type === 'techRequest' && <TechRequestForm data={data} editing={modal.request && data.techRequests.find(r => r.id === modal.request!.id)} mutate={mutate} onClose={() => setModal(null)} busy={busy} onFilesChanged={() => void refresh()} />}
    {modal?.type === 'requestAction' && (() => { const request = data.techRequests.find(r => r.id === modal.request.id); return request ? <RequestActionForm data={data} kind={modal.kind} request={request} mutate={mutate} busy={busy} onClose={() => setModal(null)} /> : null; })()}
    {selectedRequest && !modal && !selected && <RequestDrawer data={data} request={selectedRequest} mutate={mutate} busy={busy} onClose={() => openRequest(null)} onAct={actOnRequest} onEdit={editRequest} onOpenItem={isRequester ? undefined : openItem} onFilesChanged={() => void refresh()} />}
    {modal?.type === 'item' && <ItemForm data={data} kind={modal.kind} assigneeId={modal.assigneeId} mutate={mutate} onClose={() => setModal(null)} busy={busy} />}
    {modal?.type === 'member' && <MemberForm data={data} editing={modal.member} role={modal.role} departmentId={modal.departmentId} mutate={mutate} onClose={() => setModal(null)} onLeave={userId => setModal({ type: 'leave', userId })} busy={busy} />}
    {modal?.type === 'department' && <DepartmentForm editing={modal.department && data.departments.find(d => d.id === modal.department!.id)} mutate={mutate} onClose={() => setModal(null)} busy={busy} />}
    {modal?.type === 'project' && <ProjectForm data={data} editing={data.projects.find(p => p.id === modal.project?.id) ?? modal.project} mutate={mutate} onClose={() => setModal(null)} onExtend={extendProject} busy={busy} />}
    {modal?.type === 'leave' && <LeaveForm data={data} userId={modal.userId} initialDays={modal.days} mutate={mutate} onClose={() => setModal(null)} busy={busy} />}
    {modal?.type === 'holiday' && <HolidayForm mutate={mutate} onClose={() => setModal(null)} busy={busy} />}
    {modal?.type === 'teamTicket' && <TeamTicketForm data={data} mutate={mutate} onClose={() => setModal(null)} busy={busy} />}
    {extendTarget && <ExtendForm target={extendTarget} data={data} mutate={mutate} onClose={() => setModal(null)} busy={busy} />}
    {selectedProject && !modal && <ProjectDrawer data={data} project={selectedProject} onClose={() => setProjectId(null)} onEdit={() => setModal({ type: 'project', project: selectedProject })} onExtend={() => extendProject(selectedProject)} onOpenItem={id => { setProjectId(null); openItem(id); }} />}
    {selected && !quickAction && !modal && <ItemDrawer item={selected} data={data} busy={busy} onClose={() => openItem(null)} onOpen={openItem} onOpenRequest={openRequest} onAction={act} onAddHours={() => addHours(selected)} onExtend={() => extendTicket(selected)} mutate={mutate} />}
    {quickAction && <ReasonForm action={quickAction} busy={busy} mutate={mutate} onClose={() => setQuickAction(null)} />}
  </SidebarProvider>;
}

/** One place to start new work from any page. Each choice opens the same form as the page buttons. */
function CreateMenu({ isAdmin, orgAdmin, onItem, onModal }: { isAdmin: boolean; orgAdmin: boolean; onItem: (kind: 'task' | 'bug') => void; onModal: (type: PaletteModal) => void }) {
  return <DropdownMenu>
    <DropdownMenuTrigger asChild><Button variant="outline" size="icon-sm" aria-label="Create" title="Create"><Plus /></Button></DropdownMenuTrigger>
    <DropdownMenuContent align="end" className="w-56">
      <DropdownMenuLabel>Create</DropdownMenuLabel>
      <DropdownMenuItem onSelect={() => onItem('task')}><ListTodo />{isAdmin ? 'New ticket' : 'Request ticket'}<DropdownMenuShortcut>C</DropdownMenuShortcut></DropdownMenuItem>
      {isAdmin && <>
        <DropdownMenuItem onSelect={() => onItem('bug')}><Bug />Log bug</DropdownMenuItem>
        <DropdownMenuItem onSelect={() => onModal('teamTicket')}><UsersRound />Team ticket</DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => onModal('project')}><FolderPlus />New project</DropdownMenuItem>
        <DropdownMenuItem onSelect={() => onModal('member')}><UserPlus />Add a person</DropdownMenuItem>
        {orgAdmin && <DropdownMenuItem onSelect={() => onModal('otherTeamMember')}><Briefcase />Add someone from another team</DropdownMenuItem>}
        <DropdownMenuItem onSelect={() => onModal('leave')}><CalendarPlus />Add leave</DropdownMenuItem>
      </>}
    </DropdownMenuContent>
  </DropdownMenu>;
}

function WorkspaceSidebar({ data, page }: { data: DashboardData; page: string }) {
  const { setOpenMobile } = useSidebar();
  const me = data.currentUser;
  const lead = leadsWork(me);
  const close = () => setOpenMobile(false);
  const open = data.items.filter(i => !isDone(i));
  // A lead sees everything waiting for a decision. A developer sees their own asks still waiting.
  const pendingAsks = data.requests.filter(r => r.status === 'pending').length + data.dueDateRequests.filter(r => r.status === 'pending').length + (data.leaveRequests ?? []).filter(r => r.status === 'pending').length;
  const waiting = lead ? pendingAsks + data.items.filter(i => i.type === 'task' ? i.status === 'in_review' : i.status === 'fixed').length : pendingAsks;
  // Requests that wait for this person: forwarded ones for a lead, new ones for a project manager, and a requester's own under review.
  const requestCount = lead ? data.techRequests.filter(r => r.status === 'forwarded').length
    : me.role === 'project_manager' ? data.techRequests.filter(r => r.status === 'new').length
    : data.techRequests.filter(r => r.requesterId === me.id && (r.status === 'new' || r.status === 'forwarded')).length;
  const leaveWaiting = (data.leaveRequests ?? []).filter(r => r.status === 'pending' && (lead || r.requesterId === me.id)).length;
  const counts: Partial<Record<Section, number>> = {
    tickets: open.filter(i => i.type === 'task').length, bugs: open.filter(i => i.type === 'bug').length, approvals: waiting, leave: leaveWaiting, requests: requestCount,
  };
  const attention = new Set<Section>(lead ? ['approvals', 'leave', 'requests'] : me.role === 'project_manager' ? ['requests'] : []);
  // A requester's and a project manager's overview is the request list, so the menu shows it once.
  const requestsHome = me.role === 'requester' || me.role === 'project_manager';
  const label = (p: PageLink) => p.id === 'requests' && me.role === 'requester' ? 'My requests' : p.label;
  const link = (p: PageLink) => {
    const Icon = p.icon;
    const n = counts[p.id] ?? 0;
    const active = page === p.id || (requestsHome && p.id === 'requests' && page === 'dashboard');
    return <SidebarMenuItem key={p.id}>
      <SidebarMenuButton asChild isActive={active} tooltip={label(p)}><Link href={routeFor(data, p.id)} onClick={close}><Icon /><span>{label(p)}</span></Link></SidebarMenuButton>
      {n > 0 && <SidebarMenuBadge className={attention.has(p.id) ? 'sidebar-count-attention' : undefined}>{n}</SidebarMenuBadge>}
    </SidebarMenuItem>;
  };
  const groups = NAV.map(group => ({ ...group, pages: group.pages.filter(p => canOpen(p.id, me.role) && !(requestsHome && p.id === 'dashboard')) })).filter(group => group.pages.length);
  return <Sidebar className="app-sidebar" variant="inset" collapsible="offcanvas">
    <SidebarHeader><Link className="brand" href={routeFor(data, requestsHome ? 'requests' : 'dashboard')} onClick={close} aria-label="Urban Gabru workspace"><div>urban<span className="brand-light">gabru</span><small>{requestsHome ? 'Tech requests' : 'Tech workspace'}</small></div></Link></SidebarHeader>
    <SidebarContent>
      {groups.map(group => <SidebarGroup key={group.label}><SidebarGroupLabel>{groups.length === 1 ? 'Requests' : group.label}</SidebarGroupLabel><SidebarGroupContent><SidebarMenu>{group.pages.map(link)}</SidebarMenu></SidebarGroupContent></SidebarGroup>)}
    </SidebarContent>
    <SidebarFooter>
      <SidebarMenu>
        {can(me, 'settings.manage') && <SidebarMenuItem><SidebarMenuButton asChild isActive={page === 'settings'}><Link href={routeFor(data, 'settings')} onClick={close}><Settings2 /><span>Settings</span></Link></SidebarMenuButton></SidebarMenuItem>}
        <SidebarMenuItem><SidebarMenuButton asChild isActive={page === 'account'} className="profile-link h-auto"><Link href={routeFor(data, 'account')} onClick={close}><Avatar member={me} /><div>{me.name}<span>{roleLabel(data, me)}</span></div><ChevronRight size={16} /></Link></SidebarMenuButton></SidebarMenuItem>
      </SidebarMenu>
    </SidebarFooter>
  </Sidebar>;
}

function AttentionMenu({ data, onOpen }: { data: DashboardData; onOpen: (id: string) => void }) {
  const router = useRouter();
  const items = attentionItems(data);
  const admin = leadsWork(data.currentUser);
  const manager = data.currentUser.role === 'project_manager';
  const requests = admin ? data.requests.filter(r => r.status === 'pending').length : 0;
  const extensions = admin ? data.dueDateRequests.filter(r => r.status === 'pending').length : 0;
  // A project manager acts on new requests. The tech lead acts on the ones forwarded to them.
  const teamRequests = admin ? data.techRequests.filter(r => r.status === 'forwarded').length : manager ? data.techRequests.filter(r => r.status === 'new').length : 0;
  const leaveCount = admin ? (data.leaveRequests ?? []).filter(r => r.status === 'pending').length : 0;
  const total = items.length + requests + extensions + teamRequests + leaveCount;
  return <DropdownMenu>
    <DropdownMenuTrigger asChild><Button variant="ghost" size="icon-sm" className="attention-trigger" aria-label={`Needs attention: ${total}`}><Bell size={18} />{total > 0 && <span className="notification-count" aria-hidden="true">{total > 9 ? '9+' : total}</span>}</Button></DropdownMenuTrigger>
    <DropdownMenuContent align="end" className="attention-menu">
      <DropdownMenuLabel className="attention-menu-label">Needs attention{total ? <span className="tab-count">{total}</span> : null}</DropdownMenuLabel>
      <DropdownMenuSeparator />
      {teamRequests > 0 && <DropdownMenuItem onSelect={() => router.push(routeFor(data, 'requests'))} className="attention-menu-item">
        <Inbox className="attention-menu-icon" /><span className="attention-menu-title">{admin ? `${teamRequests} forwarded ${teamRequests === 1 ? 'request waits' : 'requests wait'} for you` : `${teamRequests} new ${teamRequests === 1 ? 'request' : 'requests'} from other teams`}</span><span className="attention-menu-reason">{admin ? 'Assign or decline on Requests' : 'Review and forward on Requests'}</span>
      </DropdownMenuItem>}
      {leaveCount > 0 && <DropdownMenuItem onSelect={() => router.push(routeFor(data, 'leave'))} className="attention-menu-item">
        <CalendarPlus className="attention-menu-icon" /><span className="attention-menu-title">{leaveCount} leave {leaveCount === 1 ? 'request waits' : 'requests wait'} for approval</span><span className="attention-menu-reason">Review on Leave</span>
      </DropdownMenuItem>}
      {requests > 0 && <DropdownMenuItem onSelect={() => router.push(routeFor(data, 'approvals'))} className="attention-menu-item">
        <ClipboardCheck className="attention-menu-icon" /><span className="attention-menu-title">{requests} ticket {requests === 1 ? 'request waits' : 'requests wait'} for approval</span><span className="attention-menu-reason">Review on Approvals</span>
      </DropdownMenuItem>}
      {extensions > 0 && <DropdownMenuItem onSelect={() => router.push(routeFor(data, 'approvals'))} className="attention-menu-item">
        <CalendarPlus className="attention-menu-icon" /><span className="attention-menu-title">{extensions} {extensions === 1 ? 'ask for more hours waits' : 'asks for more hours wait'} for approval</span><span className="attention-menu-reason">Review on Approvals</span>
      </DropdownMenuItem>}
      {total === 0 ? <p className="attention-menu-empty">Nothing needs attention. Nice.</p>
        : items.slice(0, 6).map(({ item, reason }) => <DropdownMenuItem key={item.id} onSelect={() => onOpen(item.id)} className="attention-menu-item">
            <StatusIcon status={item.status} className="attention-menu-icon" /><span className="attention-menu-title"><span className="item-key">{item.key}</span> {item.title}</span><span className="attention-menu-reason">{reason}{admin ? ` · ${firstName(findMember(data, item.assigneeId))}` : ''}</span>
          </DropdownMenuItem>)}
      {items.length > 0 && <><DropdownMenuSeparator /><DropdownMenuItem onSelect={() => router.push(routeFor(data, 'tickets?attention=1'))}>See all tickets that need attention<ArrowRight className="ml-auto" /></DropdownMenuItem></>}
    </DropdownMenuContent>
  </DropdownMenu>;
}

function DemoBanner({ data, viewerId }: { data: DashboardData; viewerId: string }) {
  const people = data.members.filter(m => m.isActive);
  function reset() {
    try { localStorage.removeItem(DEMO_DATA_KEY); } catch { /* Nothing to reset. */ }
    setDemoViewer(null);
    toast.success('Demo reset');
  }
  return <div className="demo-banner">
    <span className="demo-banner-text"><Eye aria-hidden="true" /><strong>Demo</strong><span>Changes stay in this browser.</span></span>
    <span className="demo-viewer"><span>View as</span><FormSelect aria-label="View the demo as" value={viewerId} onValueChange={id => setDemoViewer(id === data.currentUser.id ? null : id)}>{people.map(m => <option key={m.id} value={m.id}>{m.name} · {roleLabel(data, m)}</option>)}</FormSelect></span>
    <span className="demo-banner-actions">
      <Button variant="ghost" size="sm" onClick={reset}><RotateCcw data-icon="inline-start" />Reset</Button>
      <Button variant="link" size="sm" asChild><Link href="/login">Open your workspace<ArrowRight data-icon="inline-end" /></Link></Button>
    </span>
  </div>;
}
