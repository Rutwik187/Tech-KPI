"use client";

import { useRef, type ComponentProps, type ReactNode } from "react";
import { X, ArrowUpRight, CircleCheck, CircleDashed, CircleDot, Clock3, ShieldAlert, Bug, Inbox, Flag } from "lucide-react";
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

export function Avatar({ member, size = "normal" }: { member?: Member; size?: "small" | "normal" | "large" }) {
  return <AvatarPrimitive size={size === "small" ? "sm" : size === "large" ? "lg" : "default"} className={cn("avatar", `avatar-${size}`, size === "large" && "size-16")} role="img" aria-label={member?.name ?? "Unassigned"}>
    {member?.image && <AvatarImage src={member.image} alt="" />}
    <AvatarFallback aria-hidden="true" className={cn("bg-secondary text-secondary-foreground", size === "large" && "text-xl")}>{initials(member?.name ?? "?")}</AvatarFallback>
  </AvatarPrimitive>;
}

export function StatusBadge({ status }: { status: WorkItem["status"] }) {
  const labels: Record<WorkItem["status"], string> = { todo: "To do", in_progress: "In progress", in_review: "In review", blocked: "Blocked", done: "Done", open: "Open", fixed: "Fixed", verified: "Verified" };
  const variants: Record<WorkItem["status"], ComponentProps<typeof Badge>["variant"]> = {
    todo: "secondary", in_progress: "info", in_review: "warning", blocked: "destructive",
    done: "success", open: "destructive", fixed: "warning", verified: "success",
  };
  const Icon = status === "done" || status === "verified" ? CircleCheck : status === "blocked" || status === "open" ? ShieldAlert : status === "todo" ? CircleDashed : status === "in_review" || status === "fixed" ? Clock3 : CircleDot;
  return <Badge variant={variants[status]} className={cn("status-badge", `status-${status}`)}><Icon aria-hidden="true" />{labels[status]}</Badge>;
}

export function PriorityBadge({ priority }: { priority: WorkItem["priority"] }) {
  return <Badge variant={priority === "urgent" ? "destructive" : priority === "high" ? "warning" : priority === "low" ? "secondary" : "outline"} className={cn("priority", `priority-${priority}`)}><Flag aria-hidden="true" />{priority[0].toUpperCase() + priority.slice(1)}</Badge>;
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

export function EmptyState({ title, description, action, bug }: { title: string; description: string; action?: ReactNode; bug?: boolean }) {
  const Icon = bug ? Bug : Inbox;
  return <Empty className="empty-state"><EmptyHeader><EmptyMedia variant="icon" className="empty-icon"><Icon aria-hidden="true" /></EmptyMedia><EmptyTitle><h3>{title}</h3></EmptyTitle><EmptyDescription>{description}</EmptyDescription></EmptyHeader>{action && <EmptyContent>{action}</EmptyContent>}</Empty>;
}

export function Panel({ title, eyebrow, action, children, className }: { title?: string; eyebrow?: string; action?: ReactNode; children: ReactNode; className?: string }) {
  return <Card className={cn("panel gap-0 p-0", className)}>{title && <CardHeader className="panel-heading flex flex-row items-center justify-between"><div>{eyebrow && <span className="eyebrow">{eyebrow}</span>}<CardTitle><h2>{title}</h2></CardTitle></div>{action && <CardAction className="self-center">{action}</CardAction>}</CardHeader>}<CardContent className="panel-content p-0">{children}</CardContent></Card>;
}

export function Modal({ title, subtitle, children, onClose, drawer = false }: { title: string; subtitle?: string; children: ReactNode; onClose: () => void; drawer?: boolean }) {
  const content = useRef<HTMLDivElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);
  function focusFirstField(event: Event) {
    previousFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const field = content.current?.querySelector<HTMLElement>('input:not([type="hidden"]):not([type="file"]):not(.sr-only):not([disabled]):not([aria-hidden="true"]), textarea:not([disabled]), [role="combobox"]:not([disabled]), [role="checkbox"]:not([disabled])');
    if (field) { event.preventDefault(); field.focus({ preventScroll: true }); }
  }
  function restoreFocus(event: Event) {
    event.preventDefault();
    if (previousFocus.current?.isConnected) previousFocus.current.focus({ preventScroll: true });
  }
  if (drawer) return <Sheet open onOpenChange={open => { if (!open) onClose(); }}><SheetContent side="right" ref={content} showCloseButton={false} className="drawer gap-0 p-0 data-[side=right]:w-full sm:max-w-xl" onOpenAutoFocus={focusFirstField} onCloseAutoFocus={restoreFocus}>
    <SheetHeader className="modal-heading flex flex-row items-start justify-between gap-4"><div><SheetTitle>{title}</SheetTitle><SheetDescription className={cn(!subtitle && "sr-only")}>{subtitle ?? `${title} details`}</SheetDescription></div><SheetClose asChild><Button variant="ghost" size="icon" type="button" aria-label="Close dialog"><X aria-hidden="true" /></Button></SheetClose></SheetHeader>{children}
  </SheetContent></Sheet>;
  return <Dialog open onOpenChange={open => { if (!open) onClose(); }}><DialogContent ref={content} showCloseButton={false} className="modal flex max-h-[calc(100dvh-2rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-xl" onOpenAutoFocus={focusFirstField} onCloseAutoFocus={restoreFocus}>
    <DialogHeader className="modal-heading flex flex-row items-start justify-between gap-4"><div><DialogTitle>{title}</DialogTitle><DialogDescription className={cn(!subtitle && "sr-only")}>{subtitle ?? `${title} form`}</DialogDescription></div><DialogClose asChild><Button variant="ghost" size="icon" type="button" aria-label="Close dialog"><X aria-hidden="true" /></Button></DialogClose></DialogHeader>{children}
  </DialogContent></Dialog>;
}

export function ActionLink({ children, onClick }: { children: ReactNode; onClick: () => void }) {
  return <Button type="button" variant="link" className="text-action h-auto p-0" onClick={onClick}>{children}<ArrowUpRight aria-hidden="true" /></Button>;
}
