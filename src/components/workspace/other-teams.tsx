"use client";

import { useState, type FormEvent, type KeyboardEvent } from 'react';
import Link from 'next/link';
import clsx from 'clsx';
import { Archive, ArchiveRestore, Briefcase, Inbox, MoreHorizontal, Pencil, Plus, UserPlus, Users, X } from 'lucide-react';
import type { DashboardData, Department, Member } from '@/lib/types';
import { Avatar, EmptyState, FormField, Modal, Panel } from '@/components/ui';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { activeDepartments, findDepartment, requestStage, routeFor, type MutationFn } from './lib';
import { FormFooter } from './forms';
import { TeamTag } from './requests';
import { plural } from './timeline';

type OtherTeamsProps = { data: DashboardData; mutate: MutationFn; busy: boolean; onAddMember: (departmentId?: string) => void; onEditMember: (member: Member) => void; onTeam: (department?: Department) => void };

/**
 * Teams outside tech, such as Sales, and the people in them. An admin creates both, and marks who leads each team.
 * Everyone in a team signs in with their Microsoft work account and raises requests for it. Nobody else gets in,
 * unless an admin lets a work email domain in.
 */
export function OtherTeams({ data, mutate, busy, onAddMember, onEditMember, onTeam }: OtherTeamsProps) {
  const [showArchived, setShowArchived] = useState(false);
  // Team leads first, then everyone else by name. People without access go last.
  const people = data.members.filter(m => m.role === 'requester')
    .sort((a, b) => Number(b.isActive) - Number(a.isActive) || Number(!!b.isTeamLead) - Number(!!a.isTeamLead) || a.name.localeCompare(b.name));
  const canRaise = people.filter(m => m.isActive).length;
  const teams = activeDepartments(data);
  const archived = data.departments.filter(d => d.isArchived).sort((a, b) => a.name.localeCompare(b.name));
  const open = (teamId?: string) => data.techRequests.filter(r => (!teamId || r.departmentId === teamId) && !['done', 'declined'].includes(requestStage(data, r))).length;
  // Someone who signed in with a company email before their first request has no team yet.
  const withoutTeam = people.filter(m => !findDepartment(data, m.departmentId));
  return <>
    <div className="team-overview-strip">
      <div><span className="mini-metric-icon"><Briefcase /></span><strong>{teams.length}</strong><span>{teams.length === 1 ? 'team' : 'teams'}</span></div>
      <div><span className="mini-metric-icon"><Users /></span><strong>{canRaise}</strong><span>{canRaise === 1 ? 'person' : 'people'} who can raise requests</span></div>
      <div><span className="mini-metric-icon"><Inbox /></span><strong>{open()}</strong><span>open requests</span></div>
    </div>
    {teams.length === 0
      ? <Panel><EmptyState title="No teams yet" description="Create a team, such as Sales, then add the people who raise requests for it." action={<Button onClick={() => onTeam()}><Plus data-icon="inline-start" />New team</Button>} /></Panel>
      : <div className="other-teams-grid">{teams.map(team => <TeamCard key={team.id} data={data} team={team} people={people.filter(m => m.departmentId === team.id)} open={open(team.id)} busy={busy}
          onAddMember={() => onAddMember(team.id)} onEditMember={onEditMember} onRename={() => onTeam(team)}
          onArchive={() => void mutate({ action: 'updateDepartment', id: team.id, isArchived: true }, `${team.name} archived. Its requests stay.`)} />)}</div>}
    {withoutTeam.length > 0 && <Panel title="People without a team" count={withoutTeam.length}>
      <p className="panel-intro">They signed in with a company email and have not raised a request yet. Their first request sets their team, or you can set it now.</p>
      <PeopleList data={data} people={withoutTeam} onEdit={onEditMember} />
    </Panel>}
    {archived.length > 0 && <div className="archived-teams">
      <Button variant="ghost" size="sm" onClick={() => setShowArchived(!showArchived)} aria-expanded={showArchived}><Archive data-icon="inline-start" />{showArchived ? 'Hide' : 'Show'} archived teams ({archived.length})</Button>
      {showArchived && <ul className="archived-team-list">{archived.map(team => <li key={team.id}>
        <TeamTag data={data} id={team.id} /><span>{plural(data.techRequests.filter(r => r.departmentId === team.id).length, 'request')} · takes no new ones</span>
        <Button variant="ghost" size="sm" disabled={busy} onClick={() => void mutate({ action: 'updateDepartment', id: team.id, isArchived: false }, `${team.name} restored`)}><ArchiveRestore data-icon="inline-start" />Restore</Button>
      </li>)}</ul>}
    </div>}
    <SignInPanel data={data} mutate={mutate} busy={busy} />
  </>;
}

function PeopleList({ data, people, onEdit }: { data: DashboardData; people: Member[]; onEdit: (member: Member) => void }) {
  // Only an admin's live data says who has linked a Microsoft account. The demo has none.
  const invited = (member: Member) => data.mode === 'live' && !member.microsoftObjectId;
  return <ul className="team-people-list">{people.map(m => <li key={m.id} className={clsx(!m.isActive && 'is-inactive')}>
    <Avatar member={m} size="small" />
    <span className="team-person-name"><strong>{m.name}{m.isTeamLead && <small className="lead-tag">Team lead</small>}</strong><span>{m.email}</span></span>
    {!m.isActive ? <Badge variant="outline" className="access-tag access-inactive"><i />Inactive</Badge>
      : invited(m) && <Badge variant="outline" className="access-tag access-invited" title="Their Microsoft account links on their first sign-in."><i />Not signed in yet</Badge>}
    <Button variant="ghost" size="icon-sm" aria-label={`Edit ${m.name}`} title={`Edit ${m.name}`} onClick={() => onEdit(m)}><Pencil /></Button>
  </li>)}</ul>;
}

type TeamCardProps = { data: DashboardData; team: Department; people: Member[]; open: number; busy: boolean; onAddMember: () => void; onEditMember: (member: Member) => void; onRename: () => void; onArchive: () => void };
function TeamCard({ data, team, people, open, busy, onAddMember, onEditMember, onRename, onArchive }: TeamCardProps) {
  return <Card className="other-team-card">
    <header className="other-team-head">
      <h2><TeamTag data={data} id={team.id} /></h2>
      <Link className="other-team-requests" href={routeFor(data, `requests?team=${team.id}&status=all`)}>{plural(open, 'open request')}</Link>
      {/* Not modal, so the dialog an item opens gets focus straight away. */}
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild><Button variant="ghost" size="icon-sm" aria-label={`More actions for ${team.name}`}><MoreHorizontal /></Button></DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={onRename}><Pencil />Rename team</DropdownMenuItem>
          <DropdownMenuItem disabled={busy} onSelect={onArchive}><Archive />Archive team</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </header>
    {people.length
      ? <PeopleList data={data} people={people} onEdit={onEditMember} />
      : <p className="other-team-empty">No one yet. Add the people who raise requests for this team.</p>}
    <footer className="other-team-foot"><Button variant="outline" size="sm" onClick={onAddMember}><UserPlus data-icon="inline-start" />Add member</Button></footer>
  </Card>;
}

/** Creates a team, or renames one. Requests already filed under a team keep it. */
export function DepartmentForm({ editing, mutate, busy, onClose }: { editing?: Department; mutate: MutationFn; busy: boolean; onClose: () => void }) {
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = String(new FormData(event.currentTarget).get('name')).trim();
    const ok = editing
      ? name === editing.name || await mutate({ action: 'updateDepartment', id: editing.id, name }, 'Team renamed')
      : await mutate({ action: 'createDepartment', name }, `${name} created. Add its members next.`);
    if (ok) onClose();
  }
  return <Modal title={editing ? 'Rename team' : 'New team'} subtitle={editing ? `Requests filed under ${editing.name} keep the team.` : 'A team outside tech, such as Sales or Creative. Its members raise requests for it.'} onClose={onClose}>
    <form onSubmit={submit}>
      <FieldGroup className="modal-form-body">
        <FormField>Team name<Input name="name" required maxLength={60} defaultValue={editing?.name} placeholder="e.g. Customer support" autoComplete="off" /></FormField>
      </FieldGroup>
      <FormFooter busy={busy} onClose={onClose} label={editing ? 'Save name' : 'Create team'} />
    </form>
  </Modal>;
}

/** Who may sign in to raise requests. Closed by default: only the people an admin adds to a team. */
function SignInPanel({ data, mutate, busy }: { data: DashboardData; mutate: MutationFn; busy: boolean }) {
  const [editing, setEditing] = useState(false);
  const domains = data.settings.requestDomains;
  return <Panel title="Who can sign in" action={<Button variant="link" size="sm" onClick={() => setEditing(true)}>Change</Button>} className="sign-in-panel">
    <p className="panel-intro">{domains.length
      ? <>The people you add to a team can sign in. So can anyone in your Microsoft organisation with a work email on {domains.map(d => `@${d}`).join(' or ')}. Their first request sets their team.</>
      : <>Only the people you add to a team can sign in. They use their Microsoft work account, with the email you add here.</>}</p>
    {editing && <DomainForm data={data} mutate={mutate} busy={busy} onClose={() => setEditing(false)} />}
  </Panel>;
}

const DOMAIN = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$/;
function DomainForm({ data, mutate, busy, onClose }: { data: DashboardData; mutate: MutationFn; busy: boolean; onClose: () => void }) {
  const [domains, setDomains] = useState(data.settings.requestDomains);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState('');
  function add() {
    const domain = draft.trim().toLowerCase().replace(/^.*@/, '');
    if (!domain) return;
    if (!DOMAIN.test(domain)) { setError('Enter a domain such as urbangabru.in, without the @.'); return; }
    if (domains.includes(domain)) { setError('This domain is already in the list.'); return; }
    setDomains([...domains, domain]);
    setDraft(''); setError('');
  }
  const onEnter = (event: KeyboardEvent) => { if (event.key === 'Enter') { event.preventDefault(); add(); } };
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const ok = await mutate({ action: 'saveSettings', settings: { ...data.settings, requestDomains: domains } },
      domains.length ? 'Saved. People with these work emails can sign in.' : 'Saved. Only the people you add to a team can sign in.');
    if (ok) onClose();
  }
  return <Modal title="Who can sign in" subtitle="By default, only the people you add to a team can sign in. You can also let in everyone with a company work email." onClose={onClose}>
    <form onSubmit={submit}>
      <FieldGroup className="modal-form-body">
        <FieldLabel>Also let in everyone with a work email on</FieldLabel>
        {domains.length > 0
          ? <div className="domain-list">{domains.map(domain => <Badge key={domain} variant="secondary" className="domain-chip">@{domain}<Button type="button" variant="ghost" size="icon-xs" aria-label={`Remove ${domain}`} onClick={() => setDomains(domains.filter(d => d !== domain))}><X /></Button></Badge>)}</div>
          : <p className="field-help">No domain. Only the people you add to a team can sign in.</p>}
        <div className="domain-add-row">
          <Input aria-label="Add a work email domain" placeholder="e.g. urbangabru.in" value={draft} onChange={event => { setDraft(event.target.value); setError(''); }} onKeyDown={onEnter} aria-invalid={!!error} />
          <Button type="button" variant="outline" disabled={!draft.trim()} onClick={add}><Plus data-icon="inline-start" />Add domain</Button>
        </div>
        {error ? <p className="field-error" role="alert">{error}</p> : <p className="field-help">Only people in your Microsoft organisation can sign in at all. People who get in this way can raise requests, and you can see them here.</p>}
      </FieldGroup>
      <FormFooter busy={busy} onClose={onClose} label="Save" />
    </form>
  </Modal>;
}
