"use client";
import { type ButtonHTMLAttributes, type Ref } from "react";
import { cn } from "./cn";

type Variant = "primary" | "ghost" | "subtle" | "danger" | "danger-solid";
type Size = "sm" | "md" | "lg";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  block?: boolean;
  ref?: Ref<HTMLButtonElement>;
}

export function Button({
  variant = "primary",
  size = "md",
  loading = false,
  block = false,
  className,
  children,
  disabled,
  type,
  ref,
  ...rest
}: ButtonProps) {
  return (
    <button
      ref={ref}
      type={type ?? "button"}
      className={cn(
        "ds-btn",
        `ds-btn--${variant}`,
        size !== "md" && `ds-btn--${size}`,
        block && "ds-btn--block",
        className,
      )}
      data-loading={loading || undefined}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {children}
    </button>
  );
}
