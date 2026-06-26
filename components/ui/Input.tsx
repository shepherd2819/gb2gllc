"use client";
import { type InputHTMLAttributes, type Ref } from "react";
import { cn } from "./cn";

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  invalid?: boolean;
  ref?: Ref<HTMLInputElement>;
}

export function Input({ invalid, className, ref, ...rest }: InputProps) {
  return (
    <input
      ref={ref}
      className={cn("ds-input", className)}
      aria-invalid={invalid || undefined}
      {...rest}
    />
  );
}
