"use client";
import { useId, cloneElement, isValidElement, type ReactElement, type ReactNode } from "react";
import { cn } from "./cn";

/**
 * Labelled form field. Wraps a single control (Input/Textarea/Select) and
 * wires up id ↔ htmlFor, aria-describedby (hint/error), and aria-invalid.
 *
 * <Field label="Email" hint="Work address" error={err}><Input type="email" /></Field>
 */
export function Field({
  label,
  hint,
  error,
  required,
  className,
  children,
}: {
  label?: string;
  hint?: string;
  error?: string | null;
  required?: boolean;
  className?: string;
  children: ReactNode;
}) {
  const id = useId();
  const child = isValidElement(children)
    ? (children as ReactElement<Record<string, unknown>>)
    : null;

  // ids only when their node is actually rendered (avoids dangling describedby)
  const hintId = hint && !error ? `${id}-hint` : undefined;
  const errId = error ? `${id}-err` : undefined;
  // prefer a caller-supplied id on the control; merge any existing describedby
  const childId = (child?.props["id"] as string | undefined) ?? id;
  const childDescribed = child?.props["aria-describedby"] as string | undefined;
  const describedBy =
    [childDescribed, hintId, errId].filter(Boolean).join(" ") || undefined;

  const control = child
    ? cloneElement(child, {
        id: childId,
        "aria-describedby": describedBy,
        // only assert invalid when Field owns the error — don't clobber a
        // control's own `invalid` prop when there's no field-level error
        ...(error ? { "aria-invalid": true } : {}),
      })
    : children;

  return (
    <div className={cn("ds-field", className)}>
      {label && (
        <label className="ds-label" htmlFor={childId}>
          {label}
          {required && <span aria-hidden> *</span>}
        </label>
      )}
      {control}
      {hint && !error && (
        <span className="ds-hint" id={hintId}>
          {hint}
        </span>
      )}
      {error && (
        <span className="ds-error-text" id={errId} role="alert">
          {error}
        </span>
      )}
    </div>
  );
}
