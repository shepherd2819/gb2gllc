// components/analytics/command-center/CcBriefing.tsx
"use client";
import { useState } from "react";
import { useToast } from "@/components/ui";

export function CcBriefing({
  briefing,
  clientId,
  onFollowUp,
}: {
  briefing: string;
  clientId?: string;
  onFollowUp?: (text: string) => void;
}) {
  const [text, setText] = useState(briefing);
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  async function regenerate() {
    setBusy(true);
    try {
      const res = await fetch("/api/portal/analytics/briefing/regenerate", { method: "POST" });
      if (!res.ok) throw new Error(String(res.status));
      const data = (await res.json()) as { briefing?: string };
      if (data.briefing && data.briefing.length > 0) {
        setText(data.briefing);
        toast.success("Briefing updated.");
      } else {
        toast.info("Briefing will appear after your next sync.");
      }
    } catch {
      toast.error("Could not regenerate the briefing right now.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="cc-briefing" aria-label="AI executive briefing">
      <div className="cc-briefing-head">
        <h2 className="cc-briefing-title">AI Briefing</h2>
        <span className="cc-live-dot" aria-hidden />
      </div>
      {text ? (
        <p className="cc-briefing-body">{text}</p>
      ) : (
        <p className="cc-briefing-empty">Briefing will appear after your next sync.</p>
      )}
      <div className="cc-briefing-actions">
        {clientId ? (
          <button type="button" className="cc-btn" onClick={regenerate} disabled={busy}>
            {busy ? "Regenerating…" : "Regenerate"}
          </button>
        ) : null}
        {onFollowUp && text ? (
          <button
            type="button"
            className="cc-btn cc-btn--ghost"
            onClick={() => onFollowUp(text)}
          >
            Ask a follow-up →
          </button>
        ) : null}
      </div>
    </section>
  );
}
