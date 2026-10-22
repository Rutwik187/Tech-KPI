"use client";

import { useId, useState, type FormEvent, type KeyboardEvent } from 'react';
import clsx from 'clsx';
import { toast } from 'sonner';
import { Activity as ActivityIcon, Bug, CalendarClock, CalendarPlus, Check, ChevronDown, CircleHelp, Clock3, FileText, ListTodo, LoaderCircle, Plus, ShieldCheck, Star, X } from 'lucide-react';
import type { DashboardData, Leave, Member, Phase, Project, WorkItem } from '@/lib/types';
import { ADHOC_PROJECT_ID } from '@/lib/project-defaults';
import { addWorkingHours, getWorkCalendar, isWorkingDay, shiftDate } from '@/lib/kpi';
import { Avatar, FormCheckbox, FormDate, FormField, FormSelect, Modal } from '@/components/ui';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { FieldGroup } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { displayDate, displayDateTime, findProject, hours, isAdhocProject, isDone, leaveDays, ownerChoices, ownerHomeProject, projectMembers, projectPhases, selectableProjects, today, withOwner, withProject, type MutationFn, type PickedByHand, type PhaseDraft, type QuickAction, type WorkClassification } from './lib';

export function FormChoice({ name, value, defaultValue, onValueChange, options, disabled, id, 'aria-labelledby': labelledBy, 'aria-describedby': describedBy }: { name?: string; value?: string; defaultValue?: string; onValueChange?: (value: string) => void; options: { value: string; label: string }[]; disabled?: boolean; id?: string; 'aria-labelledby'?: string; 'aria-describedby'?: string }) {
  const [localValue, setLocalValue] = useState(defaultValue ?? options[0]?.value ?? '');
  const selected = value ?? localValue;
  return <>
    <ToggleGroup id={id} aria-labelledby={labelledBy} aria-describedby={describedBy} type="single" variant="outline" disabled={disabled} value={selected} onValueChange={next => { if (next) { setLocalValue(next); onValueChange?.(next); } }} className="choice-group">
      {options.map(option => <ToggleGroupItem key={option.value} value={option.value}>{option.label}</ToggleGroupItem>)}
    </ToggleGroup>
    {name && <Input type="hidden" name={name} value={selected} />}
  </>;
}

export function FormFooter({ busy, disabled = false, onClose, label }: { busy: boolean; disabled?: boolean; onClose: () => void; label: string }) {
  return <div className="modal-footer">
    <Button variant="outline" type="button" onClick={onClose}>Cancel</Button>
    <Button type="submit" disabled={busy || disabled}>{busy ? <LoaderCircle data-icon="inline-start" size={16} className="spin" /> : <Check data-icon="inline-start" size={16} />}{busy ? 'Saving…' : label}</Button>
  </div>;
}

/** Project, phase, and owner. A developer always owns the tickets they add, so the owner is fixed for them. */
export function ClassificationFields({ data, value, onChange, lockProjectPhase = false, retained, ownerPicked = false }: { data: DashboardData; value: WorkClassification; onChange: (value: WorkClassification) => void; lockProjectPhase?: boolean; retained?: WorkItem; ownerPicked?: boolean }) {
  const admin = data.currentUser.role === 'admin';
  // An existing ticket already has both values, so they count as picked by hand.
  const [picked, setPicked] = useState<PickedByHand>({ project: !!retained, owner: !!retained || ownerPicked });
  const projectPicked = picked.project || lockProjectPhase;
  const currentProject = findProject(data, value.projectId);
  const retainedOwner = retained?.projectId === value.projectId ? retained.assigneeId : undefined;
  const owners = ownerChoices(data, value.projectId, projectPicked, retainedOwner);
  const phases = projectPhases(data, value.projectId);
  const phase = phases.find(p => p.id === value.phaseId);
  const ownerIsPrimary = !!value.assigneeId && currentProject?.primaryMemberId === value.assigneeId;
  function chooseProject(projectId: string) {
    const next = { ...picked, project: true };
    setPicked(next);
    onChange(admin ? withProject(data, value, projectId, next) : { projectId, phaseId: null, assigneeId: data.currentUser.id });
  }
  function chooseOwner(assigneeId: string) {
    const next = { ...picked, owner: true };
    setPicked(next);
    onChange(withOwner(data, value, assigneeId, { ...next, project: projectPicked }));
  }
  return <FieldGroup className="form-grid classification-fields">
    <FormField>Project<FormSelect required value={value.projectId} disabled={lockProjectPhase} onValueChange={chooseProject}>{selectableProjects(data, retained?.projectId).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</FormSelect></FormField>
    <FormField>Phase<FormSelect value={value.phaseId ?? ''} disabled={lockProjectPhase || isAdhocProject(currentProject)} onValueChange={phaseId => onChange({ ...value, phaseId: phaseId || null })}><option value="">Ad hoc</option>{phases.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</FormSelect>
      {phase?.description && <span className="field-help">{phase.description}</span>}</FormField>
    {admin
      ? <FormField className="classification-owner">Owner<FormSelect required value={value.assigneeId} onValueChange={chooseOwner}><option value="" disabled>Choose an owner</option>{owners.map(m => <option key={m.id} value={m.id}>{m.name}{!m.isActive ? ' · Inactive' : ''}</option>)}</FormSelect>
          {ownerIsPrimary ? <span className="field-help">Primary developer on {currentProject!.name}.</span> : projectPicked && !isAdhocProject(currentProject) && !owners.length ? <span className="field-help">No members yet. Add some, or choose Ad hoc.</span> : null}</FormField>
      : <div className="classification-owner fixed-owner"><span className="fixed-owner-label">Owner</span><span className="fixed-owner-value"><Avatar member={data.currentUser} size="small" />You</span></div>}
  </FieldGroup>;
}

export function ItemForm({ data, kind: initialKind, assigneeId, mutate, onClose, busy }: { data: DashboardData; kind: 'task' | 'bug'; assigneeId?: string; mutate: MutationFn; onClose: () => void; busy: boolean }) {
  const admin = data.currentUser.role === 'admin';
  const [kind, setKind] = useState<'task' | 'bug'>(admin ? initialKind : 'task');
  const defaultOwner = admin ? assigneeId ?? data.members.find(m => m.role === 'developer' && m.isActive)?.id ?? data.currentUser.id : data.currentUser.id;
  // A known owner (a developer adding their own ticket, or "Add ticket" on someone's card) starts in their main project.
  const ownerKnown = !admin || !!assigneeId;
  const [classification, setClassification] = useState<WorkClassification>({ projectId: ownerKnown ? ownerHomeProject(data, defaultOwner) : ADHOC_PROJECT_ID, phaseId: null, assigneeId: defaultOwner });
  const [taskId, setTaskId] = useState('');
  const [severity, setSeverity] = useState<WorkItem['severity']>('normal');
  const target = severity === 'critical' ? data.settings.criticalTargetHours : data.settings.normalTargetHours;
  const fixBy = kind === 'bug' ? addWorkingHours(new Date(), target, getWorkCalendar(data, classification.assigneeId)) : null;
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const fields = new FormData(event.currentTarget);
    const ok = await mutate({
      action: 'createItem', type: kind, title: String(fields.get('title')).trim(), description: String(fields.get('description') ?? ''), ...classification,
      estimateHours: kind === 'task' ? Number(fields.get('estimateHours')) : 0, dueDate: kind === 'task' ? String(fields.get('dueDate')) || null : null,
      priority: String(fields.get('priority')) as WorkItem['priority'], severity: kind === 'bug' ? severity : 'normal', taskId: kind === 'bug' ? taskId || null : null,
    }, kind === 'task' ? 'Ticket created' : 'Bug logged. Its fix-by clock has started.');
    if (ok) onClose();
  }
  function linkTask(id: string) {
    setTaskId(id);
    const task = data.items.find(item => item.id === id);
    if (task) {
      const eligible = projectMembers(data, task.projectId);
      setClassification({ projectId: task.projectId, phaseId: task.phaseId, assigneeId: eligible.some(m => m.id === task.assigneeId) ? task.assigneeId : eligible[0]?.id ?? '' });
    }
  }
  const tickets = data.items.filter(item => item.type === 'task').sort((a, b) => Number(isDone(a)) - Number(isDone(b)) || b.createdAt.localeCompare(a.createdAt));
  return <Modal title={kind === 'task' ? 'New ticket' : 'Log a bug'} subtitle={kind === 'task' ? admin ? 'A title, an owner, and an estimate are enough to start.' : 'Add a ticket for work you are doing. Your admin approves it when it is done.' : 'Describe the problem and choose who fixes it.'} onClose={onClose}>
    <form onSubmit={submit} className="item-form">
      {admin && <ToggleGroup type="single" variant="outline" value={kind} onValueChange={value => { if (value) { setKind(value as 'task' | 'bug'); if (value === 'task') setTaskId(''); } }} className="form-kind-toggle" aria-label="Type">
        <ToggleGroupItem value="task"><ListTodo data-icon="inline-start" />Ticket</ToggleGroupItem><ToggleGroupItem value="bug"><Bug data-icon="inline-start" />Bug</ToggleGroupItem>
      </ToggleGroup>}
      <FieldGroup className="modal-form-body">
        <FormField className="title-label">{kind === 'task' ? 'Title' : 'What went wrong?'}<Input className="task-title-input" name="title" placeholder={kind === 'task' ? 'e.g. Add inventory search to the dashboard' : 'e.g. Checkout shows the wrong total'} required minLength={3} maxLength={200} autoComplete="off" /></FormField>
        {kind === 'bug' && <FormField>Linked ticket <span className="optional">optional</span><FormSelect value={taskId} onValueChange={linkTask}><option value="">No linked ticket</option>{tickets.map(item => <option key={item.id} value={item.id}>{item.key} · {item.title}</option>)}</FormSelect><span className="field-help">A linked bug takes its ticket’s project, phase, and owner.</span></FormField>}
        <ClassificationFields data={data} value={classification} onChange={setClassification} lockProjectPhase={kind === 'bug' && !!taskId} ownerPicked={ownerKnown} />
        <FieldGroup className="form-grid">
          {kind === 'task'
            ? <><FormField>Estimate <span className="optional">hours</span><Input type="number" name="estimateHours" min={.5} max={80} step={.5} defaultValue={4} required /></FormField>
                <FormField>Due date <span className="optional">optional</span><FormDate name="dueDate" min={today(data.settings.timezone)} placeholder="No due date" /></FormField></>
            : <><FormField>Severity<FormChoice value={severity} onValueChange={value => setSeverity(value as WorkItem['severity'])} options={[{ value: 'normal', label: 'Normal' }, { value: 'critical', label: 'Critical' }]} /><span className="field-help">Target: {target} working hours.</span></FormField>
                <Alert className="bug-report-note"><Clock3 /><AlertTitle>Fix by {fixBy ? displayDateTime(fixBy) : '—'}</AlertTitle><AlertDescription>On time earns 100 bug points. Up to twice the target earns 50.</AlertDescription></Alert></>}
          <FormField>Priority<FormChoice name="priority" defaultValue="medium" options={[{ value: 'low', label: 'Low' }, { value: 'medium', label: 'Medium' }, { value: 'high', label: 'High' }, { value: 'urgent', label: 'Urgent' }]} /></FormField>
        </FieldGroup>
        <Collapsible className="optional-details">
          <CollapsibleTrigger asChild><Button type="button" variant="ghost" className="w-full justify-start"><FileText data-icon="inline-start" />Add details<Badge variant="secondary">Optional</Badge><ChevronDown className="ml-auto" data-icon="inline-end" /></Button></CollapsibleTrigger>
          <CollapsibleContent forceMount className="pt-3 data-[state=closed]:hidden"><FormField>Description<Textarea name="description" placeholder={kind === 'task' ? 'What does done look like? Add links or acceptance criteria.' : 'How can someone reproduce this? Add steps or links.'} rows={4} /></FormField></CollapsibleContent>
        </Collapsible>
      </FieldGroup>
      <FormFooter busy={busy} disabled={!classification.assigneeId} onClose={onClose} label={kind === 'task' ? 'Create ticket' : 'Log bug'} />
    </form>
  </Modal>;
}

export function MemberForm({ data, editing, mutate, onClose, onLeave, busy }: { data: DashboardData; editing?: Member; mutate: MutationFn; onClose: () => void; onLeave: (userId: string) => void; busy: boolean }) {
  const [role, setRole] = useState<Member['role']>(editing?.role ?? 'developer');
  const [capacity, setCapacity] = useState(editing?.capacity ?? data.settings.defaultDevCapacityHours);
  const own = editing?.id === data.currentUser.id;
  // A live member without a linked Microsoft account has not signed in yet. Until then, the email can be corrected.
  const pending = !!editing && data.mode === 'live' && !editing.microsoftObjectId;
  const upcomingLeave = editing ? data.leaves.filter(l => l.userId === editing.id && l.date >= today(data.settings.timezone)) : [];
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const f = new FormData(event.currentTarget);
    const microsoftObjectId = String(f.get('microsoftObjectId') ?? '').trim();
    const email = String(f.get('email') ?? '').trim().toLowerCase();
    const ok = editing
      ? await mutate({ action: 'updateMember', id: editing.id, patch: { name: String(f.get('name')), role, capacity, isActive: own ? true : f.get('isActive') === 'on', ...(pending && email && email !== editing.email ? { email } : {}), ...(!editing.microsoftObjectId && microsoftObjectId ? { microsoftObjectId } : {}) } }, 'Team member updated')
      : await mutate({ action: 'createMember', name: String(f.get('name')).trim(), email, ...(microsoftObjectId ? { microsoftObjectId } : {}), role, capacity }, 'Team member added. They can sign in with Microsoft using this work email.');
    if (ok) onClose();
  }
  return <Modal title={editing ? 'Edit team member' : 'Add a team member'} subtitle={editing ? 'Change their role, weekly hours, leave, or access.' : 'Add their work email. Only people on the team can sign in.'} onClose={onClose}>
    <form onSubmit={submit}>
      <FieldGroup className="modal-form-body">
        <FormField>Full name<Input name="name" required defaultValue={editing?.name} placeholder="e.g. Aarav Sharma" /></FormField>
        <FormField>Work email<Input name="email" type="email" required disabled={!!editing && !pending} defaultValue={editing?.email} placeholder="firstname.lastname@urbangabru.in" />
          <span className="field-help">{pending ? 'Not signed in yet. You can correct the email until they do.' : editing ? 'Their Microsoft work account is linked.' : 'They sign in with the Microsoft account for this email.'}</span></FormField>
        <FormField>Microsoft user ID <span className="optional">{editing?.microsoftObjectId ? 'Object ID' : 'Optional'}</span><Input className="microsoft-id-input" name="microsoftObjectId" defaultValue={editing?.microsoftObjectId} readOnly={!!editing?.microsoftObjectId} pattern="[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}" placeholder="00000000-0000-0000-0000-000000000000" title="Use the Object ID from this person’s Microsoft Entra profile." autoComplete="off" spellCheck={false} />
          <span className="field-help">{editing?.microsoftObjectId ? 'Linked to their Microsoft company account.' : 'Only needed if their Microsoft sign-in name differs from their work email. Find it in Microsoft Entra ID → Users → the person → Overview.'}</span></FormField>
        <FieldGroup className="form-grid">
          <FormField>Role<FormChoice value={role} disabled={own} onValueChange={next => { const value = next as Member['role']; setRole(value); if (!editing) setCapacity(value === 'admin' ? data.settings.defaultLeadCapacityHours : data.settings.defaultDevCapacityHours); }} options={[{ value: 'developer', label: 'Developer' }, { value: 'admin', label: 'Admin' }]} /></FormField>
          <FormField>Hours per week<Input type="number" min={.5} max={168} step={.5} required value={capacity} onChange={event => setCapacity(Number(event.target.value))} /><span className="field-help">Leave and holidays lower this for that week.</span></FormField>
        </FieldGroup>
        {editing && editing.isActive && <div className="member-leave-row"><div><strong>Leave</strong><span>{upcomingLeave.length ? `${upcomingLeave.reduce((sum, l) => sum + (l.type === 'half_day' ? .5 : 1), 0)} upcoming day(s) recorded` : 'No upcoming leave'}</span></div><Button type="button" variant="outline" size="sm" onClick={() => onLeave(editing.id)}><CalendarPlus data-icon="inline-start" />Add leave</Button></div>}
        {editing && <FormField className="checkbox-label member-access-control"><FormCheckbox name="isActive" defaultChecked={editing.isActive} disabled={own} />Active workspace access<span className="field-help">Inactive members keep their history and cannot sign in.</span></FormField>}
        <Alert className="form-tip"><ShieldCheck size={17} /><AlertDescription><p>{role === 'admin' ? 'Admins manage the team, assign work, approve tickets, and see every score.' : 'Developers see and update their own tickets and bugs, and can add tickets for themselves.'}</p></AlertDescription></Alert>
      </FieldGroup>
      <FormFooter busy={busy} onClose={onClose} label={editing ? 'Save member' : 'Add member'} />
    </form>
  </Modal>;
}

function PhaseRow({ phase, busy, mutate }: { phase: Phase; busy: boolean; mutate: MutationFn }) {
  const [name, setName] = useState(phase.name);
  const [description, setDescription] = useState(phase.description);
  const changed = name.trim() !== phase.name || description.trim() !== phase.description;
  async function save() {
    const trimmed = name.trim();
    if (!trimmed || !changed) return;
    if (trimmed.toLowerCase() === 'ad hoc') { toast.error('Ad hoc is already the default phase. Choose another name.'); return; }
    await mutate({ action: 'updatePhase', id: phase.id, ...(trimmed !== phase.name ? { name: trimmed } : {}), ...(description.trim() !== phase.description ? { description: description.trim() } : {}) }, 'Phase saved');
  }
  const onEnter = (event: KeyboardEvent) => { if (event.key === 'Enter') { event.preventDefault(); void save(); } };
  return <div className="phase-editor-row">
    <Input aria-label={`Phase name: ${phase.name}`} value={name} maxLength={100} onChange={event => setName(event.target.value)} onKeyDown={onEnter} />
    <Input aria-label={`Phase description: ${phase.name}`} value={description} maxLength={2000} placeholder="Description (optional)" onChange={event => setDescription(event.target.value)} onKeyDown={onEnter} />
    <Button type="button" variant="outline" size="sm" aria-label={`Save phase ${phase.name}`} disabled={busy || !name.trim() || !changed} onClick={() => void save()}><Check data-icon="inline-start" />Save</Button>
  </div>;
}

export function ProjectForm({ data, editing, mutate, onClose, onExtend, busy }: { data: DashboardData; editing?: Project; mutate: MutationFn; onClose: () => void; onExtend: (project: Project) => void; busy: boolean }) {
  const [color, setColor] = useState(editing?.color ?? '#617eb7');
  const [startDate, setStartDate] = useState(editing?.startDate ?? '');
  const [targetDate, setTargetDate] = useState(editing?.targetDate ?? '');
  // Once a target exists, moving it is an extension. That needs a reason, so it has its own dialog.
  const targetLocked = !!editing?.targetDate;
  const [memberIds, setMemberIds] = useState<string[]>(editing?.memberIds ?? []);
  const [primaryId, setPrimaryId] = useState<string | null>(editing?.primaryMemberId ?? null);
  // The first person picked leads the project. If the lead leaves the list, the next member takes over.
  function toggleMember(id: string, checked: boolean) {
    const next = checked ? [...memberIds, id] : memberIds.filter(existing => existing !== id);
    setMemberIds(next);
    if (checked && !primaryId) setPrimaryId(id);
    if (!checked && primaryId === id) setPrimaryId(next[0] ?? null);
  }
  const [drafts, setDrafts] = useState<PhaseDraft[]>([]);
  const [draft, setDraft] = useState<PhaseDraft>({ name: '', description: '' });
  const membersLabelId = useId();
  const phases = editing ? projectPhases(data, editing.id) : [];
  if (editing && isAdhocProject(editing)) return <Modal title="Ad hoc" subtitle="Work outside a planned project." onClose={onClose}><div className="modal-form-body"><p className="form-help">Ad hoc is always open to every active team member. It cannot be changed.</p><Button variant="outline" onClick={onClose}>Close</Button></div></Modal>;
  const nameTaken = (name: string) => name.toLowerCase() === 'ad hoc' || [...drafts.map(d => d.name), ...phases.map(p => p.name)].some(existing => existing.toLowerCase() === name.toLowerCase());
  async function addPhase() {
    const name = draft.name.trim();
    if (!name) return;
    if (nameTaken(name)) { toast.error(name.toLowerCase() === 'ad hoc' ? 'Ad hoc is already the default phase. Choose another name.' : 'This phase already exists in the project.'); return; }
    const description = draft.description.trim();
    if (editing) { if (!await mutate({ action: 'createPhase', projectId: editing.id, name, description }, 'Phase added')) return; }
    else setDrafts(previous => [...previous, { name, description }]);
    setDraft({ name: '', description: '' });
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const fields = new FormData(event.currentTarget);
    const pending = draft.name.trim();
    if (pending && editing) { toast.error('Select Add phase to save the new phase, or clear its name.'); return; }
    if (pending && nameTaken(pending)) { toast.error('This phase already exists. Choose another name or clear it.'); return; }
    if (startDate && targetDate && targetDate < startDate) { toast.error('The target date must be on or after the start date.'); return; }
    const details = { name: String(fields.get('name')).trim(), description: String(fields.get('description')), color, memberIds, primaryMemberId: primaryId, startDate: startDate || null };
    const ok = await mutate(editing
      ? { action: 'updateProject', id: editing.id, patch: { ...details, ...(!targetLocked && targetDate ? { targetDate } : {}) } }
      : { action: 'createProject', ...details, targetDate: targetDate || null, phases: pending ? [...drafts, { name: pending, description: draft.description.trim() }] : drafts }, editing ? 'Project saved' : 'Project created');
    if (ok) onClose();
  }
  return <Modal title={editing ? 'Edit project' : 'New project'} subtitle="Name the project, choose its team, and add phases if it needs them." onClose={onClose}>
    <form onSubmit={submit}>
      <FieldGroup className="modal-form-body">
        <FormField>Project title<Input name="name" required defaultValue={editing?.name} maxLength={100} placeholder="e.g. Inventory management" /></FormField>
        <FormField>Description <span className="optional">optional</span><Textarea name="description" defaultValue={editing?.description} rows={2} placeholder="What is this project for?" /></FormField>
        <FieldGroup className="form-grid">
          <FormField>Start date <span className="optional">optional</span><FormDate value={startDate} max={targetDate || undefined} onValueChange={setStartDate} placeholder="No start date" /></FormField>
          <FormField>Target date <span className="optional">optional</span>{targetLocked
            ? <div className="locked-date"><strong>{displayDate(editing!.targetDate, { weekday: 'short', year: 'numeric' })}</strong><Button type="button" variant="outline" size="sm" onClick={() => onExtend(editing!)}><CalendarClock data-icon="inline-start" />Extend</Button></div>
            : <FormDate value={targetDate} min={startDate || undefined} onValueChange={setTargetDate} placeholder="No target date" />}
            {targetLocked && <span className="field-help">Moving it needs a reason.</span>}</FormField>
        </FieldGroup>
        <FormField>Colour<div className="color-picker"><Input aria-label="Custom project colour" type="color" value={color} onChange={event => setColor(event.target.value)} />
          <ToggleGroup type="single" variant="outline" value={color} onValueChange={value => { if (value) setColor(value); }} aria-label="Project colour presets">{['#448768', '#617eb7', '#9571b6', '#c18c47', '#b86878'].map(preset => <ToggleGroupItem key={preset} value={preset} aria-label={`Select ${preset}`}><span className="size-4 rounded-full" style={{ background: preset }} /></ToggleGroupItem>)}</ToggleGroup></div></FormField>
        <section className="project-form-section">
          <div className="project-section-heading"><h3 id={membersLabelId}>Members</h3><Badge variant="secondary">{memberIds.length} selected</Badge></div>
          <p>Only members can own this project’s tickets. The primary developer leads the project. Everyone else is a secondary developer.</p>
          <FieldGroup role="group" aria-labelledby={membersLabelId} className="project-member-list">{data.members.filter(m => m.isActive || memberIds.includes(m.id)).map(m => {
            const openCount = editing ? data.items.filter(item => item.projectId === editing.id && item.assigneeId === m.id && !isDone(item)).length : 0;
            const selected = memberIds.includes(m.id);
            const primary = selected && primaryId === m.id;
            return <div key={m.id} className={clsx('project-member-row', primary && 'is-primary')}><FormField className="project-member-choice"><FormCheckbox checked={selected} disabled={busy || (selected && openCount > 0)} onCheckedChange={checked => toggleMember(m.id, checked)} />
              <span className="project-member-name"><span aria-hidden="true"><Avatar member={m} size="small" /></span>{m.name}<Badge variant="outline">{m.role === 'admin' ? 'Admin' : 'Developer'}</Badge></span>
              {openCount > 0 && <span className="field-help">{openCount} open item{openCount === 1 ? '' : 's'} here. Finish or reassign them before removing this person.</span>}
              {!m.isActive && <span className="field-help">Inactive team member</span>}</FormField>
              {primary ? <Badge className="primary-badge"><Star data-icon="inline-start" />Primary</Badge>
                : selected && <Button type="button" variant="ghost" size="xs" disabled={busy} onClick={() => setPrimaryId(m.id)} aria-label={`Make ${m.name} the primary developer`}>Make primary</Button>}</div>;
          })}</FieldGroup>
        </section>
        <section className="project-form-section">
          <div className="project-section-heading"><h3>Phases</h3><Badge variant="secondary">Optional</Badge></div>
          <p>Phases split a project into stages, such as Design, Build, and Release. Work without a phase goes in Ad hoc.</p>
          {editing ? phases.length > 0 && <div className="phase-editor-list">{phases.map(phase => <PhaseRow key={phase.id} phase={phase} busy={busy} mutate={mutate} />)}</div>
            : drafts.length > 0 && <div className="phase-editor-list">{drafts.map(phase => <div className="phase-draft" key={phase.name}><div><strong>{phase.name}</strong>{phase.description && <span>{phase.description}</span>}</div><Button type="button" variant="ghost" size="icon-xs" aria-label={`Remove phase ${phase.name}`} onClick={() => setDrafts(previous => previous.filter(p => p.name !== phase.name))}><X /></Button></div>)}</div>}
          <div className="phase-add-row">
            <Input aria-label="New phase name" placeholder="Phase title, e.g. Build" value={draft.name} maxLength={100} onChange={event => setDraft({ ...draft, name: event.target.value })} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); void addPhase(); } }} />
            <Input aria-label="New phase description" placeholder="Description (optional)" value={draft.description} maxLength={2000} onChange={event => setDraft({ ...draft, description: event.target.value })} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); void addPhase(); } }} />
            <Button type="button" variant="outline" disabled={busy || !draft.name.trim()} onClick={() => void addPhase()}><Plus data-icon="inline-start" />Add phase</Button>
          </div>
        </section>
      </FieldGroup>
      <FormFooter busy={busy} onClose={onClose} label={editing ? 'Save project' : 'Create project'} />
    </form>
  </Modal>;
}

type LeaveLength = 'full_day' | 'half_day' | 'range';
export function LeaveForm({ data, userId, mutate, onClose, busy }: { data: DashboardData; userId?: string; mutate: MutationFn; onClose: () => void; busy: boolean }) {
  const people = data.members.filter(m => m.isActive);
  const day = today(data.settings.timezone);
  const [personId, setPersonId] = useState(userId ?? people[0]?.id ?? '');
  const [length, setLength] = useState<LeaveLength>('full_day');
  const [start, setStart] = useState(day);
  const [end, setEnd] = useState(shiftDate(day, 4, data.settings.timezone));
  const person = people.find(m => m.id === personId);
  const days = length === 'range' ? leaveDays(data, start, end) : start ? [start] : [];
  const taken = new Set(data.leaves.filter(l => l.userId === personId).map(l => l.date));
  const fresh = days.filter(date => !taken.has(date));
  const workingDays = new Set(data.settings.workingDays).size || 1;
  const singleOffDay = length !== 'range' && !!start && !isWorkingDay(start, getWorkCalendar(data));
  const lostHours = person && !singleOffDay ? person.capacity / workingDays * fresh.length * (length === 'half_day' ? .5 : 1) : 0;
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const note = String(new FormData(event.currentTarget).get('note') ?? '').trim();
    const ok = await mutate({ action: 'addLeave', userId: personId, date: start, ...(length === 'range' ? { endDate: end } : {}), type: (length === 'half_day' ? 'half_day' : 'full_day') as Leave['type'], note }, 'Leave added. Hours at work updated.');
    if (ok) onClose();
  }
  return <Modal title="Add leave" subtitle="Leave lowers hours at work for that week, so the score stays fair." onClose={onClose}>
    <form onSubmit={submit}>
      <FieldGroup className="modal-form-body">
        <FormField>Team member<FormSelect value={personId} onValueChange={setPersonId} required>{people.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}</FormSelect></FormField>
        <FormField>Length<FormChoice value={length} onValueChange={value => setLength(value as LeaveLength)} options={[{ value: 'full_day', label: 'Full day' }, { value: 'half_day', label: 'Half day' }, { value: 'range', label: 'Several days' }]} /></FormField>
        <FieldGroup className="form-grid">
          <FormField>{length === 'range' ? 'First day' : 'Date'}<FormDate required value={start} onValueChange={next => { setStart(next); if (next > end) setEnd(next); }} /></FormField>
          {length === 'range' && <FormField>Last day<FormDate required value={end} min={start} onValueChange={setEnd} /></FormField>}
        </FieldGroup>
        <Alert className="form-tip"><CircleHelp size={17} /><AlertDescription><p>{
          fresh.length === 0 ? days.length ? 'Leave is already recorded for these days.' : 'Choose dates to see the effect.'
          : `${length === 'half_day' ? 'Half a day' : `${fresh.length} working day${fresh.length === 1 ? '' : 's'}`}${length === 'range' ? ` from ${displayDate(start)} to ${displayDate(end)}` : ` on ${displayDate(start, { weekday: 'short' })}`}. Lowers ${person ? `${person.name.split(' ')[0]}’s` : 'their'} hours at work by ${hours(lostHours)} h.${length === 'range' ? ' Weekends and holidays are skipped.' : ''}${singleOffDay ? ' This date is already a day off.' : ''}${days.length > fresh.length ? ` ${days.length - fresh.length} day(s) already recorded will be skipped.` : ''}`
        }</p></AlertDescription></Alert>
        <FormField>Note <span className="optional">optional</span><Input name="note" placeholder="e.g. Family function" maxLength={200} /></FormField>
      </FieldGroup>
      <FormFooter busy={busy} disabled={!personId || fresh.length === 0 || (length === 'range' && end < start)} onClose={onClose} label="Add leave" />
    </form>
  </Modal>;
}

export function HolidayForm({ mutate, onClose, busy }: { mutate: MutationFn; onClose: () => void; busy: boolean }) {
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const f = new FormData(event.currentTarget);
    const ok = await mutate({ action: 'addHoliday', date: String(f.get('date')), name: String(f.get('name')) }, 'Holiday added. Hours at work updated.');
    if (ok) onClose();
  }
  return <Modal title="Add a holiday" subtitle="A day off for the whole team. It lowers everyone’s hours at work." onClose={onClose}>
    <form onSubmit={submit}>
      <FieldGroup className="modal-form-body">
        <FormField>Holiday name<Input name="name" required placeholder="e.g. Diwali" maxLength={100} /></FormField>
        <FormField>Date<FormDate name="date" required /></FormField>
      </FieldGroup>
      <FormFooter busy={busy} onClose={onClose} label="Add holiday" />
    </form>
  </Modal>;
}

/** Changes that need a reason: blocking, sending back, reopening, or revising an estimate. Also sets a first due date. Moving a date uses ExtendForm. */
export function ReasonForm({ action, data, mutate, onClose, busy }: { action: QuickAction; data: DashboardData; mutate: MutationFn; onClose: () => void; busy: boolean }) {
  const estimate = action.patch.estimateHours !== undefined;
  const due = action.patch.dueDate !== undefined;
  const firstDue = due && !action.item.dueDate;
  const blocked = action.patch.status === 'blocked';
  const day = today(data.settings.timezone);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const f = new FormData(event.currentTarget);
    const reason = String(f.get('reason') ?? '').trim();
    const patch = { ...action.patch };
    if (estimate) patch.estimateHours = Number(f.get('estimateHours'));
    if (due) patch.dueDate = String(f.get('dueDate'));
    if (blocked) patch.blocker = reason;
    const message = blocked ? 'Blocker saved. Your admin can see it.' : firstDue ? 'Due date set' : 'Saved. The reason is in the timeline.';
    const ok = await mutate({ action: 'updateItem', id: action.item.id, patch, ...(reason ? { reason } : {}), ...(estimate ? { reasonCategory: 'scope_change' } : {}) }, message);
    if (ok) onClose();
  }
  return <Modal title={action.label} subtitle={`${action.item.key} · ${action.item.title}`} onClose={onClose}>
    <form onSubmit={submit}>
      <FieldGroup className="modal-form-body">
        {estimate && <><Alert className="form-tip"><CircleHelp size={17} /><AlertDescription><p>Change the estimate only when the scope changes. If the same work needs more time, extend the due date instead.</p></AlertDescription></Alert>
          <FormField>New estimate <span className="optional">hours</span><Input type="number" name="estimateHours" min={.5} max={80} step={.5} defaultValue={action.item.estimateHours} required /></FormField></>}
        {firstDue && <FormField>Due date<FormDate name="dueDate" required min={day} /></FormField>}
        {!firstDue && <FormField>{blocked ? 'What is blocking this ticket?' : 'Reason'}<Textarea name="reason" required minLength={3} rows={3} placeholder={blocked ? 'Name the person or thing you are waiting for.' : 'A short explanation for the team.'} /></FormField>}
        {!firstDue && <div className="form-help"><ActivityIcon size={13} />This reason appears in the ticket timeline.</div>}
      </FieldGroup>
      <FormFooter busy={busy} onClose={onClose} label={action.label} />
    </form>
  </Modal>;
}
