"use client";

import { useMemo, useState, useSyncExternalStore, type ReactNode } from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { toast } from 'sonner';
import { ArrowDownToLine, ArrowRight, BellDot, Bug, CalendarDays, CalendarPlus, ChevronLeft, ChevronRight, Coffee, Eye, FolderKanban, LayoutDashboard, ListTodo, Plus, RotateCcw, Settings2, Target, Users } from 'lucide-react';
import type { DashboardData, WorkItem } from '@/lib/types';
import { calculateTeamKpi, getWeekStart, shiftDate } from '@/lib/kpi';
import { Avatar, EmptyState, FormSelect, Panel } from '@/components/ui';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from '@/components/ui/breadcrumb';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Separator } from '@/components/ui/separator';
import { Sidebar, SidebarContent, SidebarFooter, SidebarGroup, SidebarGroupContent, SidebarGroupLabel, SidebarHeader, SidebarInset, SidebarMenu, SidebarMenuBadge, SidebarMenuButton, SidebarMenuItem, SidebarProvider, SidebarTrigger, useSidebar } from '@/components/ui/sidebar';
import { ThemeToggle } from '@/components/theme-toggle';
import { adminOnlyPages, attentionItems, bands, DEMO_DATA_KEY, demoSnapshot, demoViewer, displayDate, isDone, mutateDemo, routeFor, saveDemo, setDemoViewer, statusLabels, subscribeDemo, viewAs, downloadCsv, type ModalState, type Mutation, type MutationFn, type QuickAction } from './lib';
import { Dashboard } from './dashboard';
import { WorkList } from './work-list';
import { Standup } from './standup';
import { Team } from './team';
import { Projects } from './projects';
import { SettingsPage } from './settings';
import { Account } from './account';
import { HolidayForm, ItemForm, LeaveForm, MemberForm, ProjectForm, ReasonForm } from './forms';
import { ItemDrawer } from './item-drawer';

const pages = [
  { id: 'dashboard', label: 'Overview', icon: LayoutDashboard },
  { id: 'standup', label: 'Daily standup', icon: Coffee, admin: true },
  { id: 'tickets', label: 'Tickets', icon: ListTodo },
  { id: 'bugs', label: 'Bugs', icon: Bug },
  { id: 'team', label: 'Team', icon: Users, admin: true },
  { id: 'projects', label: 'Projects', icon: FolderKanban },
];

function headings(page: string, admin: boolean): { title: string; description: string } {
  switch (page) {
    case 'standup': return { title: 'Daily standup', description: 'Go through each person’s open tickets and add new ones as you talk.' };
    case 'tickets': return admin ? { title: 'Tickets', description: 'Every ticket, its owner, and its next step.' } : { title: 'My tickets', description: 'Your tickets and their next step. Add a ticket for any work you take on.' };
    case 'bugs': return { title: admin ? 'Bugs' : 'My bugs', description: 'Fix a bug before its fix-by time to earn full bug points.' };
    case 'team': return { title: 'Team', description: 'People, their hours at work, leave, and scores.' };
    case 'projects': return { title: 'Projects', description: admin ? 'Projects, their phases, members, and progress.' : 'The projects you work on and their phases.' };
    case 'settings': return { title: 'Settings', description: 'Working hours, score weights, bug targets, and holidays.' };
    case 'account': return { title: 'My account', description: 'Your profile and sign-in.' };
    default: return admin ? { title: 'Team overview', description: 'This week’s progress, scores, and the work that needs you.' } : { title: 'My overview', description: 'Your score, your open tickets, and what needs your attention.' };
  }
}

export function Workspace({ initialData }: { initialData: DashboardData }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const page = pathname.split('/').filter(Boolean).at(-1) ?? 'dashboard';
  const demo = initialData.mode === 'demo';
  const [liveData, setLiveData] = useState(initialData);
  const savedDemo = useSyncExternalStore(subscribeDemo, () => demoSnapshot(initialData), () => initialData);
  const viewerId = useSyncExternalStore(subscribeDemo, demoViewer, () => null);
  const fullData = demo ? savedDemo : liveData;
  const data = useMemo(() => demo ? viewAs(fullData, viewerId) : fullData, [demo, fullData, viewerId]);
  const [week, setWeek] = useState(getWeekStart(new Date(), initialData.settings.timezone));
  const [modal, setModal] = useState<ModalState>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [quickAction, setQuickAction] = useState<QuickAction | null>(null);
  const [busy, setBusy] = useState(false);
  const isAdmin = data.currentUser.role === 'admin';
  const scores = useMemo(() => calculateTeamKpi(data, week), [data, week]);
  const selected = data.items.find(i => i.id === selectedId);
  const currentWeek = getWeekStart(new Date(), data.settings.timezone);
  const { title, description } = headings(page, isAdmin);
  const blocked = !isAdmin && adminOnlyPages.includes(page);

  const mutate: MutationFn = async (mutation: Mutation, message = 'Saved') => {
    setBusy(true);
    try {
      if (demo) saveDemo(mutateDemo(fullData, mutation, data.currentUser));
      else {
        const response = await fetch('/api/data', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(mutation) });
        const body = await response.json();
        if (!response.ok) throw new Error(body.error ?? 'Could not save. Please try again.');
        setLiveData(body as DashboardData);
      }
      toast.success(message);
      return true;
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not save. Please try again.');
      return false;
    } finally { setBusy(false); }
  };
  /** Moves an item forward. Blocking, sending back, and reopening first ask for a reason. */
  function act(item: WorkItem, status: WorkItem['status']) {
    const reopening = ['done', 'fixed', 'verified'].includes(item.status) && ['in_progress', 'open'].includes(status);
    const sendingBack = item.status === 'in_review' && status === 'in_progress';
    if (status === 'blocked' || reopening || sendingBack) {
      setQuickAction({ item, patch: { status }, requireReason: true, label: status === 'blocked' ? 'Mark as blocked' : reopening ? 'Reopen' : 'Send back for changes' });
      return;
    }
    const message = status === 'done' ? 'Ticket approved. Its hours now count.' : status === 'verified' ? 'Fix verified' : status === 'fixed' ? 'Marked fixed. Waiting for verification.' : status === 'in_review' ? 'Submitted for review' : `Moved to ${statusLabels[status].toLowerCase()}`;
    void mutate({ action: 'updateItem', id: item.id, patch: { status } }, message);
  }
  function exportScores() {
    downloadCsv([
      ['Week starting', 'Name', 'Role', 'Hours at work', 'Ticket hours done', 'Ticket hours %', 'Bug points', 'Bugs scored', 'Efficiency %', 'Status'],
      ...scores.members.map(s => [week, s.member.name, s.member.role === 'admin' ? 'Admin' : 'Developer', s.capacityHours, s.creditedHours, s.deliveryScore, s.bugScore, s.bugsScored, s.efficiency, bands[s.band]]),
    ], `urban-gabru-scores-${week}.csv`);
    toast.success('Weekly report downloaded');
  }
  const addItem = (kind: 'task' | 'bug', assigneeId?: string) => setModal({ type: 'item', kind, assigneeId });
  const newTicket = <Button onClick={() => addItem('task')}><Plus data-icon="inline-start" size={17} />New ticket</Button>;
  const actions: Record<string, ReactNode> = {
    dashboard: <>{isAdmin && <Button variant="outline" onClick={exportScores}><ArrowDownToLine data-icon="inline-start" size={16} />Export report</Button>}{newTicket}</>,
    tickets: newTicket,
    standup: newTicket,
    bugs: isAdmin && <Button onClick={() => addItem('bug')}><Plus data-icon="inline-start" size={17} />Log bug</Button>,
    team: <><Button variant="outline" onClick={() => setModal({ type: 'leave' })}><CalendarPlus data-icon="inline-start" size={16} />Add leave</Button><Button onClick={() => setModal({ type: 'member' })}><Plus data-icon="inline-start" size={17} />Add member</Button></>,
    projects: isAdmin && <Button onClick={() => setModal({ type: 'project' })}><Plus data-icon="inline-start" size={17} />New project</Button>,
  };

  return <SidebarProvider className="workspace-shell">
    <WorkspaceSidebar data={data} page={page} />
    <SidebarInset className="main-shell">
      <header className="topbar">
        <div className="topbar-location"><SidebarTrigger aria-label="Open navigation" /><Separator orientation="vertical" className="h-4" /><Breadcrumb><BreadcrumbList><BreadcrumbItem><BreadcrumbLink asChild><Link href={routeFor(data, 'dashboard')}>Workspace</Link></BreadcrumbLink></BreadcrumbItem><BreadcrumbSeparator /><BreadcrumbItem><BreadcrumbPage>{title}</BreadcrumbPage></BreadcrumbItem></BreadcrumbList></Breadcrumb></div>
        <div className="topbar-right">
          <Badge variant="outline" className="connection-status"><i />{demo ? 'Demo workspace' : 'Live workspace'}</Badge>
          <ThemeToggle />
          <AttentionMenu data={data} onOpen={setSelectedId} />
          <Link href={routeFor(data, 'account')} aria-label="Open my account"><Avatar member={data.currentUser} size="small" /></Link>
        </div>
      </header>
      <div className="main-content">
        {demo && <DemoBanner data={fullData} viewerId={data.currentUser.id} />}
        <div className="page-heading">
          <div><h1>{title}<span className="heading-dot">.</span></h1><p>{description}</p></div>
          {!blocked && <div className="page-actions">{actions[page]}</div>}
        </div>
        {!blocked && ['dashboard', 'standup', 'team'].includes(page) && <div className="period-toolbar">
          <div className="period-label"><CalendarDays size={16} /><strong>{displayDate(week)} – {displayDate(shiftDate(week, 6, data.settings.timezone))}</strong><Badge variant="secondary">{week === currentWeek ? 'This week' : week < currentWeek ? 'Past week' : 'Future week'}</Badge></div>
          <div className="week-control">
            <Button variant="ghost" size="icon" aria-label="Previous week" onClick={() => setWeek(shiftDate(week, -7, data.settings.timezone))}><ChevronLeft size={16} /></Button>
            <Button variant="outline" disabled={week === currentWeek} onClick={() => setWeek(currentWeek)}>This week</Button>
            <Button variant="ghost" size="icon" aria-label="Next week" onClick={() => setWeek(shiftDate(week, 7, data.settings.timezone))}><ChevronRight size={16} /></Button>
          </div>
        </div>}
        {blocked ? <Panel><EmptyState title="This page is for admins" description="Your overview, tickets, bugs, and projects are in the menu." action={<Button variant="outline" asChild><Link href={routeFor(data, 'dashboard')}>Go to my overview<ArrowRight data-icon="inline-end" /></Link></Button>} /></Panel> : <>
          {page === 'dashboard' && <Dashboard data={data} week={week} scores={scores} onOpen={setSelectedId} onAction={act} onAdd={addItem} busy={busy} />}
          {(page === 'tickets' || page === 'bugs') && <WorkList key={`${page}?${searchParams.toString()}`} data={data} kind={page === 'tickets' ? 'task' : 'bug'} onOpen={setSelectedId} onAction={act} onAdd={addItem} busy={busy} />}
          {page === 'standup' && <Standup data={data} week={week} onOpen={setSelectedId} onAction={act} onAdd={addItem} mutate={mutate} busy={busy} />}
          {page === 'team' && <Team data={data} week={week} onEdit={m => setModal({ type: 'member', member: m })} onLeave={userId => setModal({ type: 'leave', userId })} mutate={mutate} onOpen={setSelectedId} />}
          {page === 'projects' && <Projects data={data} onEdit={p => setModal({ type: 'project', project: p })} mutate={mutate} />}
          {page === 'settings' && <SettingsPage key={JSON.stringify(data.settings)} data={data} mutate={mutate} busy={busy} onHoliday={() => setModal({ type: 'holiday' })} />}
          {page === 'account' && <Account data={data} />}
        </>}
        <footer className="workspace-footer"><span><span className="footer-brand">ug.</span>Urban Gabru tech workspace</span><span>India time (Asia/Kolkata) · {displayDate(new Date(), { year: 'numeric' })}</span></footer>
      </div>
    </SidebarInset>
    {modal?.type === 'item' && <ItemForm data={data} kind={modal.kind} assigneeId={modal.assigneeId} mutate={mutate} onClose={() => setModal(null)} busy={busy} />}
    {modal?.type === 'member' && <MemberForm data={data} editing={modal.member} mutate={mutate} onClose={() => setModal(null)} onLeave={userId => setModal({ type: 'leave', userId })} busy={busy} />}
    {modal?.type === 'project' && <ProjectForm data={data} editing={data.projects.find(p => p.id === modal.project?.id) ?? modal.project} mutate={mutate} onClose={() => setModal(null)} busy={busy} />}
    {modal?.type === 'leave' && <LeaveForm data={data} userId={modal.userId} mutate={mutate} onClose={() => setModal(null)} busy={busy} />}
    {modal?.type === 'holiday' && <HolidayForm mutate={mutate} onClose={() => setModal(null)} busy={busy} />}
    {selected && !quickAction && <ItemDrawer item={selected} data={data} busy={busy} onClose={() => setSelectedId(null)} onAction={act} onRevise={(patch, label) => setQuickAction({ item: selected, patch, label, requireReason: true })} mutate={mutate} />}
    {quickAction && <ReasonForm action={quickAction} data={data} busy={busy} mutate={mutate} onClose={() => setQuickAction(null)} />}
  </SidebarProvider>;
}

function WorkspaceSidebar({ data, page }: { data: DashboardData; page: string }) {
  const { setOpenMobile } = useSidebar();
  const isAdmin = data.currentUser.role === 'admin';
  const open = data.items.filter(i => !isDone(i));
  const close = () => setOpenMobile(false);
  return <Sidebar className="app-sidebar" collapsible="offcanvas">
    <SidebarHeader><Link className="brand" href={routeFor(data, 'dashboard')} onClick={close}><span className="brand-mark">ug<span>.</span></span><div>Urban Gabru<span>Tech workspace</span></div></Link></SidebarHeader>
    <SidebarContent>
      <SidebarGroup><SidebarGroupLabel>Workspace</SidebarGroupLabel><SidebarGroupContent><SidebarMenu>{pages.filter(p => isAdmin || !p.admin).map(p => {
        const Icon = p.icon;
        const count = p.id === 'tickets' ? open.filter(i => i.type === 'task').length : p.id === 'bugs' ? open.filter(i => i.type === 'bug').length : 0;
        return <SidebarMenuItem key={p.id}><SidebarMenuButton asChild isActive={page === p.id} tooltip={p.label}><Link href={routeFor(data, p.id)} onClick={close}><Icon /><span>{p.label}</span></Link></SidebarMenuButton>{count > 0 && <SidebarMenuBadge>{count}</SidebarMenuBadge>}</SidebarMenuItem>;
      })}</SidebarMenu></SidebarGroupContent></SidebarGroup>
    </SidebarContent>
    <SidebarFooter>
      <div className="sidebar-note"><div className="note-icon"><Target size={18} /></div><strong>How the score works</strong><p>Ticket hours done ÷ hours at work × {data.settings.deliveryWeight}%<br />+ bug points × {data.settings.bugWeight}%</p></div>
      <SidebarMenu>
        {isAdmin && <SidebarMenuItem><SidebarMenuButton asChild isActive={page === 'settings'}><Link href={routeFor(data, 'settings')} onClick={close}><Settings2 /><span>Settings</span></Link></SidebarMenuButton></SidebarMenuItem>}
        <SidebarMenuItem><SidebarMenuButton asChild isActive={page === 'account'} className="profile-link h-auto"><Link href={routeFor(data, 'account')} onClick={close}><Avatar member={data.currentUser} /><div>{data.currentUser.name}<span>{isAdmin ? 'Admin' : 'Developer'}</span></div><ChevronRight size={16} /></Link></SidebarMenuButton></SidebarMenuItem>
      </SidebarMenu>
    </SidebarFooter>
  </Sidebar>;
}

function AttentionMenu({ data, onOpen }: { data: DashboardData; onOpen: (id: string) => void }) {
  const router = useRouter();
  const items = attentionItems(data);
  return <DropdownMenu>
    <DropdownMenuTrigger asChild><Button variant="ghost" size="icon" aria-label={`Needs attention: ${items.length}`}><BellDot size={19} />{items.length > 0 && <i className="notification-dot" />}</Button></DropdownMenuTrigger>
    <DropdownMenuContent align="end" className="attention-menu">
      <DropdownMenuLabel>Needs attention{items.length ? ` · ${items.length}` : ''}</DropdownMenuLabel>
      <DropdownMenuSeparator />
      {items.length === 0 ? <p className="attention-menu-empty">Nothing needs attention.</p>
        : items.slice(0, 6).map(({ item, reason }) => <DropdownMenuItem key={item.id} onSelect={() => onOpen(item.id)} className="attention-menu-item">
            <span className="item-key">{item.key}</span><span className="attention-menu-title">{item.title}</span><span className="attention-menu-reason">{reason}</span>
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
  return <Alert className="demo-banner"><Eye /><AlertDescription>
    <span>This is the demo. Changes stay in this browser.</span>
    <span className="demo-viewer"><span>View as</span><FormSelect aria-label="View the demo as" value={viewerId} onValueChange={id => setDemoViewer(id === data.currentUser.id ? null : id)}>{people.map(m => <option key={m.id} value={m.id}>{m.name} · {m.role === 'admin' ? 'Admin' : 'Developer'}</option>)}</FormSelect></span>
    <Button variant="ghost" size="sm" onClick={reset}><RotateCcw data-icon="inline-start" />Reset</Button>
    <Button variant="link" size="sm" asChild><Link href="/login">Open your workspace<ArrowRight data-icon="inline-end" /></Link></Button>
  </AlertDescription></Alert>;
}
