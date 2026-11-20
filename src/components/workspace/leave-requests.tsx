"use client";

import { useState, type FormEvent, type ReactNode } from 'react';
import Link from 'next/link';
import { ArrowRight, CalendarDays, Check, CheckCheck, MessageSquareText, Users, X } from 'lucide-react';
import type { DashboardData, LeaveRequest } from '@/lib/types';
import { Avatar, EmptyState, FormField, Modal, Panel } from '@/components/ui';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { FieldGroup } from '@/components/ui/field';
import { Textarea } from '@/components/ui/textarea';
import { displayDate, displayDateTime, displayDays, findMember, firstName, routeFor, type MutationFn } from './lib';
import { FormChoice, FormFooter } from './forms';

const statusLabel: Record<LeaveRequest['status'], string> = { pending: 'Waiting for approval', approved: 'Approved', declined: 'Declined' };
type Filter = 'all' | LeaveRequest['status'];

/** The length of a request, such as "3 working days" or "Half day". */
export function leaveLength(request: Pick<LeaveRequest, 'type' | 'dates'>) {
  return request.type === 'half_day' ? 'Half day' : `${request.dates.length} working day${request.dates.length === 1 ? '' : 's'}`;
}

/**
 * Leave requests. Admins see everyone's and approve or decline them. A developer sees their own and can withdraw one that waits.
 * With `pendingOnly`, it shows only requests that wait, and nothing when none wait.
 */
export function LeaveRequests({ data, mutate, busy, pendingOnly = false }: { data: DashboardData; mutate: MutationFn; busy: boolean; pendingOnly?: boolean }) {
  const admin = data.currentUser.role === 'admin';
  const [filter, setFilter] = useState<Filter>('all');
  const [declining, setDeclining] = useState<LeaveRequest | null>(null);
  const [withdrawing, setWithdrawing] = useState<string | null>(null);
  const order = { pending: 0, declined: 1, approved: 2 };
  const all = [...(data.leaveRequests ?? [])].filter(r => admin || r.requesterId === data.currentUser.id)
    .sort((a, b) => order[a.status] - order[b.status] || b.createdAt.localeCompare(a.createdAt));
  const count = (status: LeaveRequest['status']) => all.filter(r => r.status === status).length;
  const shown = pendingOnly ? all.filter(r => r.status === 'pending') : filter === 'all' ? all : all.filter(r => r.status === filter);
  if (pendingOnly && !shown.length) return null;
  async function decline(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!declining) return;
    const reason = String(new FormData(event.currentTarget).get('reason') ?? '').trim();
    if (await mutate({ action: 'declineLeaveRequest', id: declining.id, reason }, 'Leave request declined')) setDeclining(null);
  }
  const title = pendingOnly ? admin ? 'Leave requests to approve' : 'Your leave requests waiting' : admin ? 'Leave requests' : 'Your leave requests';
  const calendarLink = <Button variant="link" size="sm" asChild><Link href={routeFor(data, 'leave')}>Leave calendar<ArrowRight data-icon="inline-end" /></Link></Button>;
  return <>
    <Panel title={title} action={pendingOnly ? calendarLink : undefined}>
      <p className="panel-intro">{admin
        ? 'Approve leave to record the days and lower that person’s hours at work. Decline with a reason if the days do not work.'
        : 'Every leave request you sent, and what your admin decided. Your hours at work change only after approval.'}</p>
      {!pendingOnly && all.length > 0 && <div className="leave-filter">
        <FormChoice value={filter} onValueChange={value => setFilter(value as Filter)} options={[
          { value: 'all', label: `All (${all.length})` },
          { value: 'pending', label: `Waiting (${count('pending')})` },
          { value: 'approved', label: `Approved (${count('approved')})` },
          { value: 'declined', label: `Declined (${count('declined')})` },
        ]} />
      </div>}
      {shown.length ? <div className="request-list">{shown.map(request => <LeaveRequestCard key={request.id} data={data} request={request} admin={admin} actions={request.status !== 'pending' ? undefined : admin ? <>
          <Button variant="outline" size="sm" disabled={busy} onClick={() => setDeclining(request)}><X data-icon="inline-start" />Decline</Button>
          <Button size="sm" disabled={busy} onClick={() => mutate({ action: 'approveLeaveRequest', id: request.id }, 'Leave approved. Hours at work updated.')}><Check data-icon="inline-start" />Approve</Button>
        </> : withdrawing === request.id
          ? <span className="confirm-inline"><span>Withdraw this request?</span><Button size="sm" variant="destructive" disabled={busy} onClick={async () => { if (await mutate({ action: 'withdrawLeaveRequest', id: request.id }, 'Leave request withdrawn')) setWithdrawing(null); }}>Withdraw</Button><Button size="sm" variant="ghost" onClick={() => setWithdrawing(null)}>Keep</Button></span>
          : <Button variant="ghost" size="sm" disabled={busy} onClick={() => setWithdrawing(request.id)}>Withdraw</Button>} />)}</div>
        : <EmptyState title={all.length ? 'No requests here' : 'No leave requests'} description={all.length ? 'Choose another filter to see more requests.' : admin ? 'Leave requests from teammates will appear here for approval.' : 'When you request leave, it appears here with your admin’s decision.'} />}
    </Panel>
    {declining && <Modal title="Decline leave request" subtitle={`${findMember(data, declining.requesterId)?.name ?? 'Your teammate'} asked for ${displayDays(data, declining.dates)}. Tell them why these days cannot be approved.`} onClose={() => setDeclining(null)}>
      <form onSubmit={decline}>
        <FieldGroup className="modal-form-body"><FormField>Reason<Textarea name="reason" required maxLength={2000} rows={3} /></FormField></FieldGroup>
        <FormFooter busy={busy} onClose={() => setDeclining(null)} label="Decline leave" />
      </form>
    </Modal>}
  </>;
}

function LeaveRequestCard({ data, request, admin, actions }: { data: DashboardData; request: LeaveRequest; admin: boolean; actions?: ReactNode }) {
  const person = findMember(data, request.requesterId);
  const reviewer = request.reviewedById ? findMember(data, request.reviewedById) : undefined;
  // While it waits, show the admin who else is away on those days.
  const alsoAway = admin && request.status === 'pending'
    ? [...new Set(data.leaves.filter(l => l.userId !== request.requesterId && request.dates.includes(l.date)).map(l => l.userId))].map(id => findMember(data, id)).filter(m => !!m)
    : [];
  return <article className={`request-card request-${request.status}`}>
    <header className="request-card-head">
      {admin && <><Avatar member={person} size="small" /><strong>{person?.name ?? 'Former team member'}</strong></>}
      <span className="request-time">Asked {displayDateTime(request.createdAt)}</span>
      <Badge variant="outline" className={`request-status request-status-${request.status}`}><i />{statusLabel[request.status]}</Badge>
    </header>
    <h3 className="request-title">{leaveLength(request)}</h3>
    <p className="leave-request-days"><CalendarDays size={14} /><span>{displayDays(data, request.dates)}</span></p>
    {request.note && <p className="request-note"><MessageSquareText size={14} /><span>{request.note}</span></p>}
    {alsoAway.length > 0 && <p className="request-warning"><Users size={14} /><span>Also on leave on some of these days: {alsoAway.map(m => firstName(m)).join(', ')}.</span></p>}
    {request.status !== 'pending' && request.reviewedAt && <p className="request-review"><CheckCheck size={14} /><span>
      <strong>{statusLabel[request.status]}</strong> {reviewer ? `by ${firstName(reviewer)} ` : ''}on {displayDate(request.reviewedAt)}{request.reviewNote ? `. ${request.status === 'declined' ? 'Reason' : 'Note'}: ${request.reviewNote}` : '.'}
    </span></p>}
    {actions && <footer className="request-card-actions">{actions}</footer>}
  </article>;
}
