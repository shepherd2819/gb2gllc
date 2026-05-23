"use client";
import { useState } from "react";

const HOURS_PRESETS = [
  "Mon–Fri 9–5 ET",
  "Mon–Fri 9–5 CT",
  "Mon–Fri 9–5 MT",
  "Mon–Fri 9–5 PT",
  "Mon–Fri 8–6 ET",
  "Mon–Fri 8–6 CT",
  "Mon–Fri 8–6 MT",
  "Mon–Fri 8–6 PT",
  "Mon–Sat 9–6 ET",
  "Mon–Sat 9–6 CT",
  "Mon–Sat 9–6 MT",
  "Mon–Sat 9–6 PT",
  "7 days a week 9–6",
  "24/7 (always available)",
  "By appointment only",
];

function BusinessHoursPicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const isPreset = HOURS_PRESETS.includes(value);
  const [mode, setMode] = useState<"preset" | "custom">(value && !isPreset ? "custom" : "preset");

  function onSelectChange(v: string) {
    if (v === "__custom__") {
      setMode("custom");
      onChange("");
    } else if (v === "") {
      setMode("preset");
      onChange("");
    } else {
      setMode("preset");
      onChange(v);
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <select
        className="admin-select"
        style={{ marginBottom: 0 }}
        value={mode === "custom" ? "__custom__" : value}
        onChange={(e) => onSelectChange(e.target.value)}
      >
        <option value="">Not set</option>
        {HOURS_PRESETS.map((h) => (
          <option key={h} value={h}>{h}</option>
        ))}
        <option value="__custom__">Custom…</option>
      </select>
      {mode === "custom" && (
        <input
          className="admin-input"
          style={{ marginBottom: 0 }}
          placeholder="e.g. Mon, Wed, Fri 10–4 CT · closed holidays"
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
    </div>
  );
}

type Subscription = {
  page_id: string;
  page_name: string;
  instagram_username: string | null;
  active: boolean;
  installed_at: string;
};

type Props = {
  clientId: string;
  initialConfig: {
    website_url: string | null;
    booking_url: string | null;
    order_url: string | null;
    custom_link_label: string | null;
    custom_link_url: string | null;
    custom_instructions: string | null;
    business_hours: string | null;
    escalation_channel: string | null;
    reply_to_dms: boolean;
    reply_to_comments: boolean;
  } | null;
  subscriptions: Subscription[];
};

export function MayaManager({ clientId, initialConfig, subscriptions }: Props) {
  const [cfg, setCfg] = useState(initialConfig ?? {
    website_url: "",
    booking_url: "",
    order_url: "",
    custom_link_label: "",
    custom_link_url: "",
    custom_instructions: "",
    business_hours: "",
    escalation_channel: "",
    reply_to_dms: true,
    reply_to_comments: true,
  });
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ text: string; tone: "ok" | "err" } | null>(null);

  function flash(text: string, tone: "ok" | "err") {
    setMsg({ text, tone });
    setTimeout(() => setMsg(null), 3500);
  }

  function set<K extends keyof typeof cfg>(k: K, v: typeof cfg[K]) {
    setCfg((prev) => ({ ...prev, [k]: v }));
  }

  async function save() {
    setSaving(true);
    const res = await fetch(`/api/admin/clients/${clientId}/social-config`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(cfg),
    });
    setSaving(false);
    if (res.ok) flash("Saved", "ok");
    else flash("Save failed", "err");
  }

  return (
    <div className="admin-card">
      <div className="admin-card-head">
        <h2>Maya (Meta)</h2>
        {subscriptions.length > 0 && (
          <span style={{ fontSize: 11, color: "var(--text-mute)", fontFamily: "var(--mono)" }}>
            {subscriptions.length} page{subscriptions.length === 1 ? "" : "s"} connected
          </span>
        )}
      </div>

      {subscriptions.length === 0 ? (
        <div className="admin-empty" style={{ padding: 12 }}>
          No Meta pages connected.{" "}
          <a href={`/api/meta/install?clientId=${clientId}`} className="at-link">Install Meta workspace →</a>
        </div>
      ) : (
        <div style={{ marginBottom: 16 }}>
          {subscriptions.map((s) => (
            <div key={s.page_id} className="cm-row" style={{ alignItems: "baseline" }}>
              <span>
                <strong>{s.page_name}</strong>
                {s.instagram_username && (
                  <span style={{ fontSize: 11, color: "var(--text-mute)", marginLeft: 8, fontFamily: "var(--mono)" }}>
                    / @{s.instagram_username}
                  </span>
                )}
              </span>
              <span style={{ fontSize: 11, color: s.active ? "var(--sage)" : "var(--text-mute)", fontFamily: "var(--mono)" }}>
                {s.active ? "Active" : "Paused"}
              </span>
            </div>
          ))}
          <div style={{ marginTop: 8 }}>
            <a href={`/api/meta/install?clientId=${clientId}`} className="at-link">+ Add another Meta workspace</a>
          </div>
        </div>
      )}

      <div className="admin-input-row">
        <label>Website URL <span style={{ color: "var(--text-mute)", fontWeight: 400 }}>(general inquiries)</span></label>
        <input className="admin-input" style={{ marginBottom: 0 }} type="url" placeholder="https://example.com" value={cfg.website_url ?? ""} onChange={(e) => set("website_url", e.target.value)} />
      </div>
      <div className="admin-input-row" style={{ marginTop: 8 }}>
        <label>Booking URL <span style={{ color: "var(--text-mute)", fontWeight: 400 }}>(appointments)</span></label>
        <input className="admin-input" style={{ marginBottom: 0 }} type="url" placeholder="https://calendly.com/..." value={cfg.booking_url ?? ""} onChange={(e) => set("booking_url", e.target.value)} />
      </div>
      <div className="admin-input-row" style={{ marginTop: 8 }}>
        <label>Order / pricing URL</label>
        <input className="admin-input" style={{ marginBottom: 0 }} type="url" placeholder="https://example.com/order" value={cfg.order_url ?? ""} onChange={(e) => set("order_url", e.target.value)} />
      </div>
      <div className="admin-input-row" style={{ marginTop: 8, display: "grid", gridTemplateColumns: "1fr 2fr", gap: 8 }}>
        <div>
          <label>Custom link label</label>
          <input className="admin-input" style={{ marginBottom: 0 }} placeholder="Portfolio" value={cfg.custom_link_label ?? ""} onChange={(e) => set("custom_link_label", e.target.value)} />
        </div>
        <div>
          <label>Custom link URL</label>
          <input className="admin-input" style={{ marginBottom: 0 }} type="url" placeholder="https://..." value={cfg.custom_link_url ?? ""} onChange={(e) => set("custom_link_url", e.target.value)} />
        </div>
      </div>
      <div className="admin-input-row" style={{ marginTop: 8 }}>
        <label>Business hours <span style={{ color: "var(--text-mute)", fontWeight: 400 }}>(used in replies)</span></label>
        <BusinessHoursPicker value={cfg.business_hours ?? ""} onChange={(v) => set("business_hours", v)} />
      </div>
      <div className="admin-input-row" style={{ marginTop: 8 }}>
        <label>Brand voice / extra instructions</label>
        <textarea className="admin-textarea" rows={3} placeholder="Tone, never-say words, signature phrases, etc." value={cfg.custom_instructions ?? ""} onChange={(e) => set("custom_instructions", e.target.value)} />
      </div>
      <div className="admin-input-row" style={{ marginTop: 8 }}>
        <label>Escalation Slack channel ID <span style={{ color: "var(--text-mute)", fontWeight: 400 }}>(e.g. C0123ABCD)</span></label>
        <input className="admin-input" style={{ marginBottom: 0, fontFamily: "var(--mono)", fontSize: 12 }} placeholder="C0123ABCD" value={cfg.escalation_channel ?? ""} onChange={(e) => set("escalation_channel", e.target.value)} />
      </div>

      <div style={{ display: "flex", gap: 14, marginTop: 16, fontSize: 13 }}>
        <label style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
          <input type="checkbox" checked={cfg.reply_to_dms} onChange={(e) => set("reply_to_dms", e.target.checked)} />
          <span>Reply to DMs</span>
        </label>
        <label style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
          <input type="checkbox" checked={cfg.reply_to_comments} onChange={(e) => set("reply_to_comments", e.target.checked)} />
          <span>Reply to comments</span>
        </label>
      </div>

      <div style={{ display: "flex", gap: 8, marginTop: 16, alignItems: "center" }}>
        <button className="admin-btn admin-btn-sm" onClick={save} disabled={saving}>{saving ? "Saving…" : "Save"}</button>
        {msg && (
          <span style={{ fontSize: 12, fontFamily: "var(--mono)", color: msg.tone === "ok" ? "var(--sage)" : "var(--red)" }}>
            {msg.text}
          </span>
        )}
      </div>
    </div>
  );
}
