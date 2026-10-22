"use client";

import { useState, type FormEvent } from 'react';
import { AlertTriangle, CalendarDays, Check, CircleHelp, LoaderCircle, Plus, Target, X } from 'lucide-react';
import type { DashboardData, Settings } from '@/lib/types';
import { FormDate, FormField, Panel } from '@/components/ui';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { displayDate, type MutationFn } from './lib';

export function SettingsPage({ data, mutate, busy, onHoliday }: { data: DashboardData; mutate: MutationFn; busy: boolean; onHoliday: () => void }) {
  const [settings, setSettings] = useState(data.settings);
  const [validationError, setValidationError] = useState('');
  const update = <K extends keyof Settings>(key: K, value: Settings[K]) => { setValidationError(''); setSettings(previous => ({ ...previous, [key]: value })); };
  async function save(event: FormEvent) {
    event.preventDefault();
    const error = settings.deliveryWeight + settings.bugWeight !== 100 ? 'Ticket hours and bug points must add up to 100%.'
      : settings.leadTeamWeight + settings.leadOwnWeight !== 100 ? 'The two admin weights must add up to 100%.'
      : settings.workdayEnd <= settings.workdayStart ? 'The workday must end after it starts.'
      : !settings.workingDays.length ? 'Choose at least one working day.'
      : settings.bandBelowTarget >= settings.bandOnTarget ? 'The on target score must be higher than the below target score.' : '';
    setValidationError(error);
    if (error) return;
    await mutate({ action: 'saveSettings', settings }, 'Settings saved');
  }
  function numberField(label: string, key: keyof Settings, help?: string, max?: number) {
    const name = String(key);
    return <FormField>{label}<Input type="number" min={name.includes('Capacity') || name.endsWith('TargetHours') ? .5 : 0} max={max} step={name.includes('Weight') ? 1 : .5} required value={String(settings[key])} onChange={event => update(key, Number(event.target.value) as never)} />{help && <span className="field-help">{help}</span>}</FormField>;
  }
  return <>
    <Alert className="settings-notice"><CircleHelp size={17} /><AlertDescription><p>These rules set every score in the workspace. Weeks that are already locked keep the rules they had.</p></AlertDescription></Alert>
    <form className="settings-form" onSubmit={save}>
      {validationError && <Alert variant="destructive"><AlertTriangle /><AlertTitle>Check your settings</AlertTitle><AlertDescription>{validationError}</AlertDescription></Alert>}
      <div className="settings-row">
        <div className="settings-section-intro"><div className="settings-number">01</div><h2>Working calendar</h2><p>Hours at work and bug fix-by times count only working days and office hours.</p></div>
        <Card className="settings-fields"><CardContent>
          <FieldGroup className="form-grid">
            <FormField>Timezone<Input value="India · Asia/Kolkata" readOnly aria-label="Timezone" /></FormField>
            <FormField>Scores start on<FormDate required value={settings.trackingStartDate} onValueChange={value => update('trackingStartDate', value)} /></FormField>
            <FormField>Workday starts<Input type="time" required value={settings.workdayStart} onChange={event => update('workdayStart', event.target.value)} /></FormField>
            <FormField>Workday ends<Input type="time" required value={settings.workdayEnd} onChange={event => update('workdayEnd', event.target.value)} /></FormField>
          </FieldGroup>
          <FieldLabel className="workdays-label">Working days</FieldLabel>
          <ToggleGroup type="multiple" variant="outline" className="working-days" value={settings.workingDays.map(String)} onValueChange={values => update('workingDays', values.map(Number))} aria-label="Working days">
            {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((label, index) => <ToggleGroupItem key={label} value={String(index + 1)} aria-label={label}>{label}</ToggleGroupItem>)}
          </ToggleGroup>
        </CardContent></Card>
      </div>
      <div className="settings-row">
        <div className="settings-section-intro"><div className="settings-number">02</div><h2>Hours and score weights</h2><p>Efficiency compares approved ticket hours with hours at work, then adds bug points.</p></div>
        <Card className="settings-fields"><CardContent>
          <FieldGroup className="form-grid">
            {numberField('Developer hours per week', 'defaultDevCapacityHours', 'Used for new developers. Leave and holidays lower it.', 168)}
            {numberField('Admin hours per week', 'defaultLeadCapacityHours', 'Hours an admin spends on their own tickets.', 168)}
            {numberField('Ticket hours weight (%)', 'deliveryWeight', undefined, 100)}
            {numberField('Bug points weight (%)', 'bugWeight', 'These two must add up to 100%.', 100)}
            {numberField('Admin score: team weight (%)', 'leadTeamWeight', undefined, 100)}
            {numberField('Admin score: own tickets weight (%)', 'leadOwnWeight', 'These two must add up to 100%.', 100)}
          </FieldGroup>
          <Alert className="formula-preview"><Target size={16} /><AlertDescription><span>Efficiency = ticket hours done ÷ hours at work (max 100%) × {settings.deliveryWeight}% + bug points × {settings.bugWeight}%</span></AlertDescription></Alert>
        </CardContent></Card>
      </div>
      <div className="settings-row">
        <div className="settings-section-intro"><div className="settings-number">03</div><h2>Bug targets and score bands</h2><p>A bug fixed within its target earns 100 points. Within twice the target: 50. Later: 0.</p></div>
        <Card className="settings-fields"><CardContent>
          <FieldGroup className="form-grid">
            {numberField('Critical bug target (working hours)', 'criticalTargetHours', undefined, 168)}
            {numberField('Normal bug target (working hours)', 'normalTargetHours', undefined, 336)}
            {numberField('On target from (%)', 'bandOnTarget', undefined, 100)}
            {numberField('Below target from (%)', 'bandBelowTarget', 'Lower scores show as Needs attention.', 100)}
          </FieldGroup>
        </CardContent></Card>
      </div>
      <div className="settings-save-row"><span>{busy ? 'Saving…' : 'Changes apply to the current week straight away.'}</span><Button disabled={busy} type="submit">{busy ? <LoaderCircle data-icon="inline-start" className="spin" size={15} /> : <Check data-icon="inline-start" size={15} />}Save settings</Button></div>
    </form>
    <div className="settings-row">
      <div className="settings-section-intro"><div className="settings-number">04</div><h2>Holidays</h2><p>Holidays lower everyone’s hours at work and pause bug fix-by clocks.</p></div>
      <Panel title="Holidays" action={<Button variant="link" size="sm" onClick={onHoliday}><Plus data-icon="inline-start" size={13} />Add holiday</Button>}>
        {data.holidays.length === 0
          ? <div className="inline-empty"><CalendarDays size={21} /><div><strong>No holidays yet</strong><p>Add company and public holidays here.</p></div></div>
          : <div className="holiday-list">{[...data.holidays].sort((a, b) => a.date.localeCompare(b.date)).map(h => <div key={h.id}><span className="holiday-date"><CalendarDays size={15} />{displayDate(h.date, { year: 'numeric' })}</span><strong>{h.name}</strong><Button variant="ghost" size="icon" aria-label={`Remove ${h.name}`} onClick={() => void mutate({ action: 'deleteHoliday', id: h.id }, 'Holiday removed')}><X size={14} /></Button></div>)}</div>}
      </Panel>
    </div>
  </>;
}
