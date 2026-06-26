import { type HTMLAttributes } from "react";
import { cn } from "./cn";
import { statusTone, statusLabel, type Tone } from "./status";

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: Tone;
  dot?: boolean;
}

export function Badge({ tone = "muted", dot = false, className, children, ...rest }: BadgeProps) {
  return (
    <span className={cn("ds-badge", `ds-badge--${tone}`, className)} {...rest}>
      {dot && <span className="ds-badge-dot" aria-hidden />}
      {children}
    </span>
  );
}

/** Status enum → toned pill with dot. Use for any *_status column. */
export function StatusPill({
  status,
  dot = true,
  className,
}: {
  status: string | null | undefined;
  dot?: boolean;
  className?: string;
}) {
  return (
    <Badge tone={statusTone(status)} dot={dot} className={className}>
      {statusLabel(status)}
    </Badge>
  );
}
