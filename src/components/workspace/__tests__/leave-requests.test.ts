import { describe, expect, it } from 'vitest';
import { createDemoData } from '@/lib/demo';
import { calculateMemberKpi } from '@/lib/kpi';
import { actionSchema } from '@/server/validation';
import { mutateDemo, viewAs } from '../lib';

const fixture = () => createDemoData(new Date('2026-11-04T12:00:00+05:30'));
const ask = { action: 'requestLeave', date: '2026-11-06', endDate: '2026-11-10', type: 'full_day', note: 'Family trip' } as const;

describe('leave requests', () => {
  it('keeps bulk leave pending without changing capacity, then records only working days on approval', () => {
    const data = fixture();
    const developer = data.members.find(m => m.role === 'developer')!;
    const pending = mutateDemo(data, ask, developer);
    const request = pending.leaveRequests[0];
    expect(request.dates).toEqual(['2026-11-06', '2026-11-09', '2026-11-10']);
    expect(pending.leaves).toEqual(data.leaves);
    expect(calculateMemberKpi(developer, pending, '2026-11-09').weekCapacityHours).toBe(calculateMemberKpi(developer, data, '2026-11-09').weekCapacityHours);
    const approved = mutateDemo(pending, { action: 'approveLeaveRequest', id: request.id }, data.currentUser);
    expect(approved.leaveRequests[0].status).toBe('approved');
    expect(approved.leaves.filter(l => l.userId === developer.id).map(l => l.date)).toEqual(request.dates);
    expect(calculateMemberKpi(developer, approved, '2026-11-09').weekCapacityHours).toBeLessThan(calculateMemberKpi(developer, pending, '2026-11-09').weekCapacityHours);
    expect(() => mutateDemo(approved, { action: 'approveLeaveRequest', id: request.id }, data.currentUser)).toThrow('already reviewed');
  });

  it('restricts review to admins and withdrawal and reads to the requester', () => {
    const data = fixture();
    const [one, two] = data.members.filter(m => m.role === 'developer');
    const pending = mutateDemo(data, ask, one);
    const id = pending.leaveRequests[0].id;
    expect(viewAs(pending, two.id).leaveRequests).toEqual([]);
    expect(viewAs(pending, one.id).leaveRequests).toHaveLength(1);
    expect(viewAs(pending, 'demo-rahul').leaveRequests).toEqual([]);
    expect(() => mutateDemo(pending, { action: 'approveLeaveRequest', id }, one)).toThrow('Only admins');
    expect(() => mutateDemo(pending, { action: 'withdrawLeaveRequest', id }, two)).toThrow('not found');
    expect(mutateDemo(pending, { action: 'withdrawLeaveRequest', id }, one).leaveRequests).toEqual([]);
  });

  it('rejects duplicate pending dates and retains a decline reason without recording leave', () => {
    const data = fixture();
    const developer = data.members.find(m => m.role === 'developer')!;
    const pending = mutateDemo(data, ask, developer);
    expect(() => mutateDemo(pending, ask, developer)).toThrow('already recorded or waiting');
    const declined = mutateDemo(pending, { action: 'declineLeaveRequest', id: pending.leaveRequests[0].id, reason: 'Please choose another week.' }, data.currentUser);
    expect(declined.leaveRequests[0]).toMatchObject({ status: 'declined', reviewNote: 'Please choose another week.' });
    expect(declined.leaves).toEqual(data.leaves);
    expect(mutateDemo(declined, ask, developer).leaveRequests[0].status).toBe('pending');
  });

  it('validates dates, half days, and ownership at the API boundary', () => {
    expect(actionSchema.safeParse(ask).success).toBe(true);
    expect(actionSchema.safeParse({ ...ask, type: 'half_day' }).success).toBe(false);
    expect(actionSchema.safeParse({ ...ask, date: '2026-02-30' }).success).toBe(false);
    expect(actionSchema.safeParse({ ...ask, endDate: '2026-01-01' }).success).toBe(false);
    expect(actionSchema.safeParse({ ...ask, userIds: ['someone-else'] }).success).toBe(false);
    expect(actionSchema.safeParse({ action: 'declineLeaveRequest', id: crypto.randomUUID(), reason: ' ' }).success).toBe(false);
  });

  it('approves half days and skips dates already entered by the admin', () => {
    const data = fixture();
    const developer = data.members.find(m => m.role === 'developer')!;
    let next = mutateDemo(data, { ...ask, endDate: undefined, type: 'half_day' }, developer);
    next = mutateDemo(next, { action: 'approveLeaveRequest', id: next.leaveRequests[0].id }, data.currentUser);
    expect(next.leaves.find(l => l.userId === developer.id && l.date === ask.date)?.type).toBe('half_day');
    const pending = mutateDemo(data, ask, developer);
    const withRecorded = mutateDemo(pending, { action: 'addLeave', userIds: [developer.id], date: ask.date, type: 'full_day', note: '' }, data.currentUser);
    const approved = mutateDemo(withRecorded, { action: 'approveLeaveRequest', id: pending.leaveRequests[0].id }, data.currentUser);
    expect(approved.leaves.filter(l => l.userId === developer.id && l.date === ask.date)).toHaveLength(1);
  });
});
