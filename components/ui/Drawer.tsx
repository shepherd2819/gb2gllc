"use client";
import { useId, useRef, type ReactNode, type MouseEvent } from "react";
import { createPortal } from "react-dom";
import { cn } from "./cn";
import { useDialog } from "./useDialog";

export interface DrawerProps {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  /** Accessible name when there is no visible string title (e.g. node title). */
  ariaLabel?: string;
  children: ReactNode;
  footer?: ReactNode;
  className?: string;
  closeLabel?: string;
}

/** Right-anchored drawer for create/edit flows (Supabase-style). */
export function Drawer({
  open,
  onClose,
  title,
  ariaLabel,
  children,
  footer,
  className,
  closeLabel = "Close",
}: DrawerProps) {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  useDialog(open, onClose, ref);

  if (!open || typeof document === "undefined") return null;

  function onOverlayDown(e: MouseEvent<HTMLDivElement>) {
    if (e.target === e.currentTarget) onClose();
  }

  return createPortal(
    <div className="ds-overlay ds-overlay--right" onMouseDown={onOverlayDown}>
      <div
        ref={ref}
        className={cn("ds-drawer", className)}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
        aria-label={!title ? ariaLabel : undefined}
        tabIndex={-1}
      >
        {title && (
          <div className="ds-modal-head">
            <h2 id={titleId} className="ds-modal-title">{title}</h2>
            <button type="button" className="ds-modal-close" onClick={onClose} aria-label={closeLabel}>
              ×
            </button>
          </div>
        )}
        {children}
        {footer && <div className="ds-modal-footer">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}
