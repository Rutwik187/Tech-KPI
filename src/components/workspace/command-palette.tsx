"use client";

import { useMemo, useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { useTheme } from 'next-themes';
import { Briefcase, Bug, CalendarPlus, ClipboardCheck, Coffee, CornerDownLeft, FolderKanban, FolderPlus, Inbox, LayoutDashboard, ListTodo, Moon, Plus, Settings2, Sun, UserPlus, UserRound, Users, UsersRound } from 'lucide-react';
import type { DashboardData, WorkItem } from '@/lib/types';
import { Avatar, Kbd, StatusIcon } from '@/components/ui';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandSeparator, CommandShortcut } from '@/components/ui/command';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { attentionItems, findDepartment, findMember, findProject, firstName, isDone, requestStage, routeFor, stageLabels } from './lib';

export type PaletteModal = 'project' | 'member' | 'leave' | 'teamTicket' | 'otherTeamMember' | 'department';
type PaletteProps = {
  data: DashboardData; open: boolean; onOpenChange: (open: boolean) => void;
  onOpenItem: (id: string) => void; onOpenProject: (id: string) => void; onCreate: (kind: 'task' | 'bug') => void; onModal: (type: PaletteModal) => void;
};

/** How well a ticket or bug matches the search. A key or its number ("14" for UG-014) ranks first, then the title. */
function rank(item: WorkItem, query: string, owner: string, project: string) {
  const key = item.key.toLowerCase();
  const title = item.title.toLowerCase();
  const number = query.replace(/^0+/, '');
  if (key === query) return 100;
  if (key.startsWith(query) || (/^\d+$/.test(query) && key.replace(/^\D+-0*/, '') === number)) return 90;
  if (title.startsWith(query)) return 70;
  if (title.includes(query)) return 55;
  const words = query.split(/\s+/).filter(Boolean);
  if (words.every(word => title.includes(word) || key.includes(word))) return 40;
  if (owner.includes(query)) return 20;
  if (project.includes(query)) return 10;
  return 0;
}

/** Find any ticket, bug, project, person, or page, and start common actions, from the keyboard. */
export function CommandPalette({ data, open, onOpenChange, onOpenItem, onOpenProject, onCreate, onModal }: PaletteProps) {
  const router = useRouter();
  const { resolvedTheme, setTheme } = useTheme();
  const [query, setQuery] = useState('');
  const admin = data.currentUser.role === 'admin';
  const needle = query.trim().toLowerCase();

  const items = useMemo(() => {
    if (!needle) {
      // Before typing: what needs attention first, then open work.
      const suggested = attentionItems(data).map(entry => entry.item);
      const open = data.items.filter(item => !isDone(item) && !suggested.includes(item)).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
      return [...suggested, ...open].slice(0, 6);
    }
    return data.items
      .map(item => ({ item, score: rank(item, needle, (findMember(data, item.assigneeId)?.name ?? '').toLowerCase(), (findProject(data, item.projectId)?.name ?? '').toLowerCase()) }))
      .filter(entry => entry.score > 0)
      .sort((a, b) => b.score - a.score || Number(isDone(a.item)) - Number(isDone(b.item)) || b.item.updatedAt.localeCompare(a.item.updatedAt))
      .slice(0, 12)
      .map(entry => entry.item);
  }, [data, needle]);
  const projects = needle ? data.projects.filter(p => !p.isArchived && p.name.toLowerCase().includes(needle)).slice(0, 5) : [];
  const people = needle && admin ? data.members.filter(m => m.isActive && m.role === 'developer' && `${m.name} ${m.email}`.toLowerCase().includes(needle)).slice(0, 5) : [];
  // Requests from other teams, by key ("REQ-004" or "4" after "req"), title, or who raised them.
  const teamRequests = needle && admin ? data.techRequests.filter(r => `${r.key} ${r.title} ${r.requesterName}`.toLowerCase().includes(needle)).slice(0, 5) : [];

  const pages: { id: string; label: string; icon: ReactNode; admin?: boolean }[] = [
    { id: 'dashboard', label: 'Overview', icon: <LayoutDashboard /> },
    { id: 'tickets', label: admin ? 'Tickets' : 'My tickets', icon: <ListTodo /> },
    { id: 'bugs', label: admin ? 'Bugs' : 'My bugs', icon: <Bug /> },
    { id: 'approvals', label: 'Approvals', icon: <ClipboardCheck /> },
    { id: 'requests', label: 'Requests from other teams', icon: <Inbox />, admin: true },
    { id: 'standup', label: 'Daily standup', icon: <Coffee />, admin: true },
    { id: 'team', label: 'Team', icon: <Users />, admin: true },
    { id: 'other-teams', label: 'Other teams', icon: <Briefcase />, admin: true },
    { id: 'projects', label: 'Projects', icon: <FolderKanban /> },
    { id: 'settings', label: 'Settings', icon: <Settings2 />, admin: true },
    { id: 'account', label: 'My account', icon: <UserRound /> },
  ];
  const shownPages = pages.filter(page => (admin || !page.admin) && (!needle || page.label.toLowerCase().includes(needle)));
  const dark = resolvedTheme === 'dark';
  const actions: { id: string; label: string; icon: ReactNode; shortcut?: string; run: () => void; admin?: boolean }[] = [
    { id: 'ticket', label: admin ? 'New ticket' : 'Request ticket', icon: <Plus />, shortcut: 'C', run: () => onCreate('task') },
    { id: 'bug', label: 'Log bug', icon: <Bug />, run: () => onCreate('bug'), admin: true },
    { id: 'team-ticket', label: 'Team ticket', icon: <UsersRound />, run: () => onModal('teamTicket'), admin: true },
    { id: 'project', label: 'New project', icon: <FolderPlus />, run: () => onModal('project'), admin: true },
    { id: 'member', label: 'Add member', icon: <UserPlus />, run: () => onModal('member'), admin: true },
    { id: 'other-team-member', label: 'Add someone from another team', icon: <Briefcase />, run: () => onModal('otherTeamMember'), admin: true },
    { id: 'department', label: 'New team', icon: <Plus />, run: () => onModal('department'), admin: true },
    { id: 'leave', label: 'Add leave', icon: <CalendarPlus />, run: () => onModal('leave'), admin: true },
    { id: 'theme', label: dark ? 'Switch to light theme' : 'Switch to dark theme', icon: dark ? <Sun /> : <Moon />, run: () => setTheme(dark ? 'light' : 'dark') },
  ];
  const shownActions = actions.filter(action => (admin || !action.admin) && (!needle || action.label.toLowerCase().includes(needle)));

  function close(next: boolean) {
    onOpenChange(next);
    if (!next) setQuery('');
  }
  // Close first, so the dialog that an action opens gets the focus.
  function run(action: () => void) {
    close(false);
    window.setTimeout(action, 0);
  }
  const tickets = items.filter(item => item.type === 'task');
  const bugs = items.filter(item => item.type === 'bug');
  const itemRow = (item: WorkItem) => {
    const owner = findMember(data, item.assigneeId);
    const project = findProject(data, item.projectId);
    return <CommandItem key={item.id} value={`item-${item.id}`} onSelect={() => run(() => onOpenItem(item.id))} className="palette-item">
      <StatusIcon status={item.status} label />
      <span className="item-key">{item.key}</span>
      <span className="palette-item-title">{item.title}</span>
      <span className="palette-item-meta">{project && <i style={{ background: project.color }} aria-hidden="true" />}{admin ? firstName(owner) : project?.name}</span>
    </CommandItem>;
  };

  return <Dialog open={open} onOpenChange={close}>
    <DialogContent className="command-palette overflow-hidden p-0 sm:max-w-2xl" showCloseButton={false}>
      <DialogTitle className="sr-only">Search the workspace</DialogTitle>
      <DialogDescription className="sr-only">Find a ticket, bug, project, person, or page, or start an action.</DialogDescription>
      <Command shouldFilter={false} loop>
        <CommandInput value={query} onValueChange={setQuery} placeholder="Search tickets and bugs by key or title, or jump to a page…" aria-label="Search the workspace" />
        <CommandList className="palette-list">
          <CommandEmpty>Nothing matches “{query.trim()}”.</CommandEmpty>
          {tickets.length > 0 && <CommandGroup heading={needle ? 'Tickets' : 'Needs attention and open work'}>{tickets.map(itemRow)}{!needle && bugs.map(itemRow)}</CommandGroup>}
          {needle && bugs.length > 0 && <CommandGroup heading="Bugs">{bugs.map(itemRow)}</CommandGroup>}
          {!needle && tickets.length === 0 && bugs.length > 0 && <CommandGroup heading="Open bugs">{bugs.map(itemRow)}</CommandGroup>}
          {projects.length > 0 && <CommandGroup heading="Projects">{projects.map(project => <CommandItem key={project.id} value={`project-${project.id}`} onSelect={() => run(() => onOpenProject(project.id))}>
            <i className="palette-project-dot" style={{ background: project.color }} aria-hidden="true" />{project.name}<span className="palette-item-meta">Open project</span>
          </CommandItem>)}</CommandGroup>}
          {teamRequests.length > 0 && <CommandGroup heading="Requests from other teams">{teamRequests.map(request => <CommandItem key={request.id} value={`request-${request.id}`} onSelect={() => run(() => router.push(routeFor(data, `requests?q=${request.key}`)))} className="palette-item">
            <Inbox /><span className="item-key">{request.key}</span><span className="palette-item-title">{request.title}</span>
            <span className="palette-item-meta">{findDepartment(data, request.departmentId)?.name ?? 'Another team'} · {stageLabels[requestStage(data, request)]}</span>
          </CommandItem>)}</CommandGroup>}
          {people.length > 0 && <CommandGroup heading="People">{people.map(member => <CommandItem key={member.id} value={`person-${member.id}`} onSelect={() => run(() => router.push(routeFor(data, `tickets?assignee=${member.id}`)))}>
            <Avatar member={member} size="small" />{member.name}<span className="palette-item-meta">Their tickets</span>
          </CommandItem>)}</CommandGroup>}
          {(shownActions.length > 0 || shownPages.length > 0) && (tickets.length > 0 || bugs.length > 0 || projects.length > 0 || teamRequests.length > 0 || people.length > 0) && <CommandSeparator />}
          {shownActions.length > 0 && <CommandGroup heading="Actions">{shownActions.map(action => <CommandItem key={action.id} value={`action-${action.id}`} onSelect={() => run(action.run)}>
            {action.icon}{action.label}{action.shortcut && <CommandShortcut><Kbd>{action.shortcut}</Kbd></CommandShortcut>}
          </CommandItem>)}</CommandGroup>}
          {shownPages.length > 0 && <CommandGroup heading="Go to">{shownPages.map(page => <CommandItem key={page.id} value={`page-${page.id}`} onSelect={() => run(() => router.push(routeFor(data, page.id)))}>
            {page.icon}{page.label}
          </CommandItem>)}</CommandGroup>}
        </CommandList>
        <div className="palette-footer" aria-hidden="true"><span><Kbd>↑</Kbd><Kbd>↓</Kbd> to move</span><span><Kbd><CornerDownLeft /></Kbd> to open</span><span><Kbd>esc</Kbd> to close</span></div>
      </Command>
    </DialogContent>
  </Dialog>;
}
