// app/(admin)/ShellRefresh.tsx
"use client";
import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

const REFRESH_INTERVAL_MS = 120_000;
const MIN_REFRESH_GAP_MS = 15_000;

// The admin shell's live signals (agent status dots, the ticket badge, the
// ⌘K palette's client list) are fetched once in the server layout. Soft
// (client-side) navigation never re-renders that server layout, so those
// signals would otherwise go stale for the whole session. This invisible
// component keeps them live with a lightweight, debounced router.refresh().
export function ShellRefresh() {
  const router = useRouter();
  const lastRefreshRef = useRef(0);

  useEffect(() => {
    function refresh() {
      const now = Date.now();
      if (now - lastRefreshRef.current < MIN_REFRESH_GAP_MS) return;
      lastRefreshRef.current = now;
      router.refresh();
    }

    function onFocus() {
      refresh();
    }

    function onInterval() {
      if (document.visibilityState === "visible") refresh();
    }

    window.addEventListener("focus", onFocus);
    const interval = setInterval(onInterval, REFRESH_INTERVAL_MS);
    return () => {
      window.removeEventListener("focus", onFocus);
      clearInterval(interval);
    };
  }, [router]);

  return null;
}
