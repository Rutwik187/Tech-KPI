"use client";

import { useState } from 'react';
import Link from 'next/link';
import clsx from 'clsx';
import { ArrowRight, ArrowUpRight, Bug, CalendarClock, ChevronRight, CircleDashed, CircleHelp, Clock3, FolderKanban, Pencil } from 'lucide-react';
import type { DashboardData, Project } from '@/lib/types';
import { Avatar, EmptyState, FormCheckbox, FormField, Panel, ProgressBar } from '@/components/ui';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { projectTimeline } from '@/lib/timeline';
import { ExtendedBadge, HealthBadge, plural, TimelineStrip } from './timeline';
import { findMember, hours, isAdhocProject, isDone, projectPhases, routeFor, today, type MutationFn } from './lib';

type ProjectActions = { onEdit: (project: Project) => void; onOpen: (id: string) => void; onExtend: (project: Project) => void; mutate: MutationFn };

export function Projects({ data, onEdit, onOpen, onExtend, mutate }: { data: DashboardData } & ProjectActions) {
  const [showArchived, setShowArchived] = useState(false);
  const isAdmin = data.currentUser.role === 'admin';
  const list = data.projects.filter(p => showArchived || !p.isArchived).sort((a, b) => Number(isAdhocProject(b)) - Number(isAdhocProject(a)) || Number(a.isArchived) - Number(b.isArchived) || a.name.localeCompare(b.name));
  const active = data.projects.filter(p => !p.isArchived && !isAdhocProject(p)).length;
  return <>
    <div className="project-toolbar">
      <span>{active} active project{active === 1 ? '' : 's'} · Ad hoc holds work outside a project</span>
      {data.projects.some(p => p.isArchived) && <FormField className="checkbox-label"><FormCheckbox checked={showArchived} onCheckedChange={setShowArchived} />Show archived</FormField>}
    </div>
    {list.length === 0 ? <Panel><EmptyState title="No projects yet" description={isAdmin ? 'Create a project, choose its team, and add phases if you need them.' : 'Your admin will add you to a project.'} /></Panel>
      : <div className="projects-grid">{list.map(project => <ProjectCard key={project.id} data={data} project={project} isAdmin={isAdmin} onEdit={onEdit} onOpen={onOpen} onExtend={onExtend} mutate={mutate} />)}</div>}
    <div className="list-hint"><CircleHelp size={14} />{isAdmin ? 'Open a project to see its progress chart and timeline history. Moving a target date needs a reason, and everyone on the project can read it.' : 'Open a project to see its progress and why its target moved.'}</div>
  </>;
}

function ProjectCard({ data, project, isAdmin, onEdit, onOpen, onExtend, mutate }: { data: DashboardData; project: Project; isAdmin: boolean } & ProjectActions) {
  const adhoc = isAdhocProject(project);
  const items = data.items.filter(item => item.projectId === project.id);
  const tickets = items.filter(item => item.type === 'task');
  const completed = tickets.filter(isDone);
  const openBugs = items.filter(item => item.type === 'bug' && !isDone(item)).length;
  const totalHours = tickets.reduce((sum, item) => sum + item.estimateHours, 0);
  const doneHours = completed.reduce((sum, item) => sum + item.estimateHours, 0);
  const members = adhoc ? data.members.filter(m => m.isActive) : project.memberIds.flatMap(id => { const found = findMember(data, id); return found ? [found] : []; });
  // The Ad hoc phase is listed only when it holds work, so empty rows do not repeat on every card.
  const phases = [{ id: null, name: 'Ad hoc', description: 'Work without a named phase.' }, ...projectPhases(data, project.id)]
    .filter(phase => phase.id !== null || tickets.some(item => item.phaseId === null));
  const progress = totalHours ? doneHours / totalHours * 100 : 0;
  const timeline = projectTimeline(data, project, today(data.settings.timezone));
  const editable = isAdmin && !adhoc && !project.isArchived;
  return <Card className={clsx('project-card', project.isArchived && 'project-archived')}>
    <CardHeader>
      <div className="project-card-heading">
        <span className="project-icon" style={{ color: project.color, background: `${project.color}14` }}><FolderKanban size={24} /></span>
        {adhoc ? <Badge variant="secondary">Built in</Badge> : project.isArchived ? <Badge variant="outline">Archived</Badge> : isAdmin && <Button variant="ghost" size="icon" aria-label={`Edit ${project.name}`} onClick={() => onEdit(project)}><Pencil /></Button>}
      </div>
      <CardTitle><button type="button" onClick={() => onOpen(project.id)} className="project-title">{project.name}<ArrowUpRight size={17} /></button></CardTitle>
      <CardDescription>{project.description || 'No description yet.'}</CardDescription>
    </CardHeader>
    <CardContent>
      {!adhoc && <div className="project-timeline-block">
        <div className="project-timeline-heading"><div className="project-timeline-badges"><HealthBadge health={timeline.health} /><ExtendedBadge days={timeline.extendedDays} moves={timeline.extensions.length} /></div>
          {editable && project.targetDate && <Button variant="ghost" size="sm" className="project-extend" onClick={() => onExtend(project)}><CalendarClock data-icon="inline-start" />Extend</Button>}
          {editable && !project.targetDate && <Button variant="ghost" size="sm" className="project-extend" onClick={() => onEdit(project)}><CalendarClock data-icon="inline-start" />Set dates</Button>}</div>
        <TimelineStrip timeline={timeline} color={project.color} />
      </div>}
      <div className="project-progress-label"><span>{hours(doneHours)} of {hours(totalHours)} ticket hours done</span><strong>{Math.round(progress)}%</strong></div>
      {adhoc && <ProgressBar value={progress} label={`${project.name} progress`} />}
      <div className="project-work-stats"><span><CircleDashed size={14} />{plural(tickets.length - completed.length, 'open ticket')}</span><span><Clock3 size={14} />{completed.length} done</span><span><Bug size={14} />{plural(openBugs, 'open bug')}</span></div>
      {phases.length > 0 && <div className="project-phase-summary"><h3>Phases</h3>{phases.map(phase => {
        const work = tickets.filter(item => item.phaseId === phase.id);
        return <Button key={phase.id ?? 'adhoc'} asChild variant="ghost" className="phase-summary-row">
          <Link href={routeFor(data, `tickets?project=${project.id}&phase=${phase.id ?? 'adhoc'}`)} aria-label={`View ${phase.name} tickets in ${project.name}`}>
            <span className="phase-summary-name">{phase.name}{phase.description && <small>{phase.description}</small>}</span>
            <span>{work.filter(item => !isDone(item)).length} open · {work.filter(isDone).length} done</span>
            <ChevronRight size={14} />
          </Link>
        </Button>;
      })}</div>}
    </CardContent>
    <CardFooter className="project-card-footer">
      <div className="project-members-summary"><div className="avatar-stack">{members.slice(0, 4).map(m => <Avatar key={m.id} member={m} size="small" />)}</div><span>{adhoc ? 'Everyone' : `${project.memberIds.length} member${project.memberIds.length === 1 ? '' : 's'}`}</span></div>
      <div className="project-card-links"><Button variant="link" size="sm" asChild><Link href={routeFor(data, `tickets?project=${project.id}`)}>Tickets<ArrowRight data-icon="inline-end" /></Link></Button>
        {isAdmin && !adhoc && <Button variant="link" size="sm" className="text-muted-foreground" onClick={() => void mutate({ action: 'updateProject', id: project.id, patch: { isArchived: !project.isArchived } }, project.isArchived ? 'Project restored' : 'Project archived')}>{project.isArchived ? 'Restore' : 'Archive'}</Button>}</div>
    </CardFooter>
  </Card>;
}
