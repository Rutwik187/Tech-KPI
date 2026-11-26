"use client";

import Link from 'next/link';
import { ArrowRight, Building2, CheckCheck, Clock3, Forward, Hourglass, Inbox, Users } from 'lucide-react';
import type { DashboardData } from '@/lib/types';
import { isOrgAdmin, ROLE_NAMES, ROLES } from '@/lib/permissions';
import { daysBetween } from '@/lib/timeline';
import { Panel } from '@/components/ui';
import { Button } from '@/components/ui/button';
import { dateKey } from '@/lib/kpi';
import { activeDepartments, requestStage, routeFor, today, type RequestStage } from './lib';
import { TeamTag } from './requests';

/**
 * The organisation at a glance, at the top of the overview for an admin and the tech lead: where every request is,
 * how long requests wait before a developer has them, and which teams ask for the most. An admin also sees who is in the workspace.
 */
export function OrgOverview({ data }: { data: DashboardData }) {
  const timezone = data.settings.timezone;
  const day = today(timezone);
  const stages = data.techRequests.map(request => ({ request, stage: requestStage(data, request) }));
  const count = (...wanted: RequestStage[]) => stages.filter(row => wanted.includes(row.stage)).length;
  const month = day.slice(0, 7);
  const doneThisMonth = stages.filter(({ request, stage }) => stage === 'done' && (request.work?.doneAt ?? request.updatedAt).slice(0, 7) === month).length;
  // From raised to assigned, for requests assigned in the last 90 days.
  const waits = data.techRequests.filter(r => r.status === 'assigned' && r.reviewedAt && daysBetween(dateKey(r.reviewedAt, timezone), day) <= 90)
    .map(r => daysBetween(dateKey(r.createdAt, timezone), dateKey(r.reviewedAt!, timezone)));
  const averageWait = waits.length ? Math.round(waits.reduce((sum, value) => sum + value, 0) / waits.length * 10) / 10 : null;
  const openByTeam = activeDepartments(data).map(team => ({ team, open: stages.filter(({ request, stage }) => request.departmentId === team.id && !['done', 'declined'].includes(stage)).length }))
    .filter(row => row.open > 0).sort((a, b) => b.open - a.open).slice(0, 5);
  const admin = isOrgAdmin(data.currentUser);
  const people = ROLES.map(role => ({ role, count: data.members.filter(m => m.isActive && m.role === role).length })).filter(row => row.count > 0);
  const tiles = [
    { icon: <Inbox />, value: count('with_pm'), label: 'with project managers' },
    { icon: <Forward />, value: count('with_lead'), label: 'waiting to be assigned' },
    { icon: <Clock3 />, value: count('assigned', 'in_progress', 'checking'), label: 'with a developer' },
    { icon: <CheckCheck />, value: doneThisMonth, label: 'done this month' },
    { icon: <Hourglass />, value: averageWait === null ? '—' : `${averageWait} d`, label: 'average wait until assigned' },
  ];
  return <Panel title="Requests across the organisation" className="org-overview" action={<Button variant="link" size="sm" asChild><Link href={routeFor(data, 'requests')}>Open requests<ArrowRight data-icon="inline-end" /></Link></Button>}>
    <div className="org-body">
    <div className="org-tiles">{tiles.map(tile => <div key={tile.label}><span className="mini-metric-icon">{tile.icon}</span><strong>{tile.value}</strong><span>{tile.label}</span></div>)}</div>
    <div className="org-columns">
      <section>
        <h3><Building2 aria-hidden="true" />Open requests by team</h3>
        {openByTeam.length ? <ul className="org-team-list">{openByTeam.map(({ team, open }) => <li key={team.id}>
          <TeamTag data={data} id={team.id} /><span className="org-bar" aria-hidden="true"><i style={{ width: `${Math.max(8, open / openByTeam[0].open * 100)}%` }} /></span><Link href={routeFor(data, `requests?team=${team.id}&status=all`)}>{open}</Link>
        </li>)}</ul> : <p className="form-help">No team has an open request.</p>}
      </section>
      {admin && <section>
        <h3><Users aria-hidden="true" />People in the workspace</h3>
        <ul className="org-people-list">{people.map(row => <li key={row.role}><span>{ROLE_NAMES[row.role]}</span><strong>{row.count}</strong></li>)}</ul>
        <Button variant="link" size="sm" asChild><Link href={routeFor(data, 'people')}>Manage people<ArrowRight data-icon="inline-end" /></Link></Button>
      </section>}
    </div>
    </div>
  </Panel>;
}
