"use client";

import { useState, type FormEvent } from 'react';
import type { DashboardData, LeaveRequest } from '@/lib/types';
import { EmptyState, FormField, Modal, Panel } from '@/components/ui';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { FieldGroup } from '@/components/ui/field';
import { Textarea } from '@/components/ui/textarea';
import { displayDate, displayDateTime, findMember, type MutationFn } from './lib';
import { FormFooter, LeaveForm } from './forms';

export function LeaveRequests({ data, mutate, busy }: { data: DashboardData; mutate: MutationFn; busy: boolean }) {
  const admin = data.currentUser.role === 'admin';
  const [asking, setAsking] = useState(false);
  const [declining, setDeclining] = useState<LeaveRequest | null>(null);
  const order = { pending: 0, declined: 1, approved: 2 };
  const requests = [...(data.leaveRequests ?? [])].filter(r => admin || r.requesterId === data.currentUser.id)
    .sort((a, b) => order[a.status] - order[b.status] || b.createdAt.localeCompare(a.createdAt));
  async function decline(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!declining) return;
    const reason = String(new FormData(event.currentTarget).get('reason') ?? '').trim();
    if (await mutate({ action: 'declineLeaveRequest', id: declining.id, reason }, 'Leave request declined')) setDeclining(null);
  }
  return <>
    <Panel title={admin ? 'Leave requests' : 'Your leave requests'} action={!admin && <Button variant="link" size="sm" onClick={() => setAsking(true)}>Request leave</Button>}>
      <p className="panel-intro">{admin ? 'Approve leave to record the dates and update hours at work. Decline with a reason if the dates do not work.' : 'Request a full day, half day, or a range of days. Your hours change after admin approval.'}</p>
      {requests.length ? <div className="request-list">{requests.map(request => <article key={request.id} className={`request-card request-${request.status}`}>
        <header className="request-card-head">
          {admin && <strong>{findMember(data, request.requesterId)?.name ?? 'Team member'}</strong>}
          <span className="request-time">Asked {displayDateTime(request.createdAt)}</span>
          <Badge variant="outline">{request.status === 'pending' ? 'Waiting for approval' : request.status === 'approved' ? 'Approved' : 'Declined'}</Badge>
        </header>
        <h3 className="request-title">{request.type === 'half_day' ? 'Half day' : `${request.dates.length} working day${request.dates.length === 1 ? '' : 's'}`}</h3>
        <p className="request-description">{request.dates.map(date => displayDate(date, { year: 'numeric' })).join(', ')}</p>
        {request.note && <p className="request-note">{request.note}</p>}
        {request.reviewNote && <p className="request-review"><strong>Admin reason:</strong> {request.reviewNote}</p>}
        {request.status === 'pending' && <footer className="request-card-actions">{admin ? <>
          <Button variant="outline" size="sm" disabled={busy} onClick={() => setDeclining(request)}>Decline</Button>
          <Button size="sm" disabled={busy} onClick={() => mutate({ action: 'approveLeaveRequest', id: request.id }, 'Leave approved. Hours at work updated.')}>Approve</Button>
        </> : <Button variant="ghost" size="sm" disabled={busy} onClick={() => mutate({ action: 'withdrawLeaveRequest', id: request.id }, 'Leave request withdrawn')}>Withdraw</Button>}</footer>}
      </article>)}</div> : <EmptyState title="No leave requests" description={admin ? 'Leave requests from teammates will appear here for approval.' : 'Your leave requests and admin decisions will appear here.'} />}
    </Panel>
    {asking && <LeaveForm data={data} mutate={mutate} busy={busy} onClose={() => setAsking(false)} />}
    {declining && <Modal title="Decline leave request" subtitle="Tell your teammate why these dates cannot be approved." onClose={() => setDeclining(null)}>
      <form onSubmit={decline}>
        <FieldGroup className="modal-form-body"><FormField>Reason<Textarea name="reason" required maxLength={2000} rows={3} /></FormField></FieldGroup>
        <FormFooter busy={busy} onClose={() => setDeclining(null)} label="Decline leave" />
      </form>
    </Modal>}
  </>;
}
