"use client";
import { useState } from "react";

type Subscription = {
  member_urn: string;
  name: string | null;
  email: string | null;
  picture: string | null;
  expires_at: string | null;
  installed_at: string;
};

type Post = {
  id: string;
  pillar: string | null;
  draft_text: string;
  edited_text: string | null;
  status: "draft" | "approved" | "scheduled" | "published" | "rejected" | "failed";
  scheduled_for: string | null;
  published_at: string | null;
  linkedin_url: string | null;
  rejected_reason: string | null;
  created_at: string;
};

type Props = {
  clientId: string;
  initialConfig: {
    content_pillars: string[];
    voice_notes: string | null;
    ctas: string[];
    hashtags: string[];
    banned_words: string[];
    posting_cadence: string;
    posting_time_local: string;
    timezone: string;
    auto_publish: boolean;
  } | null;
  subscription: Subscription | null;
  posts: Post[];
};

const PILLAR_OPTIONS = [
  { id: "ai-strategy",        label: "AI strategy for SMBs" },
  { id: "building-in-public", label: "Behind-the-scenes building GB2G" },
  { id: "tips",               label: "Helpful AI tips & capabilities" },
  { id: "faith-anchored",     label: "Faith-anchored work" },
  { id: "industry-news",      label: "Industry commentary" },
];

const CADENCE_OPTIONS = [
  { value: "weekdays", label: "Weekdays (Mon-Fri)" },
  { value: "daily",    label: "Every day" },
  { value: "mwf",      label: "Mon / Wed / Fri" },
  { value: "ondemand", label: "On-demand only" },
];

export function ReeseManager({ clientId, initialConfig, subscription, posts }: Props) {
  const [cfg, setCfg] = useState(initialConfig ?? {
    content_pillars: [],
    voice_notes: "",
    ctas: [],
    hashtags: [],
    banned_words: [],
    posting_cadence: "weekdays",
    posting_time_local: "08:30",
    timezone: "America/Chicago",
    auto_publish: false,
  });
  const [allPosts, setAllPosts] = useState(posts);
  const [savingCfg, setSavingCfg] = useState(false);
  const [drafting, setDrafting] = useState(false);
  const [busyPostId, setBusyPostId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState("");
  const [msg, setMsg] = useState<{ text: string; tone: "ok" | "err" } | null>(null);

  function flash(text: string, tone: "ok" | "err") {
    setMsg({ text, tone });
    setTimeout(() => setMsg(null), 4000);
  }

  function togglePillar(id: string) {
    setCfg((prev) => ({
      ...prev,
      content_pillars: prev.content_pillars.includes(id)
        ? prev.content_pillars.filter((p) => p !== id)
        : [...prev.content_pillars, id],
    }));
  }

  async function saveCfg() {
    setSavingCfg(true);
    const res = await fetch(`/api/admin/clients/${clientId}/reese/config`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...cfg,
        ctas: textToArray(cfg.ctas),
        hashtags: textToArray(cfg.hashtags),
        banned_words: textToArray(cfg.banned_words),
      }),
    });
    setSavingCfg(false);
    if (res.ok) flash("Saved", "ok");
    else flash("Save failed", "err");
  }

  async function drawDraft() {
    setDrafting(true);
    const res = await fetch(`/api/admin/clients/${clientId}/reese/draft`, { method: "POST" });
    const data = await res.json();
    setDrafting(false);
    if (res.ok) {
      setAllPosts((p) => [data.post, ...p]);
      flash("Draft ready below", "ok");
    } else {
      flash(data.error || "Failed to draft", "err");
    }
  }

  async function approveAndPublish(postId: string) {
    setBusyPostId(postId);
    const res = await fetch(`/api/admin/clients/${clientId}/reese/posts/${postId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "approve_and_publish" }),
    });
    const data = await res.json();
    setBusyPostId(null);
    if (res.ok) {
      setAllPosts((arr) => arr.map((p) => p.id === postId
        ? { ...p, status: "published", published_at: new Date().toISOString(), linkedin_url: data.url ?? null }
        : p));
      flash("Posted to LinkedIn", "ok");
    } else {
      flash(data.error || "Failed", "err");
    }
  }

  async function reject(postId: string) {
    if (!confirm("Reject this draft?")) return;
    setBusyPostId(postId);
    const res = await fetch(`/api/admin/clients/${clientId}/reese/posts/${postId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "reject" }),
    });
    setBusyPostId(null);
    if (res.ok) {
      setAllPosts((arr) => arr.map((p) => p.id === postId ? { ...p, status: "rejected" } : p));
      flash("Rejected", "ok");
    } else flash("Failed", "err");
  }

  async function saveEdit(postId: string) {
    setBusyPostId(postId);
    const res = await fetch(`/api/admin/clients/${clientId}/reese/posts/${postId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ edited_text: editText }),
    });
    setBusyPostId(null);
    if (res.ok) {
      setAllPosts((arr) => arr.map((p) => p.id === postId ? { ...p, edited_text: editText } : p));
      setEditingId(null);
      flash("Saved edit", "ok");
    } else flash("Failed", "err");
  }

  const pending = allPosts.filter((p) => p.status === "draft" || p.status === "approved");
  const published = allPosts.filter((p) => p.status === "published");

  return (
    <div className="admin-card">
      <div className="admin-card-head">
        <h2>Reese (LinkedIn)</h2>
        {subscription && (
          <span style={{ fontSize: 11, color: "var(--text-mute)", fontFamily: "var(--mono)" }}>
            Connected · {subscription.name || subscription.member_urn.slice(-8)}
          </span>
        )}
      </div>

      {/* ── Connection ────────────────────────────────────────────────── */}
      {!subscription ? (
        <div className="admin-empty" style={{ padding: 12 }}>
          LinkedIn not connected.{" "}
          <a href={`/api/linkedin/install?clientId=${clientId}`} className="at-link">Connect LinkedIn →</a>
        </div>
      ) : (
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 18, fontSize: 13 }}>
          {subscription.picture && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={subscription.picture} alt="" style={{ width: 32, height: 32, borderRadius: "50%" }} />
          )}
          <div style={{ display: "flex", flexDirection: "column" }}>
            <span>{subscription.name || subscription.email || subscription.member_urn}</span>
            {subscription.expires_at && (
              <span style={{ fontSize: 11, fontFamily: "var(--mono)", color: "var(--text-mute)" }}>
                Token expires {new Date(subscription.expires_at).toLocaleDateString()}
              </span>
            )}
          </div>
          <a href={`/api/linkedin/install?clientId=${clientId}`} className="at-link" style={{ marginLeft: "auto", fontSize: 12 }}>
            Reconnect
          </a>
        </div>
      )}

      {/* ── Config ────────────────────────────────────────────────────── */}
      <div className="admin-input-row">
        <label>Content pillars</label>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          {PILLAR_OPTIONS.map((p) => {
            const on = cfg.content_pillars.includes(p.id);
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => togglePillar(p.id)}
                style={{
                  fontSize: 12,
                  padding: "5px 11px",
                  borderRadius: 100,
                  border: `1px solid ${on ? "var(--ink)" : "var(--rule)"}`,
                  background: on ? "var(--ink)" : "transparent",
                  color: on ? "var(--parchment-2)" : "var(--text-soft, var(--ink))",
                  cursor: "pointer",
                  fontFamily: "var(--mono)",
                  letterSpacing: 0.05,
                }}
              >
                {p.label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="admin-input-row" style={{ marginTop: 12 }}>
        <label>Voice notes <span style={{ color: "var(--text-mute)", fontWeight: 400 }}>(optional)</span></label>
        <textarea
          className="admin-textarea"
          rows={3}
          placeholder="e.g. Founder voice, lowercase only, never quote scripture in posts, always end with a concrete number"
          value={cfg.voice_notes ?? ""}
          onChange={(e) => setCfg({ ...cfg, voice_notes: e.target.value })}
        />
      </div>

      <div className="admin-input-row" style={{ marginTop: 12 }}>
        <label>CTAs <span style={{ color: "var(--text-mute)", fontWeight: 400 }}>(one per line — Reese rotates them)</span></label>
        <textarea
          className="admin-textarea"
          rows={3}
          placeholder={'Reply "Reese" if you want to talk through this.\nDM me to see how we built it.\nLink in the comments if you want the deeper write-up.'}
          value={arrayToText(cfg.ctas)}
          onChange={(e) => setCfg({ ...cfg, ctas: textToArray(e.target.value) })}
        />
      </div>

      <div className="admin-input-row" style={{ marginTop: 12, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <div>
          <label>Hashtags <span style={{ color: "var(--text-mute)", fontWeight: 400 }}>(comma-separated)</span></label>
          <input
            className="admin-input"
            style={{ marginBottom: 0, fontFamily: "var(--mono)", fontSize: 12 }}
            placeholder="AI, Automation, SmallBusiness"
            value={arrayToText(cfg.hashtags)}
            onChange={(e) => setCfg({ ...cfg, hashtags: textToArray(e.target.value) })}
          />
        </div>
        <div>
          <label>Banned words <span style={{ color: "var(--text-mute)", fontWeight: 400 }}>(comma-separated)</span></label>
          <input
            className="admin-input"
            style={{ marginBottom: 0, fontFamily: "var(--mono)", fontSize: 12 }}
            placeholder="leverage, synergy"
            value={arrayToText(cfg.banned_words)}
            onChange={(e) => setCfg({ ...cfg, banned_words: textToArray(e.target.value) })}
          />
        </div>
      </div>

      <div className="admin-input-row" style={{ marginTop: 12, display: "grid", gridTemplateColumns: "1.4fr 1fr 1fr", gap: 12 }}>
        <div>
          <label>Cadence</label>
          <select
            className="admin-select"
            style={{ marginBottom: 0 }}
            value={cfg.posting_cadence}
            onChange={(e) => setCfg({ ...cfg, posting_cadence: e.target.value })}
          >
            {CADENCE_OPTIONS.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
          </select>
        </div>
        <div>
          <label>Time (local)</label>
          <input
            className="admin-input"
            style={{ marginBottom: 0, fontFamily: "var(--mono)" }}
            value={cfg.posting_time_local}
            onChange={(e) => setCfg({ ...cfg, posting_time_local: e.target.value })}
            placeholder="08:30"
          />
        </div>
        <div>
          <label>Timezone</label>
          <input
            className="admin-input"
            style={{ marginBottom: 0, fontFamily: "var(--mono)", fontSize: 12 }}
            value={cfg.timezone}
            onChange={(e) => setCfg({ ...cfg, timezone: e.target.value })}
            placeholder="America/Chicago"
          />
        </div>
      </div>

      <label style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 12, fontSize: 13, cursor: "pointer" }}>
        <input
          type="checkbox"
          checked={cfg.auto_publish}
          onChange={(e) => setCfg({ ...cfg, auto_publish: e.target.checked })}
        />
        <span>Auto-publish (skip admin review) — leave off while training Reese</span>
      </label>

      <div style={{ display: "flex", gap: 8, marginTop: 16, alignItems: "center", flexWrap: "wrap" }}>
        <button className="admin-btn admin-btn-sm" onClick={saveCfg} disabled={savingCfg}>
          {savingCfg ? "Saving…" : "Save config"}
        </button>
        <button
          className="admin-btn-ghost admin-btn-sm"
          onClick={drawDraft}
          disabled={drafting || cfg.content_pillars.length === 0}
        >
          {drafting ? "Drafting…" : "Draft a post now"}
        </button>
        {msg && (
          <span style={{ fontSize: 12, fontFamily: "var(--mono)", color: msg.tone === "ok" ? "var(--sage)" : "var(--red)" }}>
            {msg.text}
          </span>
        )}
      </div>

      {/* ── Pending drafts queue ──────────────────────────────────────── */}
      {pending.length > 0 && (
        <>
          <div className="admin-card-head" style={{ marginTop: 28, marginBottom: 8, borderTop: "1px solid var(--rule, rgba(28,30,27,0.1))", paddingTop: 18 }}>
            <h2 style={{ fontSize: 14 }}>Pending review · {pending.length}</h2>
          </div>
          {pending.map((p) => (
            <div key={p.id} style={{ padding: 14, border: "1px solid var(--rule, rgba(28,30,27,0.1))", borderRadius: 8, marginBottom: 10, background: "var(--bg-mute, rgba(28,30,27,0.03))" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 6 }}>
                <span style={{ fontSize: 10, fontFamily: "var(--mono)", letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--text-mute)" }}>
                  {p.pillar ?? "—"} · {new Date(p.created_at).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
                </span>
              </div>
              {editingId === p.id ? (
                <textarea
                  className="admin-textarea"
                  rows={10}
                  value={editText}
                  onChange={(e) => setEditText(e.target.value)}
                  style={{ width: "100%" }}
                />
              ) : (
                <pre style={{ whiteSpace: "pre-wrap", fontFamily: "var(--sans, inherit)", fontSize: 13, lineHeight: 1.55, color: "var(--ink)", margin: 0 }}>
                  {p.edited_text ?? p.draft_text}
                </pre>
              )}
              <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
                {editingId === p.id ? (
                  <>
                    <button className="admin-btn admin-btn-sm" onClick={() => saveEdit(p.id)} disabled={busyPostId === p.id}>
                      Save edit
                    </button>
                    <button className="admin-btn-ghost admin-btn-sm" onClick={() => { setEditingId(null); setEditText(""); }}>
                      Cancel
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      className="admin-btn admin-btn-sm"
                      onClick={() => approveAndPublish(p.id)}
                      disabled={busyPostId === p.id || !subscription}
                      title={!subscription ? "Connect LinkedIn first" : ""}
                    >
                      {busyPostId === p.id ? "Posting…" : "Approve + publish"}
                    </button>
                    <button
                      className="admin-btn-ghost admin-btn-sm"
                      onClick={() => { setEditingId(p.id); setEditText(p.edited_text ?? p.draft_text); }}
                    >
                      Edit
                    </button>
                    <button
                      className="admin-btn-ghost admin-btn-sm"
                      style={{ color: "var(--red)", borderColor: "rgba(196,82,75,0.4)" }}
                      onClick={() => reject(p.id)}
                      disabled={busyPostId === p.id}
                    >
                      Reject
                    </button>
                  </>
                )}
              </div>
            </div>
          ))}
        </>
      )}

      {/* ── Published history ─────────────────────────────────────────── */}
      {published.length > 0 && (
        <>
          <div className="admin-card-head" style={{ marginTop: 24, marginBottom: 8, borderTop: "1px solid var(--rule, rgba(28,30,27,0.1))", paddingTop: 18 }}>
            <h2 style={{ fontSize: 14 }}>Published · {published.length}</h2>
          </div>
          {published.slice(0, 10).map((p) => (
            <div key={p.id} style={{ padding: 10, borderBottom: "1px solid var(--rule, rgba(28,30,27,0.06))", fontSize: 13 }}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                <span style={{ fontSize: 10, fontFamily: "var(--mono)", color: "var(--text-mute)" }}>
                  {p.pillar ?? "—"} · {p.published_at ? new Date(p.published_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "2-digit" }) : ""}
                </span>
                {p.linkedin_url && (
                  <a href={p.linkedin_url} target="_blank" rel="noopener noreferrer" className="at-link" style={{ fontSize: 11 }}>
                    View on LinkedIn →
                  </a>
                )}
              </div>
              <div style={{ color: "var(--ink)", lineHeight: 1.5, opacity: 0.85 }}>
                {(p.edited_text ?? p.draft_text).slice(0, 220)}{(p.edited_text ?? p.draft_text).length > 220 ? "…" : ""}
              </div>
            </div>
          ))}
        </>
      )}
    </div>
  );
}

function textToArray(input: string | string[]): string[] {
  if (Array.isArray(input)) return input;
  return input.split(/[,\n]/).map((s) => s.trim()).filter((s) => s.length > 0);
}
function arrayToText(arr: string[] | undefined | null): string {
  return (arr ?? []).join("\n");
}
