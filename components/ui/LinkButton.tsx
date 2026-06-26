import { type AnchorHTMLAttributes } from "react";
import { cn } from "./cn";

type Variant = "primary" | "ghost" | "subtle" | "danger";
type Size = "sm" | "md" | "lg";

export interface LinkButtonProps extends AnchorHTMLAttributes<HTMLAnchorElement> {
  variant?: Variant;
  size?: Size;
  block?: boolean;
}

/** Anchor styled as a button (server-compatible — no client boundary). */
export function LinkButton({
  variant = "primary",
  size = "md",
  block = false,
  className,
  children,
  ...rest
}: LinkButtonProps) {
  return (
    <a
      className={cn(
        "ds-btn",
        `ds-btn--${variant}`,
        size !== "md" && `ds-btn--${size}`,
        block && "ds-btn--block",
        className,
      )}
      {...rest}
    >
      {children}
    </a>
  );
}
