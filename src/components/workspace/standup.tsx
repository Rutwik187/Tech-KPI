"use client";

import { useState, type FormEvent } from 'react';
import { Bug, CircleCheck, CornerDownLeft, Plus } from 'lucide-react';
import type { DashboardData } from '@/lib/types';
import { ADHOC_PROJECT_ID } from '@/lib/project-defaults';
import { calculateMemberKpi } from '@/lib/kpi';
import { Avatar, FormField, FormSelect, Panel, ProgressBar, StatusBadge } from '@/components/ui';
import { Button } from '@/components/ui/button';
import { FieldGroup } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { displayDate, hours, isDone, ownerChoices, projectPhases, selectableProjects, withOwner, withProject, type MutationFn, type OnAction, type PickedByHand, type WorkClassification } from './lib';
import { ItemActions, ScoreBadge } from './parts';

export function Standup({ data, week, onOpen, onAction, onAdd, mutate, busy }: { data: DashboardData; week: string; onOpen: (id: string) => void; onAction: OnAction; onAdd: (kind: 'task' | 'bug', assigneeId?: string) => void; mutate: MutationFn; busy: boolean }) {
  const [title, setTitle] = useState('');
  const people = data.members.filter(m => m.isActive);
  const [classification, setClassification] = useState<WorkClassification>({ projectId: ADHOC_PROJECT_ID, phaseId: null, assigneeId: people.find(m => m.role === 'developer')?.id ?? data.currentUser.id });
  const [picked, setPicked] = useState<PickedByHand>({ project: false, owner: false });
  function chooseProject(projectId: string) {
    const next = { ...picked, project: true };
    setPicked(next);
    setClassification(withProject(data, classification, projectId, next));
  }
  function chooseOwner(assigneeId: string) {
    const next = { ...picked, owner: true };
    setPicked(next);
    setClassification(withOwner(data, classification, assigneeId, next));
  }
  async function add(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const fields = new FormData(form);
    const ok = await mutate({ action: 'createItem', type: 'task', title: title.trim(), ...classification, estimateHours: Number(fields.get('estimateHours')), dueDate: String(fields.get('dueDate')) || null, priority: 'medium', severity: 'normal', description: '', taskId: null }, 'Ticket added. Ready for the next one.');
    if (ok) { setTitle(''); form.querySelector<HTMLInputElement>('input[name="title"]')?.focus(); }
  }
  return <>
    <Panel title="Quick add a ticket" action={<span className="keyboard-hint"><CornerDownLeft size={13} />Press Enter to add</span>}>
      <form className="standup-form" onSubmit={add}><FieldGroup className="standup-quick-form standup-with-phases">
        <FormField>Owner<FormSelect name="assigneeId" required value={classification.assigneeId} onValueChange={chooseOwner}><option value="" disabled>Choose an owner</option>{ownerChoices(data, classification.projectId, picked.project).map(m => <option key={m.id} value={m.id}>{m.name}</option>)}</FormSelect></FormField>
        <FormField className="standup-title-field">Ticket title<Input name="title" required minLength={3} maxLength={200} placeholder="What needs to be done?" value={title} onChange={event => setTitle(event.target.value)} autoComplete="off" /></FormField>
        <FormField>Project<FormSelect name="projectId" required value={classification.projectId} onValueChange={chooseProject}>{selectableProjects(data).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</FormSelect></FormField>
        <FormField>Phase<FormSelect value={classification.phaseId ?? ''} disabled={classification.projectId === ADHOC_PROJECT_ID} onValueChange={phaseId => setClassification({ ...classification, phaseId: phaseId || null })}><option value="">Ad hoc</option>{projectPhases(data, classification.projectId).map(phase => <option key={phase.id} value={phase.id}>{phase.name}</option>)}</FormSelect></FormField>
        <FormField>Hours<Input type="number" name="estimateHours" defaultValue={4} min={.5} max={80} step={.5} required /></FormField>
        <FormField>Due date<Input type="date" name="dueDate" /></FormField>
        <Button type="submit" disabled={busy || !classification.assigneeId || title.trim().length < 3}><Plus data-icon="inline-start" />Add</Button>
      </FieldGroup></form>
    </Panel>
    <div className="section-label"><h2>Who is working on what</h2><span>{people.length} people · {displayDate(new Date(), { weekday: 'long' })}</span></div>
    <div className="standup-grid">{people.map(person => {
      const score = calculateMemberKpi(person, data, week);
      const tickets = data.items.filter(item => item.assigneeId === person.id && item.type === 'task' && !isDone(item));
      const bugs = data.items.filter(item => item.assigneeId === person.id && item.type === 'bug' && !isDone(item));
      return <Panel key={person.id} className="standup-person">
        <div className="standup-person-heading"><Avatar member={person} /><div><h3>{person.name}</h3><span>{person.role === 'admin' ? 'Admin' : 'Developer'}</span></div><ScoreBadge score={score.efficiency} band={score.band} /></div>
        <div className="standup-capacity"><span>{hours(score.creditedHours)} of {hours(score.capacityHours)} h done</span><span>{hours(score.pendingHours)} h open</span><ProgressBar value={score.deliveryRaw} label={`${person.name} ticket hours`} /></div>
        <div className="standup-task-list">{tickets.length === 0
          ? <div className="standup-clear"><CircleCheck size={17} /><p>No open tickets. Ready for the next one.</p></div>
          : tickets.map(item => <div className="standup-task" key={item.id}>
              <Button variant="ghost" className="item-name" onClick={() => onOpen(item.id)}>{item.title}</Button>
              <div><StatusBadge status={item.status} /><span className="estimate-cell">{item.estimateHours} h</span><ItemActions item={item} admin onAction={onAction} busy={busy} compact /></div>
              {item.status === 'blocked' && <span className="blocked-inline">{item.blocker ?? 'Blocked. Open the ticket to add the reason.'}</span>}
            </div>)}</div>
        <div className="standup-person-footer">
          <Button variant="link" size="sm" onClick={() => onAdd('task', person.id)}><Plus data-icon="inline-start" size={13} />Add ticket</Button>
          <Button variant="link" size="sm" onClick={() => onAdd('bug', person.id)}><Bug data-icon="inline-start" size={13} />{bugs.length} open bug{bugs.length === 1 ? '' : 's'} · Log bug</Button>
        </div>
      </Panel>;
    })}</div>
  </>;
}
