"use client";

import type { ReactNode } from 'react';
import { Flame, Gauge, Trophy, Zap } from 'lucide-react';
import type { DashboardData, Member } from '@/lib/types';
import { calculateMemberKpi, dateKey, getBugKpi, getWeekRange, getWeekStart, shiftDate, type MemberKpi } from '@/lib/kpi';
import { Avatar } from '@/components/ui';
import { Badge } from '@/components/ui/badge';
import { attentionItems, firstName, findMember, hours } from './lib';
import { plural } from './timeline';

export function greeting(name: string, now = new Date(), timezone = 'Asia/Kolkata') {
  const hour = Number(new Intl.DateTimeFormat('en-GB', { hour: 'numeric', hourCycle: 'h23', timeZone: timezone }).format(now));
  return `${hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening'}, ${name.split(' ')[0]}`;
}

/** One line under the greeting: what needs the person first, or a short all-clear. */
export function dayBrief(data: DashboardData, own?: MemberKpi): string {
  const admin = data.currentUser.role === 'admin';
  const attention = attentionItems(data);
  if (admin) {
    const reviews = attention.filter(({ item }) => item.status === 'in_review' || item.status === 'fixed').length;
    const blocked = attention.filter(({ item }) => item.status === 'blocked').length;
    const parts = [reviews && `${plural(reviews, 'item')} ${reviews === 1 ? 'waits' : 'wait'} for your review`, blocked && `${plural(blocked, 'ticket')} ${blocked === 1 ? 'is' : 'are'} blocked`].filter(Boolean);
    return parts.length ? `${parts.join('. ')}.` : 'All clear. Nothing waits for you right now.';
  }
  if (!own || !own.weekCapacityHours) return 'Your score, your open tickets, and what needs your attention.';
  const { bandOnTarget, deliveryWeight, bugWeight } = data.settings;
  // Hours of approved tickets this week that would put the full week on target, with today's bug points.
  const neededShare = deliveryWeight ? Math.min(100, Math.max(0, (bandOnTarget - own.bugScore * bugWeight / 100) / (deliveryWeight / 100))) : 0;
  const needed = Math.max(0, neededShare / 100 * own.weekCapacityHours - own.creditedHours);
  if (needed <= 0) return 'You are on target for this week. Nice work.';
  return `${hours(needed)} h more of approved tickets puts your week on target.`;
}

/** Full weeks in a row on target, counting back from last week. A week with no hours at work does not break it. */
export function onTargetStreak(member: Member, data: DashboardData, now = new Date()): number {
  const tz = data.settings.timezone;
  const firstWeek = getWeekStart(data.settings.trackingStartDate, tz);
  let streak = 0;
  for (let week = shiftDate(getWeekStart(now, tz), -7, tz), guard = 0; week >= firstWeek && guard < 26; week = shiftDate(week, -7, tz), guard++) {
    const band = calculateMemberKpi(member, data, week, now).band;
    if (band === 'on_leave') continue;
    if (band !== 'on_target') break;
    streak++;
  }
  return streak;
}
export function StreakBadge({ weeks }: { weeks: number }) {
  if (weeks < 2) return null;
  return <Badge variant="outline" className="streak-badge" title={`On target ${weeks} weeks in a row`}><Flame aria-hidden="true" />{weeks}-week streak</Badge>;
}

type Highlight = { icon: ReactNode; label: string; value: string; member?: Member; detail: string };

/** Positive moments from the selected week: who delivered most, the fastest fix, and on-time delivery. */
export function Highlights({ data, week, scores }: { data: DashboardData; week: string; scores: MemberKpi[] }) {
  const range = getWeekRange(week, data.settings.timezone);
  const inWeek = (iso: string | null) => !!iso && new Date(iso) >= range.start && new Date(iso) <= range.end;
  const developers = scores.filter(s => s.member.role === 'developer' || data.currentUser.role !== 'admin');
  const top = [...developers].sort((a, b) => b.creditedHours - a.creditedHours)[0];
  const fixes = data.items.filter(item => item.type === 'bug' && inWeek(item.fixedAt)).map(item => ({ item, kpi: getBugKpi(item, data) })).sort((a, b) => a.kpi.resolutionWorkingHours - b.kpi.resolutionWorkingHours);
  const approved = data.items.filter(item => item.type === 'task' && item.status === 'done' && inWeek(item.completedAt));
  const dated = approved.filter(item => item.dueDate);
  const onTime = dated.filter(item => dateKey(item.completedAt!, data.settings.timezone) <= item.dueDate!);
  const own = data.currentUser.role !== 'admin';
  const items: Highlight[] = [
    top && top.creditedHours > 0
      ? { icon: <Trophy />, label: own ? 'Hours approved' : 'Most ticket hours', value: `${hours(top.creditedHours)} h`, member: own ? undefined : top.member, detail: own ? plural(approved.length, 'ticket') + ' approved' : `${firstName(top.member)} leads this week` }
      : { icon: <Trophy />, label: own ? 'Hours approved' : 'Most ticket hours', value: '—', detail: 'No tickets approved yet' },
    fixes[0]
      ? { icon: <Zap />, label: 'Fastest bug fix', value: `${hours(fixes[0].kpi.resolutionWorkingHours)} h`, member: own ? undefined : findMember(data, fixes[0].item.assigneeId), detail: `${fixes[0].item.title}` }
      : { icon: <Zap />, label: 'Fastest bug fix', value: '—', detail: 'No bugs fixed this week' },
    dated.length
      ? { icon: <Gauge />, label: 'On-time tickets', value: `${Math.round(onTime.length / dated.length * 100)}%`, detail: `${onTime.length} of ${dated.length} approved by their due date` }
      : { icon: <Gauge />, label: 'On-time tickets', value: '—', detail: 'No dated tickets approved yet' },
  ];
  return <div className="highlights" aria-label="This week’s highlights">{items.map(item => <div className="highlight" key={item.label}>
    <span className="highlight-icon" aria-hidden="true">{item.icon}</span>
    <div><span>{item.label}</span><strong>{item.value}</strong><small>{item.member && <Avatar member={item.member} size="small" />}{item.detail}</small></div>
  </div>)}</div>;
}

let lastPointer: { x: number; y: number } | null = null;
if (typeof window !== 'undefined') window.addEventListener('pointerdown', event => { lastPointer = { x: event.clientX, y: event.clientY }; }, { capture: true, passive: true });

/** A short burst of confetti from the last click. Skipped when the person prefers reduced motion. */
export function celebrate() {
  if (typeof window === 'undefined' || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const layer = document.createElement('div');
  layer.className = 'confetti-layer';
  layer.setAttribute('aria-hidden', 'true');
  const origin = lastPointer ?? { x: window.innerWidth / 2, y: window.innerHeight / 2 };
  const colors = ['var(--primary)', 'var(--chart-2)', 'var(--chart-3)', 'var(--chart-4)', 'var(--chart-5)'];
  for (let index = 0; index < 34; index++) {
    const piece = document.createElement('i');
    const angle = Math.random() * Math.PI - Math.PI;
    const distance = 90 + Math.random() * 170;
    piece.style.left = `${origin.x}px`;
    piece.style.top = `${origin.y}px`;
    piece.style.background = colors[index % colors.length];
    piece.style.setProperty('--x', `${Math.cos(angle) * distance}px`);
    piece.style.setProperty('--y', `${Math.sin(angle) * distance}px`);
    piece.style.setProperty('--r', `${Math.round(Math.random() * 720 - 360)}deg`);
    piece.style.animationDelay = `${Math.random() * 80}ms`;
    layer.appendChild(piece);
  }
  document.body.appendChild(layer);
  window.setTimeout(() => layer.remove(), 1500);
}

