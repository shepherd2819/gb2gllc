"use client";
import { useState } from "react";

type Announcement = { id: string; title: string; body: string | null; type: string };

export function AnnouncementBanner({ announcements }: { announcements: Announcement[] }) {
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());

  async function dismiss(id: string) {
    setDismissed(prev => new Set([...prev, id]));
    await fetch(`/api/portal/announcements/${id}/dismiss`, { method: "POST" });
  }

  const visible = announcements.filter(a => !dismissed.has(a.id));
  if (visible.length === 0) return null;

  return (
    <div className="announcements-stack">
      {visible.map(a => (
        <div key={a.id} className={`announcement-banner type-${a.type}`}>
          <div className="ann-banner-content">
            <span className={`ann-banner-badge type-${a.type}`}>{a.type.replace("_", " ")}</span>
            <div className="ann-banner-text">
              <strong>{a.title}</strong>
              {a.body && <p>{a.body}</p>}
            </div>
          </div>
          <button className="ann-banner-close" onClick={() => dismiss(a.id)} aria-label="Dismiss">×</button>
        </div>
      ))}
    </div>
  );
}
