"use client";

import { useState } from 'react';
import clsx from 'clsx';
import { CalendarDays, Check, CheckCheck, ListChecks, MessageSquareText, Plus, Send, Trash2 } from 'lucide-react';
import type { DashboardData, PlanFeature, PlanMilestone, RequestPlan, SharedPlan, TechRequest } from '@/lib/types';
import { FormDate } from '@/components/ui';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { displayDate, displayDateTime, requestPermissions, today, type MutationFn } from './lib';

const EMPTY: RequestPlan = { features: [], timeline: [], notes: '' };
const newId = () => crypto.randomUUID().slice(0, 8);
/** True when two plans say the same thing, so the page can tell whether the draft has changes not sent yet. */
function samePlan(a: RequestPlan | null, b: RequestPlan | null) {
  const clean = (plan: RequestPlan | null) => JSON.stringify(plan ? { f: plan.features.map(f => f.text.trim()), t: plan.timeline.map(t => [t.title.trim(), t.date]), n: plan.notes.trim() } : null);
  return clean(a) === clean(b);
}

/** A plan's feature list, timeline, and notes, read-only. Used for the latest plan and for each version in the conversation. */
export function PlanView({ plan, compact = false }: { plan: RequestPlan; compact?: boolean }) {
  return <div className={clsx('plan-view', compact && 'is-compact')}>
    {plan.features.length > 0 && <div><h4><ListChecks aria-hidden="true" />What will be built</h4>
      <ol className="plan-features">{plan.features.map(feature => <li key={feature.id}><Check aria-hidden="true" />{feature.text}</li>)}</ol></div>}
    {plan.timeline.length > 0 && <div><h4><CalendarDays aria-hidden="true" />Timeline</h4>
      <ol className="plan-timeline">{plan.timeline.map(step => <li key={step.id}><time dateTime={step.date}>{displayDate(step.date, { weekday: 'short' })}</time><span>{step.title}</span></li>)}</ol></div>}
    {plan.notes && <div><h4><MessageSquareText aria-hidden="true" />Notes</h4><p className="plan-notes">{plan.notes}</p></div>}
  </div>;
}

/** Who sent the plan, when, and whether the requester confirmed it. */
function SharedLine({ data, request, shared }: { data: DashboardData; request: TechRequest; shared: SharedPlan }) {
  const me = data.currentUser;
  return <p className="plan-status">
    <span className="plan-version">Version {shared.version}</span>
    sent {displayDateTime(shared.sharedAt)} by {shared.sharedById === me.id ? 'you' : shared.sharedByName}
    {shared.confirmedAt
      ? <span className="plan-confirmed"><CheckCheck aria-hidden="true" />{request.requesterId === me.id ? 'You confirmed it' : `${request.requesterName.split(' ')[0]} confirmed it`} {displayDateTime(shared.confirmedAt)}</span>
      : <span className="plan-waiting">{request.requesterId === me.id ? 'Waiting for you to read it' : `Waiting for ${request.requesterName.split(' ')[0]}`}</span>}
  </p>;
}

type SectionProps = { data: DashboardData; request: TechRequest; mutate: MutationFn; busy: boolean; onAskForChanges?: () => void };

/**
 * The plan for a request. Project managers and the tech lead write the feature list, the timeline, and notes, save a draft,
 * and send it to the requester. The requester reads what was sent, says it looks good, or asks for changes in the conversation.
 */
export function PlanSection({ data, request, mutate, busy, onAskForChanges }: SectionProps) {
  const can = requestPermissions(data, request);
  const shared = request.sharedPlan;
  const [editing, setEditing] = useState(false);
  const draft = request.plan ?? (shared ? { features: shared.features, timeline: shared.timeline, notes: shared.notes } : null);

  if (!can.plan) {
    // A requester and a developer read the plan. A requester reads only what was sent.
    const shown = data.currentUser.role === 'requester' ? shared : shared ?? request.plan;
    if (!shown) return null;
    return <section className="drawer-section plan-section">
      <h3 className="detail-section-heading">Plan</h3>
      {shared && <SharedLine data={data} request={request} shared={shared} />}
      <PlanView plan={shown} />
      {can.confirmPlan && shared && <div className="plan-confirm">
        <p>Does this cover what you need?</p>
        <Button variant="outline" size="sm" onClick={onAskForChanges}><MessageSquareText data-icon="inline-start" />Ask for changes</Button>
        <Button size="sm" disabled={busy} onClick={() => void mutate({ action: 'confirmPlan', id: request.id, version: shared.version }, 'Thanks. The project manager knows the plan looks good.')}><Check data-icon="inline-start" />Looks good</Button>
      </div>}
    </section>;
  }

  const unsent = !!shared && !samePlan(request.plan, shared);
  return <section className="drawer-section plan-section">
    <h3 className="detail-section-heading">Plan{!editing && <Button variant="outline" size="sm" onClick={() => setEditing(true)}>{draft ? 'Edit plan' : <><Plus data-icon="inline-start" />Write a plan</>}</Button>}</h3>
    {shared ? <SharedLine data={data} request={request} shared={shared} /> : !editing && <p className="form-help">Write down what will be built and when, then send it to {request.requesterName.split(' ')[0]} to confirm.</p>}
    {unsent && !editing && <p className="plan-unsent">The draft has changes {request.requesterName.split(' ')[0]} has not seen yet.</p>}
    {editing
      ? <PlanEditor key={request.updatedAt} data={data} request={request} initial={draft ?? EMPTY} mutate={mutate} busy={busy} onDone={() => setEditing(false)} />
      : draft && <PlanView plan={draft} />}
  </section>;
}

/** Edits the feature list, the timeline, and notes. Save keeps a draft; Send makes the next version for the requester. */
function PlanEditor({ data, request, initial, mutate, busy, onDone }: { data: DashboardData; request: TechRequest; initial: RequestPlan; mutate: MutationFn; busy: boolean; onDone: () => void }) {
  const [features, setFeatures] = useState<PlanFeature[]>(initial.features.length ? initial.features : [{ id: newId(), text: '' }]);
  const [timeline, setTimeline] = useState<PlanMilestone[]>(initial.timeline);
  const [notes, setNotes] = useState(initial.notes);
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);
  const who = request.requesterName.split(' ')[0];
  // Empty rows are left out, so a half-written list still saves.
  const plan = (): RequestPlan => ({
    features: features.filter(f => f.text.trim()).map(f => ({ ...f, text: f.text.trim() })),
    timeline: timeline.filter(t => t.title.trim() && t.date).map(t => ({ ...t, title: t.title.trim() })),
    notes: notes.trim(),
  });
  const incomplete = timeline.some(t => (t.title.trim() && !t.date) || (!t.title.trim() && t.date));
  async function save() { if (await mutate({ action: 'savePlan', id: request.id, plan: plan() }, 'Plan saved as a draft')) onDone(); }
  async function send() {
    if (await mutate({ action: 'sharePlan', id: request.id, plan: plan(), ...(message.trim() ? { message: message.trim() } : {}) }, `Plan sent to ${who}. They get an email.`)) onDone();
  }
  const empty = !plan().features.length && !plan().timeline.length && !plan().notes;
  return <div className="plan-editor">
    <fieldset>
      <legend><ListChecks aria-hidden="true" />What will be built</legend>
      {features.map((feature, index) => <div key={feature.id} className="plan-row">
        <span className="plan-row-number">{index + 1}</span>
        <Input aria-label={`Feature ${index + 1}`} value={feature.text} maxLength={500} placeholder="e.g. A form that collects company, quantity, and budget"
          onChange={event => setFeatures(features.map(f => f.id === feature.id ? { ...f, text: event.target.value } : f))}
          onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); setFeatures([...features.slice(0, index + 1), { id: newId(), text: '' }, ...features.slice(index + 1)]); } }} />
        <Button type="button" variant="ghost" size="icon-sm" aria-label={`Remove feature ${index + 1}`} onClick={() => setFeatures(features.filter(f => f.id !== feature.id))}><Trash2 /></Button>
      </div>)}
      <Button type="button" variant="ghost" size="sm" disabled={features.length >= 50} onClick={() => setFeatures([...features, { id: newId(), text: '' }])}><Plus data-icon="inline-start" />Add a feature</Button>
    </fieldset>
    <fieldset>
      <legend><CalendarDays aria-hidden="true" />Timeline</legend>
      {timeline.length === 0 && <p className="form-help">Add the steps {who} can expect, such as a first look and the go-live date.</p>}
      {timeline.map((step, index) => <div key={step.id} className="plan-row plan-row-date">
        <FormDate aria-label={`Date of step ${index + 1}`} value={step.date} min={today(data.settings.timezone)} placeholder="Pick a date" onValueChange={value => setTimeline(timeline.map(t => t.id === step.id ? { ...t, date: value } : t))} />
        <Input aria-label={`Step ${index + 1}`} value={step.title} maxLength={200} placeholder="e.g. Ready for you to try"
          onChange={event => setTimeline(timeline.map(t => t.id === step.id ? { ...t, title: event.target.value } : t))} />
        <Button type="button" variant="ghost" size="icon-sm" aria-label={`Remove step ${index + 1}`} onClick={() => setTimeline(timeline.filter(t => t.id !== step.id))}><Trash2 /></Button>
      </div>)}
      <Button type="button" variant="ghost" size="sm" disabled={timeline.length >= 30} onClick={() => setTimeline([...timeline, { id: newId(), title: '', date: '' }])}><Plus data-icon="inline-start" />Add a step</Button>
    </fieldset>
    <fieldset>
      <legend><MessageSquareText aria-hidden="true" />Notes for {who}</legend>
      <Textarea aria-label="Notes" value={notes} onChange={event => setNotes(event.target.value)} rows={3} maxLength={10000} placeholder="What is not included yet, what you need from them, or anything else they should know." />
    </fieldset>
    {incomplete && <p className="field-error" role="alert">Give each timeline step a name and a date, or remove it.</p>}
    {sending
      ? <div className="plan-send">
        <Textarea aria-label={`Message for ${who}`} value={message} onChange={event => setMessage(event.target.value)} rows={2} maxLength={5000} placeholder={`A short message for ${who}, such as what you would like them to check.`} />
        <div className="plan-actions"><Button type="button" variant="ghost" size="sm" onClick={() => setSending(false)}>Back</Button><Button type="button" size="sm" disabled={busy || empty || incomplete} onClick={() => void send()}><Send data-icon="inline-start" />Send version {(request.sharedPlan?.version ?? 0) + 1} to {who}</Button></div>
      </div>
      : <div className="plan-actions">
        <Button type="button" variant="ghost" size="sm" onClick={onDone}>Cancel</Button>
        <Button type="button" variant="outline" size="sm" disabled={busy || incomplete} onClick={() => void save()}>Save draft</Button>
        <Button type="button" size="sm" disabled={busy || empty || incomplete} onClick={() => setSending(true)}><Send data-icon="inline-start" />Send to {who}</Button>
      </div>}
  </div>;
}
