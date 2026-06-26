"use client";
import { useState } from "react";

type M = {
  key: string;
  title: string;
  owner: "client" | "gb2g";
  status: "pending" | "in_progress" | "done" | "blocked" | "skipped";
  sort_order: number;
};

export function OnboardingChecklist({ milestones }: { milestones: M[] }) {
  const [items, setItems] = useState(milestones);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function complete(key: string) {
    setBusy(key);
    setErr(null);
    const res = await fetch("/api/portal/onboarding/complete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key }),
    });
    setBusy(null);
    if (res.ok) {
      setItems((prev) => prev.map((m) => (m.key === key ? { ...m, status: "done" } : m)));
    } else {
      setErr("Couldn't update that just now — try again.");
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {items
        .slice()
        .sort((a, b) => a.sort_order - b.sort_order)
        .map((m) => {
          const done = m.status === "done";
          const blocked = m.status === "blocked";
          const clientActionable = m.owner === "client" && !done && !blocked;
          return (
            <div
              key={m.key}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                padding: "14px 16px",
                border: "1px solid var(--rule, #E4DDCC)",
                borderRadius: 12,
                background: done ? "var(--rule-soft, #EDE7D7)" : "var(--parchment-2, #FAF6EC)",
                opacity: done ? 0.75 : 1,
              }}
            >
              <span
                aria-hidden
                style={{
                  width: 22,
                  height: 22,
                  borderRadius: "50%",
                  flexShrink: 0,
                  display: "grid",
                  placeItems: "center",
                  fontSize: 13,
                  border: `1.5px solid ${done ? "var(--sage, #A6B49B)" : "var(--ink-mute, #8A8C85)"}`,
                  background: done ? "var(--sage, #A6B49B)" : "transparent",
                  color: done ? "#fff" : "transparent",
                }}
              >
                ✓
              </span>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 15, color: "var(--ink, #1C1E1B)", textDecoration: done ? "line-through" : "none" }}>{m.title}</div>
                <div style={{ fontSize: 11, fontFamily: "var(--mono, monospace)", color: "var(--ink-mute, #8A8C85)", textTransform: "uppercase", letterSpacing: "0.06em", marginTop: 2 }}>
                  {m.owner === "client" ? "Your step" : "We've got this"}
                  {blocked ? " · needs attention" : ""}
                </div>
              </div>
              {clientActionable && (
                <button
                  onClick={() => complete(m.key)}
                  disabled={busy === m.key}
                  style={{
                    border: "1px solid var(--ink, #1C1E1B)",
                    background: "var(--ink, #1C1E1B)",
                    color: "var(--parchment-2, #FAF6EC)",
                    borderRadius: 100,
                    padding: "6px 14px",
                    fontSize: 13,
                    cursor: "pointer",
                  }}
                >
                  {busy === m.key ? "…" : "Mark done"}
                </button>
              )}
            </div>
          );
        })}
      {err && <div style={{ color: "var(--terracotta, #C97B5C)", fontSize: 13 }}>{err}</div>}
    </div>
  );
}
