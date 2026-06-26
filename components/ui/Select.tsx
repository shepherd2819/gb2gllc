"use client";
import { type SelectHTMLAttributes, type Ref } from "react";
import { cn } from "./cn";

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  invalid?: boolean;
  ref?: Ref<HTMLSelectElement>;
}

export function Select({ invalid, className, children, ref, ...rest }: SelectProps) {
  return (
    <select
      ref={ref}
      className={cn("ds-select", className)}
      aria-invalid={invalid || undefined}
      {...rest}
    >
      {children}
    </select>
  );
}
