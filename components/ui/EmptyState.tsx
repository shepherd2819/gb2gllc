import { type ReactNode } from "react";
import { cn } from "./cn";

export function EmptyState({
  icon,
  title,
  body,
  action,
  className,
}: {
  icon?: ReactNode;
  title: string;
  body?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("ds-empty", className)}>
      {icon && (
        <span className="ds-empty-icon" aria-hidden>
          {icon}
        </span>
      )}
      <h3 className="ds-empty-title">{title}</h3>
      {body && <p className="ds-empty-body">{body}</p>}
      {action && <div className="ds-empty-actions">{action}</div>}
    </div>
  );
}
