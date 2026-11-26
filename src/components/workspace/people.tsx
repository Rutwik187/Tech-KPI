"use client";

import { useState } from 'react';
import clsx from 'clsx';
import { Pencil, Search, ShieldCheck, UserCheck, UserX, Users, X } from 'lucide-react';
import type { DashboardData, Member, Role } from '@/lib/types';
import { manageableRoles, ROLE_NAMES, ROLES } from '@/lib/permissions';
import { Avatar, EmptyState, FormSelect } from '@/components/ui';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/components/ui/input-group';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { displayDate } from './lib';
import { TeamTag } from './requests';
import { RoleBadge } from './team';

type Access = 'active' | 'invited' | 'inactive';
type PeopleProps = { data: DashboardData; onEdit: (member: Member) => void };

/**
 * Everyone in the organisation, in one list: admins, tech leads, project managers, developers, and people in teams outside tech.
 * An admin changes anyone's role, team, and access here. Hours and scores stay on the Team page.
 */
export function People({ data, onEdit }: PeopleProps) {
  const [role, setRole] = useState<Role | 'all'>('all');
  const [access, setAccess] = useState<Access | 'all'>('all');
  const [search, setSearch] = useState('');
  const editable = manageableRoles(data.currentUser);
  // Only a live workspace knows who has linked a Microsoft account. Until then, the person has not signed in.
  const accessOf = (m: Member): Access => !m.isActive ? 'inactive' : data.mode === 'live' && editable.includes(m.role) && !m.microsoftObjectId ? 'invited' : 'active';
  const needle = search.trim().toLowerCase();
  const matching = data.members.filter(m => (access === 'all' || accessOf(m) === access) && (!needle || `${m.name} ${m.email}`.toLowerCase().includes(needle)));
  const shown = matching.filter(m => role === 'all' || m.role === role)
    .sort((a, b) => Number(b.isActive) - Number(a.isActive) || ROLES.indexOf(a.role) - ROLES.indexOf(b.role) || a.name.localeCompare(b.name));
  const active = data.members.filter(m => m.isActive);
  const filtering = role !== 'all' || access !== 'all' || !!needle;
  return <>
    <div className="team-overview-strip approvals-strip">
      <div><span className="mini-metric-icon"><Users /></span><strong>{active.length}</strong><span>people with access</span></div>
      <div><span className="mini-metric-icon"><ShieldCheck /></span><strong>{active.filter(m => m.role === 'admin').length}</strong><span>{active.filter(m => m.role === 'admin').length === 1 ? 'admin' : 'admins'}</span></div>
      <div><span className="mini-metric-icon"><UserCheck /></span><strong>{data.members.filter(m => accessOf(m) === 'invited').length}</strong><span>not signed in yet</span></div>
      <div><span className="mini-metric-icon"><UserX /></span><strong>{data.members.filter(m => !m.isActive).length}</strong><span>without access</span></div>
    </div>
    <Card className="work-list-panel">
      <div className="work-list-tabs">
        <ToggleGroup type="single" value={role} onValueChange={value => { if (value) setRole(value as Role | 'all'); }} className="status-tabs" aria-label="Filter by role">
          <ToggleGroupItem value="all">Everyone<span className="tab-count">{matching.length}</span></ToggleGroupItem>
          {ROLES.map(r => <ToggleGroupItem key={r} value={r}>{r === 'requester' ? 'Other teams' : `${ROLE_NAMES[r]}s`}<span className="tab-count">{matching.filter(m => m.role === r).length}</span></ToggleGroupItem>)}
        </ToggleGroup>
      </div>
      <div className="list-toolbar">
        <InputGroup className="search-control">
          <InputGroupAddon><Search /></InputGroupAddon>
          <InputGroupInput data-page-search aria-label="Find a person" placeholder="Find by name or email…" value={search} onChange={event => setSearch(event.target.value)} />
          {search && <InputGroupAddon align="inline-end"><Button variant="ghost" size="icon-xs" aria-label="Clear search" onClick={() => setSearch('')}><X /></Button></InputGroupAddon>}
        </InputGroup>
        <div className="filter-controls">
          <FormSelect aria-label="Filter by access" value={access} onValueChange={value => setAccess(value as Access | 'all')}>
            <option value="all">Any access</option><option value="active">Signed in</option><option value="invited">Not signed in yet</option><option value="inactive">No access</option>
          </FormSelect>
          {filtering && <Button variant="ghost" size="sm" onClick={() => { setRole('all'); setAccess('all'); setSearch(''); }}>Clear filters</Button>}
        </div>
      </div>
      <div className="table-scroll"><Table className="data-table people-table">
        <TableHeader><TableRow><TableHead>Person</TableHead><TableHead>Role</TableHead><TableHead>Team</TableHead><TableHead>Access</TableHead><TableHead>Joined</TableHead><TableHead><span className="sr-only">Actions</span></TableHead></TableRow></TableHeader>
        <TableBody>{shown.map(m => {
          const state = accessOf(m);
          return <TableRow key={m.id} className={clsx(!m.isActive && 'inactive-row')}>
            <TableCell><span className="person-cell"><Avatar member={m} /><span className="person-text"><strong>{m.name}{m.id === data.currentUser.id && <small className="lead-tag">You</small>}</strong><span>{m.email}</span></span></span></TableCell>
            <TableCell><RoleBadge role={m.role} />{m.isTeamLead && <small className="lead-tag">Team lead</small>}</TableCell>
            <TableCell>{m.role === 'requester' ? m.departmentId ? <TeamTag data={data} id={m.departmentId} /> : <span className="cell-muted">No team yet</span> : <span className="cell-muted">{m.role === 'project_manager' ? 'Reviews every team' : 'Tech team'}</span>}</TableCell>
            <TableCell><Badge variant="outline" className={clsx('access-tag', state === 'inactive' && 'access-inactive', state === 'invited' && 'access-invited')}><i />{state === 'inactive' ? 'No access' : state === 'invited' ? 'Not signed in yet' : 'Active'}</Badge></TableCell>
            <TableCell><span className="cell-muted">{m.joinedOn ? displayDate(m.joinedOn, { year: 'numeric' }) : '—'}</span></TableCell>
            <TableCell><div className="row-actions">{editable.includes(m.role) && <Button variant="ghost" size="icon" aria-label={`Edit ${m.name}`} title="Edit person" onClick={() => onEdit(m)}><Pencil size={15} /></Button>}</div></TableCell>
          </TableRow>;
        })}</TableBody>
      </Table></div>
      {shown.length === 0 && <EmptyState title="No one matches" description={filtering ? 'Try another role, access, or search.' : 'Add the first person.'} />}
    </Card>
  </>;
}
