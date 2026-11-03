"use client";

import { useRef, type ComponentProps, type CSSProperties, type ReactNode } from "react";
import { X, ArrowUpRight, Bug, Inbox } from "lucide-react";
import type { Member, WorkItem } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Avatar as AvatarPrimitive, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Progress } from "@/components/ui/progress";
import { Sheet, SheetClose, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";

export { FormField, FormSelect, FormCheckbox, FormDate, FormDateRange } from "./form-select";
export type { FormSelectProps, FormCheckboxProps, FormDateProps } from "./form-select";

export function initials(name: string) {
  return name.trim().split(/\s+/).filter(Boolean).slice(0, 2).map(part => part[0]).join("").toUpperCase() || "?";
}

/** The same person always gets the same colour, so people are easy to spot in long lists. */
function avatarHue(seed: string) {
  let hue = 0;
  for (const char of seed) hue = (hue * 31 + char.charCodeAt(0)) % 360;
  return hue;
}

export function Avatar({ member, size = "normal" }: { member?: Member; size?: "small" | "normal" | "large" }) {
  const style = member ? { "--avatar-hue": avatarHue(member.id || member.name) } as CSSProperties : undefined;
  return <AvatarPrimitive size={size === "small" ? "sm" : size === "large" ? "lg" : "default"} className={cn("avatar", `avatar-${size}`, !member && "avatar-empty", size === "large" && "size-16")} style={style} role="img" aria-label={member?.name ?? "Unassigned"}>
    {member?.image && <AvatarImage src={member.image} alt="" />}
    <AvatarFallback aria-hidden="true" className={cn("avatar-fallback", size === "large" && "text-xl")}>{initials(member?.name ?? "?")}</AvatarFallback>
  </AvatarPrimitive>;
}

export const statusText: Record<WorkItem["status"], string> = { todo: "To do", in_progress: "In progress", in_review: "In review", blocked: "Blocked", done: "Done", open: "Open", fixed: "Fixed", verified: "Verified" };

/**
 * One shape per state, so a list can be read at a glance. Waiting for the admin (in review, fixed) looks the same for tickets and bugs.
 * With `label`, a hidden text label goes with the icon for screen readers and text search.
 */
export function StatusIcon({ status, label = false, className }: { status: WorkItem["status"]; label?: boolean; className?: string }) {
  const ring = <circle cx="8" cy="8" r="6.25" fill="none" stroke="currentColor" strokeWidth="1.5" />;
  const shape = status === "todo" ? <circle cx="8" cy="8" r="6.25" fill="none" stroke="currentColor" strokeWidth="1.5" strokeDasharray="2.6 2.3" />
    : status === "in_progress" ? <>{ring}<path d="M8 4.25a3.75 3.75 0 0 1 0 7.5Z" fill="currentColor" /></>
    : status === "in_review" || status === "fixed" ? <>{ring}<path d="M8 8V4.25a3.75 3.75 0 1 1-3.75 3.75Z" fill="currentColor" /></>
    : status === "blocked" ? <>{ring}<rect x="4.75" y="7.1" width="6.5" height="1.8" rx=".9" fill="currentColor" /></>
    : status === "open" ? <>{ring}<circle cx="8" cy="8" r="2.25" fill="currentColor" /></>
    : <><circle cx="8" cy="8" r="7" fill="currentColor" /><path d="m5.2 8.2 1.9 1.8 3.8-3.8" fill="none" stroke="var(--card)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></>;
  const icon = <svg viewBox="0 0 16 16" aria-hidden="true" className={cn("status-icon", `status-icon-${status}`, className)}>{shape}</svg>;
  if (!label) return icon;
  return <span className="status-icon-label" title={statusText[status]}>{icon}<span className="sr-only">{statusText[status]}</span></span>;
}

export function StatusBadge({ status }: { status: WorkItem["status"] }) {
  return <Badge variant="outline" className={cn("status-badge", `status-${status}`)}><StatusIcon status={status} />{statusText[status]}</Badge>;
}

const priorityText: Record<WorkItem["priority"], string> = { low: "Low", medium: "Medium", high: "High", urgent: "Urgent" };

/** Signal bars for low, medium, and high. Urgent is a filled square, so it stands out in any list. */
export function PriorityIcon({ priority, className }: { priority: WorkItem["priority"]; className?: string }) {
  const filled = priority === "low" ? 1 : priority === "medium" ? 2 : 3;
  return <svg viewBox="0 0 16 16" aria-hidden="true" className={cn("priority-icon", `priority-icon-${priority}`, className)}>
    {priority === "urgent"
      ? <><rect x="1.5" y="1.5" width="13" height="13" rx="3.5" fill="currentColor" /><path d="M8 4.6v4.1" stroke="var(--card)" strokeWidth="1.8" strokeLinecap="round" /><circle cx="8" cy="11.25" r="1.05" fill="var(--card)" /></>
      : [5, 8.5, 12].map((height, index) => <rect key={height} x={2 + index * 4.5} y={14 - height} width="3" height={height} rx="1" fill="currentColor" opacity={index < filled ? 1 : .22} />)}
  </svg>;
}

export function PriorityBadge({ priority }: { priority: WorkItem["priority"] }) {
  return <Badge variant="outline" className={cn("priority", `priority-${priority}`)}><PriorityIcon priority={priority} />{priorityText[priority]}</Badge>;
}

/** A priority icon for dense rows. Hover shows the word; screen readers read it. */
export function PriorityMark({ priority }: { priority: WorkItem["priority"] }) {
  return <span className={cn("priority-mark", `priority-mark-${priority}`)} title={`${priorityText[priority]} priority`}><PriorityIcon priority={priority} /><span className="sr-only">{priorityText[priority]} priority</span></span>;
}

export function Kbd({ children, className }: { children: ReactNode; className?: string }) {
  return <kbd className={cn("kbd", className)}>{children}</kbd>;
}

export function ProgressBar({ value, color = "green", label = "Progress" }: { value: number; color?: string; label?: string }) {
  const progress = Number.isFinite(value) ? Math.max(0, Math.min(value, 100)) : 0;
  const tones: Record<string, string> = {
    green: "[&_[data-slot=progress-indicator]]:bg-success-foreground", neutral: "[&_[data-slot=progress-indicator]]:bg-primary",
    orange: "[&_[data-slot=progress-indicator]]:bg-warning-foreground", blue: "[&_[data-slot=progress-indicator]]:bg-info-foreground",
    red: "[&_[data-slot=progress-indicator]]:bg-destructive",
  };
  return <Progress value={progress} aria-label={label} aria-valuetext={`${Math.round(Number.isFinite(value) ? value : 0)}%`} className={cn("progress-track", tones[color] ?? tones.neutral)} />;
}

export function EmptyState({ title, description, action, bug, compact = false }: { title: string; description: string; action?: ReactNode; bug?: boolean; compact?: boolean }) {
  const Icon = bug ? Bug : Inbox;
  return <Empty className={cn("empty-state", compact && "empty-state-compact")}><EmptyHeader><EmptyMedia variant="icon" className="empty-icon"><Icon aria-hidden="true" /></EmptyMedia><EmptyTitle><h3>{title}</h3></EmptyTitle><EmptyDescription>{description}</EmptyDescription></EmptyHeader>{action && <EmptyContent>{action}</EmptyContent>}</Empty>;
}

export function Panel({ title, eyebrow, description, count, action, children, className }: { title?: string; eyebrow?: string; description?: ReactNode; count?: number; action?: ReactNode; children: ReactNode; className?: string }) {
  return <Card className={cn("panel gap-0 p-0", className)}>
    {title && <CardHeader className="panel-heading flex flex-row items-center justify-between">
      <div className="panel-heading-text">{eyebrow && <span className="eyebrow">{eyebrow}</span>}<CardTitle><h2>{title}{count !== undefined && <span className="panel-count">{count}</span>}</h2></CardTitle>{description && <p className="panel-description">{description}</p>}</div>
      {action && <CardAction className="self-center">{action}</CardAction>}
    </CardHeader>}
    <CardContent className="panel-content p-0">{children}</CardContent>
  </Card>;
}

/** A dialog, or with `drawer` a panel from the right. `headerActions` sit next to the close button. */
export function Modal({ title, subtitle, children, onClose, drawer = false, headerActions, titleIcon }: { title: string; subtitle?: string; children: ReactNode; onClose: () => void; drawer?: boolean; headerActions?: ReactNode; titleIcon?: ReactNode }) {
  const content = useRef<HTMLDivElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);
  function focusFirstField(event: Event) {
    previousFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const field = content.current?.querySelector<HTMLElement>('input:not([type="hidden"]):not([type="file"]):not(.sr-only):not([disabled]):not([aria-hidden="true"]), textarea:not([disabled]), [role="combobox"]:not([disabled]), [role="checkbox"]:not([disabled])');
    if (field) { event.preventDefault(); field.focus({ preventScroll: true }); }
    // A details panel has no field to fill. Focus the panel itself, so no button looks selected, and Tab starts at the top.
    else if (drawer) { event.preventDefault(); content.current?.focus({ preventScroll: true }); }
  }
  function restoreFocus(event: Event) {
    event.preventDefault();
    if (previousFocus.current?.isConnected) previousFocus.current.focus({ preventScroll: true });
  }
  const close = (Close: typeof SheetClose | typeof DialogClose) => <Close asChild><Button variant="ghost" size="icon-sm" type="button" aria-label="Close dialog"><X aria-hidden="true" /></Button></Close>;
  if (drawer) return <Sheet open onOpenChange={open => { if (!open) onClose(); }}><SheetContent side="right" ref={content} showCloseButton={false} className="drawer gap-0 p-0 data-[side=right]:w-full sm:max-w-2xl" onOpenAutoFocus={focusFirstField} onCloseAutoFocus={restoreFocus}>
    <SheetHeader className="modal-heading drawer-heading flex flex-row items-center justify-between gap-3">
      <div className="drawer-heading-title">{titleIcon}<SheetTitle>{title}</SheetTitle><SheetDescription className={cn(!subtitle && "sr-only")}>{subtitle ?? `${title} details`}</SheetDescription></div>
      <div className="drawer-heading-actions">{headerActions}{close(SheetClose)}</div>
    </SheetHeader>{children}
  </SheetContent></Sheet>;
  return <Dialog open onOpenChange={open => { if (!open) onClose(); }}><DialogContent ref={content} showCloseButton={false} className="modal flex max-h-[calc(100dvh-2rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-xl" onOpenAutoFocus={focusFirstField} onCloseAutoFocus={restoreFocus}>
    <DialogHeader className="modal-heading flex flex-row items-start justify-between gap-4"><div><DialogTitle>{title}</DialogTitle><DialogDescription className={cn(!subtitle && "sr-only")}>{subtitle ?? `${title} form`}</DialogDescription></div>{close(DialogClose)}</DialogHeader>{children}
  </DialogContent></Dialog>;
}

export function ActionLink({ children, onClick }: { children: ReactNode; onClick: () => void }) {
  return <Button type="button" variant="link" className="text-action h-auto p-0" onClick={onClick}>{children}<ArrowUpRight aria-hidden="true" /></Button>;
}

export type BadgeVariant = ComponentProps<typeof Badge>["variant"];
