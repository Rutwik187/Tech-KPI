"use client";

import { Area, CartesianGrid, ComposedChart, Line, ReferenceLine, XAxis, YAxis, type TooltipContentProps } from 'recharts';
import type { BurnUpPoint } from '@/lib/timeline';
import { ChartContainer, ChartTooltip } from '@/components/ui/chart';
import { displayDate, hours, percent } from './lib';

export type TrendPoint = { weekStart: string; efficiency: number | null; creditedHours: number; capacityHours: number };

function ChartTip({ title, lines }: { title: string; lines: string[] }) {
  return <div className="chart-tip"><strong>{title}</strong>{lines.map(line => <span key={line}>{line}</span>)}</div>;
}

/** Weekly efficiency since scores started. The current week is a hollow point because it is still in progress. */
export function TrendChart({ trend, target, currentWeek }: { trend: TrendPoint[]; target: number; currentWeek: string }) {
  const firstScored = trend.findIndex(point => point.efficiency !== null);
  const points = firstScored < 0 ? [] : trend.slice(firstScored);
  const completed = points.filter(point => point.weekStart < currentWeek && point.efficiency !== null);
  const average = completed.length ? completed.reduce((sum, point) => sum + point.efficiency!, 0) / completed.length : null;
  const best = completed.reduce<TrendPoint | null>((top, point) => !top || point.efficiency! > top.efficiency! ? point : top, null);
  const thisWeek = points.find(point => point.weekStart === currentWeek);
  if (points.length < 2) return <div className="chart-empty"><strong>The trend starts after the first full week</strong><p>Each week adds a point. Approve tickets to see this week’s progress.</p></div>;
  const dot = (props: { cx?: number; cy?: number; payload?: TrendPoint }) => {
    const { cx, cy, payload } = props;
    if (cx === undefined || cy === undefined || payload?.efficiency === null) return <g key={`${payload?.weekStart}-empty`} />;
    const live = payload?.weekStart === currentWeek;
    return <circle key={payload?.weekStart} cx={cx} cy={cy} r={4.5} strokeWidth={2} stroke={live ? 'var(--color-efficiency)' : 'var(--card)'} fill={live ? 'var(--card)' : 'var(--color-efficiency)'} />;
  };
  return <>
    <ChartContainer className="trend-chart aspect-auto" config={{ efficiency: { label: 'Efficiency', color: 'var(--primary)' } }}>
      <ComposedChart accessibilityLayer data={points} margin={{ top: 16, right: 16, bottom: 0, left: 0 }}>
        <CartesianGrid vertical={false} stroke="var(--border)" />
        <XAxis dataKey="weekStart" tickFormatter={value => displayDate(String(value))} tickLine={false} axisLine={false} tickMargin={10} minTickGap={16} />
        <YAxis domain={[0, 100]} tickFormatter={value => `${value}%`} ticks={[0, 50, 100]} tickLine={false} axisLine={false} width={40} />
        <ChartTooltip cursor={{ stroke: 'var(--border)' }} content={({ active, payload }: TooltipContentProps) => {
          const point = active ? payload?.[0]?.payload as TrendPoint | undefined : undefined;
          if (!point) return null;
          return <ChartTip title={`Week of ${displayDate(point.weekStart)}${point.weekStart === currentWeek ? ' · so far' : ''}`} lines={[
            point.efficiency === null ? 'No hours at work' : `${Math.round(point.efficiency)}% efficiency`,
            `${hours(point.creditedHours)} of ${hours(point.capacityHours)} h ticket hours`,
          ]} />;
        }} />
        <ReferenceLine y={target} stroke="var(--muted-foreground)" strokeDasharray="4 4" strokeOpacity={0.7} label={{ value: `Target ${target}%`, position: 'insideBottomLeft', fontSize: 11, fill: 'var(--muted-foreground)' }} />
        <Area dataKey="efficiency" type="monotone" connectNulls stroke="var(--color-efficiency)" strokeWidth={2} fill="var(--color-efficiency)" fillOpacity={0.1} dot={dot} activeDot={{ r: 6, strokeWidth: 2, stroke: 'var(--card)' }} isAnimationActive={false} />
      </ComposedChart>
    </ChartContainer>
    <div className="trend-stats">
      <div><span>Average</span><strong>{percent(average)}</strong><small>{completed.length} full week{completed.length === 1 ? '' : 's'}</small></div>
      <div><span>Best week</span><strong>{percent(best?.efficiency ?? null)}</strong><small>{best ? `Week of ${displayDate(best.weekStart)}` : '—'}</small></div>
      <div><span>This week</span><strong>{percent(thisWeek?.efficiency ?? null)}</strong><small>So far · hollow point</small></div>
    </div>
    <table className="sr-only"><caption>Weekly efficiency. Target {target}%.</caption><thead><tr><th>Week of</th><th>Efficiency</th><th>Ticket hours</th><th>Hours at work</th></tr></thead>
      <tbody>{points.map(point => <tr key={point.weekStart}><td>{displayDate(point.weekStart)}</td><td>{percent(point.efficiency)}</td><td>{hours(point.creditedHours)}</td><td>{hours(point.capacityHours)}</td></tr>)}</tbody></table>
  </>;
}

/**
 * Planned against approved ticket hours over the project's life. Vertical markers show today, the target,
 * and, after an extension, the first target, so a slip is visible at a glance.
 */
export function BurnUpChart({ points, today, targetDate, originalTargetDate, color }: { points: BurnUpPoint[]; today: string; targetDate: string | null; originalTargetDate: string | null; color: string }) {
  if (points.length < 2) return <div className="chart-empty"><strong>No progress to chart yet</strong><p>Add tickets to this project. Approved hours appear here as they are done.</p></div>;
  const extended = originalTargetDate && targetDate && originalTargetDate !== targetDate ? originalTargetDate : null;
  return <>
    <ChartContainer className="burnup-chart aspect-auto" config={{ planned: { label: 'Planned hours', color: 'var(--muted-foreground)' }, done: { label: 'Approved hours', color } }}>
      <ComposedChart accessibilityLayer data={points} margin={{ top: 22, right: 14, bottom: 0, left: 0 }}>
        <CartesianGrid vertical={false} stroke="var(--border)" />
        <XAxis dataKey="date" tickFormatter={value => displayDate(String(value))} tickLine={false} axisLine={false} tickMargin={10} minTickGap={24} />
        <YAxis tickFormatter={value => `${value} h`} tickLine={false} axisLine={false} width={48} allowDecimals={false} />
        <ChartTooltip cursor={{ stroke: 'var(--border)' }} content={({ active, payload }: TooltipContentProps) => {
          const point = active ? payload?.[0]?.payload as BurnUpPoint | undefined : undefined;
          if (!point) return null;
          return <ChartTip title={displayDate(point.date, { weekday: 'short' })} lines={[
            `${hours(point.planned)} h planned`,
            point.done === null ? 'In the future' : `${hours(point.done)} h approved (${point.planned ? Math.round(point.done / point.planned * 100) : 0}%)`,
            ...(point.date === targetDate ? ['Target date'] : point.date === extended ? ['First target date'] : []),
          ]} />;
        }} />
        {extended && <ReferenceLine x={extended} stroke="var(--warning-foreground)" strokeDasharray="4 4" label={{ value: 'First target', position: 'insideTopRight', fontSize: 11, fill: 'var(--muted-foreground)' }} />}
        {targetDate && <ReferenceLine x={targetDate} stroke="var(--foreground)" strokeOpacity={0.6} label={{ value: 'Target', position: 'insideTopRight', fontSize: 11, fill: 'var(--foreground)' }} />}
        <ReferenceLine x={today} stroke="var(--primary)" strokeOpacity={0.45} label={{ value: 'Today', position: 'insideBottomRight', fontSize: 11, fill: 'var(--muted-foreground)' }} />
        <Line dataKey="planned" type="stepAfter" stroke="var(--color-planned)" strokeWidth={2} dot={false} activeDot={{ r: 4, strokeWidth: 2, stroke: 'var(--card)' }} isAnimationActive={false} />
        <Area dataKey="done" type="monotone" stroke="var(--color-done)" strokeWidth={2} fill="var(--color-done)" fillOpacity={0.12} dot={false} activeDot={{ r: 5, strokeWidth: 2, stroke: 'var(--card)' }} connectNulls={false} isAnimationActive={false} />
      </ComposedChart>
    </ChartContainer>
    <div className="chart-legend"><span><i className="legend-line" style={{ background: color }} />Approved hours</span><span><i className="legend-line legend-line-muted" />Planned hours</span>{extended && <span><i className="legend-line legend-line-dashed" />First target</span>}</div>
    <table className="sr-only"><caption>Planned and approved ticket hours by date</caption><thead><tr><th>Date</th><th>Planned hours</th><th>Approved hours</th></tr></thead>
      <tbody>{points.map(point => <tr key={point.date}><td>{displayDate(point.date)}</td><td>{hours(point.planned)}</td><td>{point.done === null ? '—' : hours(point.done)}</td></tr>)}</tbody></table>
  </>;
}
