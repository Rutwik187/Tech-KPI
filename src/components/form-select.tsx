"use client";

import { Children, Fragment, cloneElement, isValidElement, useId, useRef, useState, type ComponentProps, type InputHTMLAttributes, type ReactElement, type ReactNode, type SelectHTMLAttributes } from "react";
import { cn } from "@/lib/utils";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldContent, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { CalendarIcon, ChevronsUpDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

type OptionProps = { children?: ReactNode; value?: string | number; disabled?: boolean; label?: string; className?: string };
type Option = { value: string; label: ReactNode; disabled?: boolean };
function optionList(children: ReactNode): Option[] {
  return Children.toArray(children).flatMap(child => {
    if (!isValidElement<OptionProps>(child)) return [];
    if (child.type === Fragment || child.type === "optgroup") return optionList(child.props.children);
    if (child.type !== "option") return [];
    return [{ value: String(child.props.value ?? child.props.children ?? ""), label: child.props.label ?? child.props.children, disabled: child.props.disabled }];
  });
}

export type FormSelectProps = Pick<SelectHTMLAttributes<HTMLSelectElement>, "id" | "name" | "required" | "disabled" | "className" | "title" | "form" | "aria-label" | "aria-labelledby" | "aria-describedby" | "aria-invalid"> & {
  value?: string;
  defaultValue?: string;
  children: ReactNode;
  onValueChange?: (value: string) => void;
};

/** Plain text of an option label, used for search. */
function labelText(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(labelText).join("");
  if (isValidElement<{ children?: ReactNode }>(node)) return labelText(node.props.children);
  return "";
}

/**
 * A shadcn Combobox: a button that opens a searchable list. Children stay plain <option> elements.
 * A visually hidden input carries the value, so `name` works with FormData and `required` blocks submission.
 */
export function FormSelect({ children, value, defaultValue, onValueChange, name, required, disabled, className, form, title, ...triggerProps }: FormSelectProps) {
  const options = optionList(children);
  const generatedId = useId();
  const errorId = `${generatedId}-error`;
  const listId = `${generatedId}-list`;
  const trigger = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [internalValue, setInternalValue] = useState(defaultValue ?? options.find(option => !option.disabled)?.value ?? "");
  const [invalid, setInvalid] = useState(false);
  const selectedValue = value ?? internalValue;
  const selected = options.find(option => option.value === selectedValue);
  const placeholder = options.find(option => option.value === "")?.label ?? "Choose an option";
  function choose(next: string) {
    setInternalValue(next);
    setInvalid(false);
    setOpen(false);
    onValueChange?.(next);
  }
  return <span className="form-select relative min-w-0">
    <Popover open={open} onOpenChange={setOpen} modal>
      <PopoverTrigger asChild>
        <Button {...triggerProps} ref={trigger} type="button" variant="outline" role="combobox" title={title} disabled={disabled} aria-expanded={open} aria-controls={listId} aria-haspopup="listbox"
          aria-required={required} aria-invalid={triggerProps["aria-invalid"] ?? (invalid || undefined)}
          aria-describedby={[triggerProps["aria-describedby"], invalid ? errorId : undefined].filter(Boolean).join(" ") || undefined}
          className={cn("form-select-trigger w-full justify-between font-normal", !selected?.label && "text-muted-foreground", className)}>
          <span className="truncate">{selected && selectedValue !== "" ? selected.label : placeholder}</span>
          <ChevronsUpDown data-icon="inline-end" className="opacity-50" aria-hidden="true" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="form-select-content w-(--radix-popover-trigger-width) min-w-48 p-0" align="start">
        <Command>
          <CommandInput placeholder="Search options…" aria-label="Search options" />
          <CommandList id={listId}>
            <CommandEmpty>No matches.</CommandEmpty>
            <CommandGroup>{options.map(option => <CommandItem key={option.value || "__empty"} value={`${labelText(option.label)} ${option.value}`} disabled={option.disabled} onSelect={() => choose(option.value)} data-checked={option.value === selectedValue}>
              <span className="truncate">{option.label}</span>
            </CommandItem>)}</CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
    <input className="sr-only" tabIndex={-1} aria-hidden="true" name={name} form={form} disabled={disabled} required={required} value={selectedValue} onChange={() => undefined}
      onInvalid={event => { event.preventDefault(); setInvalid(true); trigger.current?.focus(); }} />
    {invalid && <FieldError id={errorId} className="mt-1">Choose an option to continue.</FieldError>}
  </span>;
}

export type FormDateProps = Pick<InputHTMLAttributes<HTMLInputElement>, "id" | "name" | "required" | "disabled" | "className" | "form" | "aria-label" | "aria-labelledby" | "aria-describedby"> & {
  /** A calendar date, `YYYY-MM-DD`, or empty. */
  value?: string;
  defaultValue?: string;
  min?: string;
  max?: string;
  placeholder?: string;
  onValueChange?: (value: string) => void;
};
function toDate(value?: string) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day ? date : undefined;
}
function toKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

/** A shadcn date picker. Dates are calendar days (`YYYY-MM-DD`), never instants, so time zones cannot shift them. */
export function FormDate({ value, defaultValue, onValueChange, min, max, placeholder = "Pick a date", name, required, disabled, className, form, ...triggerProps }: FormDateProps) {
  const generatedId = useId();
  const errorId = `${generatedId}-error`;
  const trigger = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [internalValue, setInternalValue] = useState(defaultValue ?? "");
  const [invalid, setInvalid] = useState(false);
  const selectedValue = value ?? internalValue;
  const selected = toDate(selectedValue);
  const [fromDate, toDateLimit] = [toDate(min), toDate(max)];
  function choose(next: string) {
    setInternalValue(next);
    setInvalid(false);
    setOpen(false);
    onValueChange?.(next);
  }
  const label = selected ? new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric" }).format(selected) : placeholder;
  return <span className="form-date relative min-w-0">
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button {...triggerProps} ref={trigger} type="button" variant="outline" disabled={disabled} aria-haspopup="dialog" aria-expanded={open}
          aria-required={required} aria-invalid={invalid || undefined} aria-describedby={[triggerProps["aria-describedby"], invalid ? errorId : undefined].filter(Boolean).join(" ") || undefined}
          data-value={selectedValue || undefined} className={cn("form-date-trigger w-full justify-start font-normal", !selected && "text-muted-foreground", className)}>
          <CalendarIcon data-icon="inline-start" aria-hidden="true" /><span className="truncate">{label}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <Calendar mode="single" selected={selected} defaultMonth={selected ?? fromDate} weekStartsOn={1}
          disabled={[...(fromDate ? [{ before: fromDate }] : []), ...(toDateLimit ? [{ after: toDateLimit }] : [])]}
          onSelect={date => { if (date) choose(toKey(date)); }} />
        {!required && selected && <div className="border-t p-2"><Button type="button" variant="ghost" size="sm" className="w-full" onClick={() => choose("")}>Clear date</Button></div>}
      </PopoverContent>
    </Popover>
    <input className="sr-only" tabIndex={-1} aria-hidden="true" name={name} form={form} disabled={disabled} required={required} value={selectedValue} onChange={() => undefined}
      onInvalid={event => { event.preventDefault(); setInvalid(true); trigger.current?.focus(); }} />
    {invalid && <FieldError id={errorId} className="mt-1">Choose a date to continue.</FieldError>}
  </span>;
}

export type FormCheckboxProps = Pick<InputHTMLAttributes<HTMLInputElement>, "id" | "name" | "checked" | "defaultChecked" | "required" | "disabled" | "className" | "form" | "aria-label" | "aria-labelledby" | "aria-describedby" | "aria-invalid"> & {
  value?: string;
  onCheckedChange?: (checked: boolean) => void;
};

export function FormCheckbox({ onCheckedChange, ...props }: FormCheckboxProps) {
  return <Checkbox {...props} onCheckedChange={checked => onCheckedChange?.(checked === true)} />;
}

type FieldChildProps = { children?: ReactNode; className?: string; id?: string; disabled?: boolean; type?: string; "aria-labelledby"?: string; "aria-describedby"?: string };
function isHelp(node: ReactNode): node is ReactElement<FieldChildProps> {
  return isValidElement<FieldChildProps>(node) && (node.props.className?.split(/\s+/).includes("field-help") ?? false);
}
function isLabelText(node: ReactNode): boolean {
  return !isValidElement(node) || ["span", "strong", "em", "small"].includes(String(node.type));
}

/** Preserves compact form markup while composing real shadcn Field, Label and Description. */
export function FormField({ children, className, htmlFor, ...labelProps }: ComponentProps<"label">) {
  const generatedId = useId();
  const nodes = Children.toArray(children);
  const labelNodes = nodes.filter(node => isLabelText(node) && !isHelp(node));
  const helpNodes = nodes.filter(isHelp);
  const controlNodes = nodes.filter(node => !isLabelText(node) && !isHelp(node));
  const firstControl = controlNodes.find(node => isValidElement<FieldChildProps>(node));
  const controlId = htmlFor ?? (isValidElement<FieldChildProps>(firstControl) ? firstControl.props.id : undefined) ?? `${generatedId}-control`;
  const labelId = labelProps.id ?? `${generatedId}-label`;
  const descriptionId = helpNodes.length ? `${generatedId}-description` : undefined;
  const checkbox = isValidElement<FieldChildProps>(firstControl) && (firstControl.type === FormCheckbox || firstControl.type === Checkbox || firstControl.props.type === "checkbox");
  const controls = controlNodes.map(node => {
    if (node !== firstControl || !isValidElement<FieldChildProps>(node)) return node;
    return cloneElement(node, {
      id: controlId,
      "aria-labelledby": [node.props["aria-labelledby"], labelId].filter(Boolean).join(" "),
      "aria-describedby": [node.props["aria-describedby"], descriptionId].filter(Boolean).join(" ") || undefined,
    });
  });
  const label = <FieldLabel {...labelProps} id={labelId} htmlFor={controlId}>{labelNodes}</FieldLabel>;
  const description = helpNodes.length ? <FieldDescription id={descriptionId}>{helpNodes.map(node => <Fragment key={node.key}>{node.props.children}</Fragment>)}</FieldDescription> : null;
  return <Field className={className} orientation={checkbox ? "horizontal" : "vertical"} data-disabled={isValidElement<FieldChildProps>(firstControl) ? firstControl.props.disabled : undefined}>
    {checkbox ? <>{controls}<FieldContent>{label}{description}</FieldContent></> : <>{label}{controls}{description}</>}
  </Field>;
}
