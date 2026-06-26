"use client";
import { type TextareaHTMLAttributes, type Ref } from "react";
import { cn } from "./cn";

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  invalid?: boolean;
  ref?: Ref<HTMLTextAreaElement>;
}

export function Textarea({ invalid, className, ref, ...rest }: TextareaProps) {
  return (
    <textarea
      ref={ref}
      className={cn("ds-textarea", className)}
      aria-invalid={invalid || undefined}
      {...rest}
    />
  );
}
