"use client";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";

type ToastTone = "default" | "success" | "info" | "warning" | "error";

interface ToastAction {
  label: string;
  onClick: () => void;
}

interface ToastOptions {
  tone?: ToastTone;
  label?: string;
  duration?: number;
  action?: ToastAction;
}

interface ToastItem {
  id: number;
  message: string;
  tone: ToastTone;
  label?: string;
  duration: number;
  action?: ToastAction;
}

interface ToastApi {
  toast: (message: string, opts?: ToastOptions) => number;
  success: (message: string, opts?: ToastOptions) => number;
  error: (message: string, opts?: ToastOptions) => number;
  info: (message: string, opts?: ToastOptions) => number;
  /** Optimistic undo snackbar — shows the message with an "Undo" action. */
  undo: (message: string, onUndo: () => void, opts?: ToastOptions) => number;
  dismiss: (id: number) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within <ToastProvider>");
  return ctx;
}

let counter = 0;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const timers = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map());

  const dismiss = useCallback((id: number) => {
    setItems((prev) => prev.filter((t) => t.id !== id));
    const tm = timers.current.get(id);
    if (tm) {
      clearTimeout(tm);
      timers.current.delete(id);
    }
  }, []);

  const schedule = useCallback(
    (id: number, duration: number) => {
      if (duration <= 0) return;
      const tm = setTimeout(() => dismiss(id), duration);
      timers.current.set(id, tm);
    },
    [dismiss],
  );

  const pause = useCallback((id: number) => {
    const tm = timers.current.get(id);
    if (tm) {
      clearTimeout(tm);
      timers.current.delete(id);
    }
  }, []);

  const push = useCallback(
    (message: string, opts?: ToastOptions) => {
      const id = ++counter;
      const item: ToastItem = {
        id,
        message,
        tone: opts?.tone ?? "default",
        label: opts?.label,
        duration: opts?.duration ?? 5000,
        action: opts?.action,
      };
      setItems((prev) => [...prev, item]);
      schedule(id, item.duration);
      return id;
    },
    [schedule],
  );

  const api = useMemo<ToastApi>(
    () => ({
      toast: (m, o) => push(m, o),
      success: (m, o) => push(m, { tone: "success", ...o }),
      error: (m, o) => push(m, { tone: "error", duration: 8000, ...o }),
      info: (m, o) => push(m, { tone: "info", ...o }),
      undo: (m, onUndo, o) =>
        push(m, {
          tone: o?.tone ?? "default",
          duration: o?.duration ?? 6000,
          label: o?.label ?? "Done",
          action: { label: "Undo", onClick: onUndo },
        }),
      dismiss,
    }),
    [push, dismiss],
  );

  useEffect(() => {
    const map = timers.current;
    return () => {
      map.forEach((t) => clearTimeout(t));
      map.clear();
    };
  }, []);

  return (
    <ToastContext.Provider value={api}>
      {children}
      <Toaster
        items={items}
        onDismiss={dismiss}
        onPause={pause}
        onResume={(id, d) => schedule(id, d)}
      />
    </ToastContext.Provider>
  );
}

function Toaster({
  items,
  onDismiss,
  onPause,
  onResume,
}: {
  items: ToastItem[];
  onDismiss: (id: number) => void;
  onPause: (id: number) => void;
  onResume: (id: number, duration: number) => void;
}) {
  if (typeof document === "undefined") return null;
  return createPortal(
    <div className="ds-toast-region" role="region" aria-label="Notifications">
      {items.map((t) => (
        <div
          key={t.id}
          className={`ds-toast ds-toast--${t.tone}`}
          role={t.tone === "error" ? "alert" : "status"}
          aria-live={t.tone === "error" ? "assertive" : "polite"}
          onMouseEnter={() => onPause(t.id)}
          onMouseLeave={() => onResume(t.id, t.duration)}
          onFocus={() => onPause(t.id)}
          onBlur={() => onResume(t.id, t.duration)}
        >
          <div className="ds-toast-body">
            {t.label && <div className="ds-toast-label">{t.label}</div>}
            <div className="ds-toast-msg">{t.message}</div>
          </div>
          {t.action && (
            <button
              type="button"
              className="ds-toast-action"
              onClick={() => {
                t.action!.onClick();
                onDismiss(t.id);
              }}
            >
              {t.action.label}
            </button>
          )}
          <button
            type="button"
            className="ds-toast-close"
            onClick={() => onDismiss(t.id)}
            aria-label="Dismiss"
          >
            ×
          </button>
        </div>
      ))}
    </div>,
    document.body,
  );
}
