"use client";

import { useState } from 'react';
import { Search, X } from 'lucide-react';
import type { Activity, DashboardData, TechRequest } from '@/lib/types';
import { ROLE_NAMES } from '@/lib/permissions';
import { Avatar, EmptyState, FormSelect } from '@/components/ui';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/components/ui/input-group';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { dateKey } from '@/lib/kpi';
import { displayDate, findMember, findProject, statusLabels, today } from './lib';

/** The parts of the organisation a change belongs to, for the filter. */
type Area = 'work' | 'requests' | 'people' | 'projects' | 'leave' | 'settings';
const AREAS: { id: Area | 'all'; label: string }[] = [
  { id: 'all', label: 'Everything' }, { id: 'requests', label: 'Requests' }, { id: 'work', label: 'Tickets and bugs' },
  { id: 'projects', label: 'Projects' }, { id: 'leave', label: 'Leave' }, { id: 'people', label: 'People and teams' }, { id: 'settings', label: 'Settings' },
];
/** What a change opened: a ticket, a bug, or a request. */
type Target = { kind: 'item'; id: string; label: string } | { kind: 'request'; request: TechRequest } | { kind: 'text'; label: string };
type Line = { area: Area; text: string; target: Target | null };

const words = (value: unknown) => typeof value === 'string' ? value : '';
/** One change in plain words, with what it changed. Unknown kinds of change still show, in the words of their name. */
export function describeActivity(data: DashboardData, event: Activity): Line {
  const [prefix, verb = ''] = event.action.split('.');
  const p = event.payload;
  const item = data.items.find(i => i.id === event.entityId);
  const request = data.techRequests.find(r => r.id === event.entityId);
  const member = findMember(data, event.entityId);
  const project = findProject(data, event.entityId);
  const itemTarget: Target | null = item ? { kind: 'item', id: item.id, label: item.key } : null;
  const requestTarget: Target | null = request ? { kind: 'request', request } : null;
  const text = (label: string): Target => ({ kind: 'text', label });
  switch (prefix) {
    case 'task': case 'bug': {
      const kind = prefix === 'task' ? 'ticket' : 'bug';
      const map: Record<string, string> = {
        created: `created a ${kind}`, reported: 'reported a bug', completed: 'approved a ticket', fixed: 'marked a bug fixed', verified: 'verified a bug fix',
        reopened: 'reopened a bug', updated: `changed a ${kind}`, estimate_revised: `changed an estimate from ${p.from} h to ${p.to} h on`, due_changed: `moved the date of a ${kind}`,
        hours_added: `added ${p.addedHours} h to a ticket`, due_change_requested: `asked for ${p.hours} more hours on`, due_change_declined: 'declined more hours on', due_change_withdrawn: 'withdrew an ask for hours on',
        status_changed: `moved a ${kind} to ${statusLabels[p.to as keyof typeof statusLabels]?.toLowerCase() ?? words(p.to)}`,
      };
      return { area: 'work', text: map[verb] ?? `${verb.replaceAll('_', ' ')} a ${kind}`, target: itemTarget ?? text(`a removed ${kind}`) };
    }
    case 'ticket_request': return { area: 'work', text: verb === 'created' ? 'asked for a ticket' : `${verb} a ticket request`, target: null };
    case 'tech_request': {
      const map: Record<string, string> = { created: 'raised', updated: 'changed', forwarded: 'forwarded to the tech lead', returned: 'sent back to project managers', assigned: 'assigned', declined: 'declined', commented: p.internal ? 'left a tech-team note on' : 'commented on', comment_removed: 'removed a comment on', withdrawn: 'withdrew' };
      return { area: 'requests', text: map[verb] ?? verb.replaceAll('_', ' '), target: requestTarget ?? text(words(p.title) ? `“${words(p.title)}”` : 'a withdrawn request') };
    }
    case 'attachment': return { area: request ? 'requests' : 'work', text: `${verb === 'added' ? 'attached' : 'removed'} ${words(p.name) || 'a file'} ${verb === 'added' ? 'to' : 'from'}`, target: requestTarget ?? itemTarget ?? text('a removed record') };
    case 'member': {
      const name = member?.name ?? (words(p.name) || 'someone');
      const map: Record<string, string> = {
        created: `added ${name}${typeof p.role === 'string' && p.role in ROLE_NAMES ? ` as ${ROLE_NAMES[p.role as keyof typeof ROLE_NAMES].toLowerCase()}` : ''}`,
        updated: `changed ${name}${(p.changes as Record<string, unknown> | undefined)?.role ? `’s role to ${ROLE_NAMES[(p.changes as { role: keyof typeof ROLE_NAMES }).role]?.toLowerCase()}` : (p.changes as Record<string, unknown> | undefined)?.isActive === false ? ' to no access' : ''}`,
        microsoft_linked: 'signed in for the first time', self_registered: 'joined with a company email',
        removed: p.deleted ? `deleted the unused invite for ${name}` : `removed ${name}; their history stays`,
      };
      return { area: 'people', text: map[verb] ?? `${verb.replaceAll('_', ' ')} ${name}`, target: null };
    }
    case 'department': return { area: 'people', text: verb === 'created' ? `created the team ${words(p.name)}` : `changed the team ${words(p.from)}`, target: null };
    case 'project': case 'phase': {
      const name = project?.name ?? (words(p.name) || 'a project');
      const map: Record<string, string> = { created: prefix === 'phase' ? `added the phase ${words(p.name)} to` : 'created the project', updated: prefix === 'phase' ? 'renamed a phase in' : 'changed the project', target_changed: `moved the target of` };
      return { area: 'projects', text: map[verb] ?? verb.replaceAll('_', ' '), target: text(name) };
    }
    case 'leave': {
      const person = findMember(data, words(p.userId) || words(p.requesterId));
      const map: Record<string, string> = { requested: 'asked for leave', approved: 'approved leave', declined: 'declined leave', withdrawn: 'withdrew a leave request', added: `recorded leave on ${displayDate(words(p.date) || null)}`, removed: `removed leave on ${displayDate(words(p.date) || null)}` };
      return { area: 'leave', text: `${map[verb] ?? verb}${person && person.id !== event.actorId ? ` for ${person.name}` : ''}`, target: null };
    }
    case 'holiday': return { area: 'settings', text: `${verb === 'added' ? 'added the holiday' : 'removed a holiday'} ${words(p.name)}`, target: null };
    case 'settings': return { area: 'settings', text: 'changed the settings', target: null };
    default: return { area: 'settings', text: event.action.replaceAll('.', ' ').replaceAll('_', ' '), target: null };
  }
}

const PAGE = 80;
type LogProps = { data: DashboardData; onOpenItem: (id: string) => void; onOpenRequest: (request: TechRequest) => void };

/** Every change in the organisation, newest first, for an admin. Each line names who did it, what changed, and why when a reason was given. */
export function ActivityLog({ data, onOpenItem, onOpenRequest }: LogProps) {
  const [area, setArea] = useState<Area | 'all'>('all');
  const [personId, setPersonId] = useState('all');
  const [search, setSearch] = useState('');
  const [limit, setLimit] = useState(PAGE);
  const timezone = data.settings.timezone;
  const needle = search.trim().toLowerCase();
  const actorName = (id: string) => findMember(data, id)?.name ?? 'Someone';
  // Request steps come from the same audit rows as the rest, so the two lists share ids. The demo keeps them on each request only.
  const known = new Set(data.activities.map(a => a.id));
  const fromRequests: Activity[] = data.techRequests.flatMap(request => request.history.filter(step => !known.has(step.id))
    .map(step => ({ id: step.id, entityId: request.id, actorId: step.actorId, action: step.action, reason: step.note, payload: step.payload, createdAt: step.createdAt })));
  const lines = [...data.activities, ...fromRequests].map(event => ({ event, ...describeActivity(data, event) }));
  const targetLabel = (target: Target | null) => !target ? '' : target.kind === 'request' ? `${target.request.key} ${target.request.title}` : target.label;
  const filtered = lines.filter(line => (personId === 'all' || line.event.actorId === personId)
    && (!needle || `${actorName(line.event.actorId)} ${line.text} ${targetLabel(line.target)} ${line.event.reason ?? ''}`.toLowerCase().includes(needle)));
  const shown = filtered.filter(line => area === 'all' || line.area === area).sort((a, b) => b.event.createdAt.localeCompare(a.event.createdAt));
  const actors = [...new Set(lines.map(line => line.event.actorId))].map(id => findMember(data, id)).filter((m): m is NonNullable<typeof m> => !!m).sort((a, b) => a.name.localeCompare(b.name));
  const day = today(timezone);
  const dayLabel = (iso: string) => { const key = dateKey(iso, timezone); return key === day ? 'Today' : displayDate(key, { weekday: 'long', day: 'numeric', month: 'long' }); };
  const time = (iso: string) => new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: timezone }).format(new Date(iso));
  const groups: { label: string; lines: typeof shown }[] = [];
  for (const line of shown.slice(0, limit)) {
    const label = dayLabel(line.event.createdAt);
    if (groups.at(-1)?.label === label) groups.at(-1)!.lines.push(line); else groups.push({ label, lines: [line] });
  }
  const filtering = area !== 'all' || personId !== 'all' || !!needle;
  return <Card className="work-list-panel activity-log">
    <div className="work-list-tabs">
      <ToggleGroup type="single" value={area} onValueChange={value => { if (value) { setArea(value as Area | 'all'); setLimit(PAGE); } }} className="status-tabs" aria-label="Filter by area">
        {AREAS.map(a => <ToggleGroupItem key={a.id} value={a.id}>{a.label}<span className="tab-count">{a.id === 'all' ? filtered.length : filtered.filter(line => line.area === a.id).length}</span></ToggleGroupItem>)}
      </ToggleGroup>
    </div>
    <div className="list-toolbar">
      <InputGroup className="search-control">
        <InputGroupAddon><Search /></InputGroupAddon>
        <InputGroupInput data-page-search aria-label="Search the activity log" placeholder="Search by person, key, or reason…" value={search} onChange={event => { setSearch(event.target.value); setLimit(PAGE); }} />
        {search && <InputGroupAddon align="inline-end"><Button variant="ghost" size="icon-xs" aria-label="Clear search" onClick={() => setSearch('')}><X /></Button></InputGroupAddon>}
      </InputGroup>
      <div className="filter-controls">
        <FormSelect aria-label="Filter by person" value={personId} onValueChange={value => { setPersonId(value); setLimit(PAGE); }}><option value="all">Anyone</option>{actors.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}</FormSelect>
        {filtering && <Button variant="ghost" size="sm" onClick={() => { setArea('all'); setPersonId('all'); setSearch(''); }}>Clear filters</Button>}
      </div>
    </div>
    {groups.length === 0 ? <EmptyState title={filtering ? 'No matches' : 'Nothing has happened yet'} description={filtering ? 'Try another area, person, or search.' : 'Changes across the workspace appear here.'} />
      : <div className="activity-days">{groups.map(group => <section key={group.label} className="activity-day">
        <h3>{group.label}</h3>
        <ol>{group.lines.map(({ event, text, target }) => {
          const actor = findMember(data, event.actorId);
          return <li key={event.id} className="activity-line">
            <Avatar member={actor} size="small" />
            <div>
              <p><strong>{actor?.name ?? 'Someone'}</strong> {text}{target && <> {target.kind === 'item'
                ? <Button variant="link" size="sm" className="activity-target" onClick={() => onOpenItem(target.id)}>{target.label}</Button>
                : target.kind === 'request' ? <Button variant="link" size="sm" className="activity-target" onClick={() => onOpenRequest(target.request)}>{target.request.key}</Button>
                : <span className="activity-target-text">{target.label}</span>}</>}</p>
              {event.reason && <blockquote>{event.reason}</blockquote>}
            </div>
            <time dateTime={event.createdAt}>{time(event.createdAt)}</time>
          </li>;
        })}</ol>
      </section>)}</div>}
    {shown.length > limit && <div className="activity-more"><Button variant="outline" onClick={() => setLimit(limit + PAGE)}>Show {Math.min(PAGE, shown.length - limit)} more</Button><span>{shown.length - limit} older changes</span></div>}
  </Card>;
}
