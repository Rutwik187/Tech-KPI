"use client";

import { Children, Fragment, cloneElement, isValidElement, useId, useRef, useState, type ComponentProps, type InputHTMLAttributes, type ReactElement, type ReactNode, type SelectHTMLAttributes } from "react";
import { cn } from "@/lib/utils";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldContent, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

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

export type FormSelectProps = Pick<SelectHTMLAttributes<HTMLSelectElement>, "id" | "name" | "required" | "disabled" | "className" | "title" | "autoComplete" | "autoFocus" | "form" | "aria-label" | "aria-labelledby" | "aria-describedby" | "aria-invalid"> & {
  value?: string;
  defaultValue?: string;
  children: ReactNode;
  onValueChange?: (value: string) => void;
};

/** The visible control is a shadcn Select. Radix supplies the native hidden form control. */
export function FormSelect({ children, value, defaultValue, onValueChange, name, required, disabled, className, autoComplete, form, ...triggerProps }: FormSelectProps) {
  const options = optionList(children);
  const generatedId = useId();
  const emptyValue = `__empty_${generatedId}`;
  const errorId = `${generatedId}-error`;
  const trigger = useRef<HTMLButtonElement>(null);
  const [internalValue, setInternalValue] = useState(defaultValue ?? options.find(option => !option.disabled)?.value ?? "");
  const [invalid, setInvalid] = useState(false);
  const selectedValue = value ?? internalValue;
  const placeholder = options.find(option => option.value === "")?.label ?? "Choose an option";
  return <span className="form-select min-w-0" onInvalidCapture={event => { event.preventDefault(); setInvalid(true); trigger.current?.focus(); }}>
    <Select name={name} form={form} required={required} disabled={disabled} autoComplete={autoComplete} value={selectedValue} onValueChange={next => {
      const actualValue = next === emptyValue ? "" : next;
      setInternalValue(actualValue);
      setInvalid(false);
      onValueChange?.(actualValue);
    }}>
      <SelectTrigger {...triggerProps} ref={trigger} className={cn("w-full", className)} aria-required={required} aria-invalid={triggerProps["aria-invalid"] ?? (invalid || undefined)} aria-describedby={[triggerProps["aria-describedby"], invalid ? errorId : undefined].filter(Boolean).join(" ") || undefined}><SelectValue placeholder={placeholder} /></SelectTrigger>
      <SelectContent position="popper" align="start"><SelectGroup>{options.map(option => <SelectItem key={option.value} value={option.value || emptyValue} disabled={option.disabled}>{option.label}</SelectItem>)}</SelectGroup></SelectContent>
    </Select>
    {invalid && <FieldError id={errorId} className="mt-1">Choose an option to continue.</FieldError>}
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
