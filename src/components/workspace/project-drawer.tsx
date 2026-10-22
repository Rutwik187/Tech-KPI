"use client";

import Link from 'next/link';
import { ArrowUpRight, CalendarClock, CalendarPlus, FolderKanban, Pencil } from 'lucide-react';
import type { DashboardData, Project } from '@/lib/types';
import { burnUp, projectTimeline } from '@/lib/timeline';
import { Avatar, Modal, StatusBadge } from '@/components/ui';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { displayDate, hours, isAdhocProject, isDone, projectPhases, projectTeam, routeFor, today } from './lib';
import { BurnUpChart } from './charts';
import { ExtendedBadge, ExtensionHistory, HealthBadge, TimelineStrip, daysLeftText, plural } from './timeline';

export function ProjectDrawer({ data, project, onClose, onEdit, onExtend, onOpenItem }: { data: DashboardData; project: Project; onClose: () => void; onEdit: () => void; onExtend: () => void; onOpenItem: (id: string) => void }) {
  const admin = data.currentUser.role === 'admin';
  const day = today(data.settings.timezone);
  const timeline = projectTimeline(data, project, day);
  const editable = admin && !isAdhocProject(project) && !project.isArchived;
  const tickets = data.items.filter(item => item.projectId === project.id && item.type === 'task');
  const lateTickets = project.targetDate ? tickets.filter(item => !isDone(item) && item.dueDate && item.dueDate > project.targetDate!) : [];
  const phases = [{ id: null, name: 'Ad hoc' }, ...projectPhases(data, project.id)];
  const members = projectTeam(data, project);
  return <Modal title={project.name} subtitle={project.description || 'Project'} onClose={onClose} drawer>
    <div className="item-drawer-body project-drawer">
      <div className="detail-title-row">
        <span className="project-icon" style={{ color: project.color, background: `${project.color}14` }}><FolderKanban size={22} /></span>
        <div className="project-drawer-badges"><HealthBadge health={timeline.health} /><ExtendedBadge days={timeline.extendedDays} moves={timeline.extensions.length} />{project.isArchived && <Badge variant="outline">Archived</Badge>}</div>
        {editable && <Button variant="ghost" size="icon" onClick={onEdit} aria-label={`Edit ${project.name}`}><Pencil size={16} /></Button>}
      </div>

      <div className="detail-facts">
        <div><span>Start</span><strong>{project.startDate ? displayDate(project.startDate) : '—'}</strong><small>{project.startDate ? displayDate(project.startDate, { weekday: 'long' }) : 'Not set'}</small></div>
        <div><span>Target</span><strong>{project.targetDate ? displayDate(project.targetDate) : '—'}</strong>
          {editable && (project.targetDate
            ? <Button variant="link" size="sm" onClick={onExtend}>Extend<CalendarClock data-icon="inline-end" size={11} /></Button>
            : <Button variant="link" size="sm" onClick={onEdit}>Set dates<CalendarPlus data-icon="inline-end" size={11} /></Button>)}
          {!editable && <small>{timeline.originalTargetDate && timeline.originalTargetDate !== project.targetDate ? `First target ${displayDate(timeline.originalTargetDate)}` : 'First target'}</small>}</div>
        <div><span>Time</span><strong>{timeline.health === 'complete' ? 'Done' : timeline.daysLeft === null ? '—' : daysLeftText(timeline.daysLeft)}</strong><small>{timeline.health === 'complete' ? 'All tickets approved' : timeline.timePercent === null ? 'Add a start date to track time' : `${Math.round(timeline.timePercent)}% of time used`}</small></div>
      </div>
      <TimelineStrip timeline={timeline} color={project.color} />

      <section className="drawer-section">
        <h3 className="detail-section-heading">Progress <span>{hours(timeline.doneHours)} of {hours(timeline.totalHours)} h approved</span></h3>
        <BurnUpChart points={burnUp(data, project, day)} today={day} targetDate={project.targetDate} originalTargetDate={timeline.originalTargetDate} color={project.color} />
      </section>

      <section className="drawer-section">
        <h3 className="detail-section-heading">Timeline changes <span>{timeline.extensions.length}</span>{editable && project.targetDate && <Button variant="outline" size="sm" onClick={onExtend}><CalendarClock data-icon="inline-start" />Extend timeline</Button>}</h3>
        <ExtensionHistory data={data} entityId={project.id} empty={project.targetDate ? 'The target has not moved.' : 'Set a target date to track changes.'} />
      </section>

      {lateTickets.length > 0 && <section className="drawer-section">
        <h3 className="detail-section-heading">Due after the target <span>{lateTickets.length}</span></h3>
        <div className="member-open-items">{lateTickets.map(item => <Button variant="outline" key={item.id} onClick={() => onOpenItem(item.id)}><span className="item-key">{item.key}</span><strong>{item.title}</strong><span className="cell-muted">Due {displayDate(item.dueDate)}</span><ArrowUpRight data-icon="inline-end" size={15} /></Button>)}</div>
      </section>}

      <section className="drawer-section">
        <h3 className="detail-section-heading">Phases</h3>
        <div className="project-phase-summary">{phases.map(phase => {
          const work = tickets.filter(item => item.phaseId === phase.id);
          if (phase.id === null && !work.length) return null;
          const open = work.filter(item => !isDone(item));
          return <Button key={phase.id ?? 'adhoc'} asChild variant="ghost" className="phase-summary-row"><Link href={routeFor(data, `tickets?project=${project.id}&phase=${phase.id ?? 'adhoc'}`)}>
            <span className="phase-summary-name">{phase.name}</span><span>{open.length} open · {work.length - open.length} done</span>{open[0] && <StatusBadge status={open[0].status} />}<ArrowUpRight size={14} />
          </Link></Button>;
        })}</div>
      </section>

      <section className="drawer-section">
        <h3 className="detail-section-heading">Members <span>{members.length}</span></h3>
        <div className="project-member-chips">{isAdhocProject(project) ? <span className="form-help">Everyone can own Ad hoc work.</span> : members.length ? members.map(member => <span key={member.id} className={member.id === project.primaryMemberId ? 'is-primary' : undefined}><Avatar member={member} size="small" />{member.name}<small>{member.id === project.primaryMemberId ? 'Primary' : 'Secondary'}</small></span>) : <span className="form-help">No members yet.</span>}</div>
      </section>
    </div>
    <div className="drawer-footer">
      <span>{plural(tickets.filter(item => !isDone(item)).length, 'open ticket')} · {plural(tickets.filter(isDone).length, 'approved ticket')}</span>
      <Button variant="link" size="sm" asChild><Link href={routeFor(data, `tickets?project=${project.id}`)}>View tickets<ArrowUpRight data-icon="inline-end" size={12} /></Link></Button>
    </div>
  </Modal>;
}
