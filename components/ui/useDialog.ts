"use client";
import { useEffect, useRef, type RefObject } from "react";

const FOCUSABLE =
  'a[href],button:not([disabled]),textarea:not([disabled]),input:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])';

/**
 * Dialog behavior shared by Modal and Drawer:
 * - focus the first focusable element on open
 * - trap Tab focus within the dialog
 * - close on Escape
 * - lock body scroll while open
 * - restore focus to the previously-focused element on close
 */
export function useDialog<T extends HTMLElement>(
  open: boolean,
  onClose: () => void,
  ref: RefObject<T | null>,
) {
  // Keep onClose in a ref so its (usually inline) identity changing on every
  // parent render does NOT re-run the effect — which would steal focus back to
  // the first focusable and re-lock scroll on every keystroke in a modal form.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    const node = ref.current;
    const previouslyFocused = (document.activeElement as HTMLElement | null) ?? null;

    const initial = node?.querySelectorAll<HTMLElement>(FOCUSABLE);
    (initial && initial.length ? initial[0] : node)?.focus();

    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.stopPropagation();
        onCloseRef.current();
        return;
      }
      if (e.key === "Tab" && node) {
        const items = Array.from(node.querySelectorAll<HTMLElement>(FOCUSABLE));
        if (items.length === 0) {
          e.preventDefault();
          return;
        }
        const first = items[0];
        const last = items[items.length - 1];
        const active = document.activeElement;
        if (e.shiftKey && active === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && active === last) {
          e.preventDefault();
          first.focus();
        }
      }
    }

    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      document.body.style.overflow = prevOverflow;
      previouslyFocused?.focus?.();
    };
  }, [open, ref]);
}
