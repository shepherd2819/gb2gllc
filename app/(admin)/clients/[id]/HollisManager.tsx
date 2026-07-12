"use client";
import { useState } from "react";

type Line = {
  id: string;
  phone_number: string | null;
  status: "provisioning" | "active" | "paused" | "released";
  voice_profile: "female" | "male";
  agent_name: string;
  greeting_override: string | null;
  escalation_number: string | null;
  booking_mode: "email" | "crm" | "both";
  booking_email: string | null;
  recording_enabled: boolean;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  persona: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  hours: any;
  services: string[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  crm_config: any;
  order_ops_enabled?: boolean;
  spiro_source_id?: string | null;
  slack_channel_id?: string | null;
};

type Call = {
  id: string;
  outcome: string;
  duration_ms: number | null;
  caller_number: string | null;
  created_at: string;
};

type Faq = { question: string; answer: string };

type Props = {
  clientId: string;
  initialLine: Line | null;
  calls: Call[];
  faq: Faq[];
  spiroSources?: { id: string; label: string }[];
};

const VOICES: { value: "female" | "male"; label: string }[] = [
  { value: "female", label: "Female voice" },
  { value: "male", label: "Male voice" },
];

export function HollisManager({ clientId, initialLine, calls, faq, spiroSources }: Props) {
  const [line, setLine] = useState<Line | null>(initialLine);
  const [provisioning, setProvisioning] = useState(false);
  const [savingCfg, setSavingCfg] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; tone: "ok" | "err" } | null>(null);

  const [voiceProfile, setVoiceProfile] = useState<"female" | "male">(initialLine?.voice_profile ?? "female");
  const [agentName, setAgentName] = useState(initialLine?.agent_name ?? "");
  const [greeting, setGreeting] = useState(initialLine?.greeting_override ?? "");
  const [services, setServices] = useState((initialLine?.services ?? []).join(", "));
  const [hoursNote, setHoursNote] = useState((initialLine?.hours?.note as string) ?? "");
  const [personaNote, setPersonaNote] = useState((initialLine?.persona?.notes as string) ?? "");
  const [escalation, setEscalation] = useState(initialLine?.escalation_number ?? "");
  const [bookingEmail, setBookingEmail] = useState(initialLine?.booking_email ?? "");
  const [bookingMode, setBookingMode] = useState<"email" | "crm" | "both">(initialLine?.booking_mode ?? "email");
  const [crmUrl, setCrmUrl] = useState((initialLine?.crm_config?.webhook_url as string) ?? "");
  const [recording, setRecording] = useState(initialLine?.recording_enabled ?? true);
  const [orderOpsEnabled, setOrderOpsEnabled] = useState<boolean>(initialLine?.order_ops_enabled ?? false);
  const [spiroSourceId, setSpiroSourceId] = useState<string>(initialLine?.spiro_source_id ?? "");
  const [slackChannelId, setSlackChannelId] = useState<string>(initialLine?.slack_channel_id ?? "");
  const [faqRows, setFaqRows] = useState<Faq[]>(faq.length ? faq : [{ question: "", answer: "" }]);

  function flash(text: string, tone: "ok" | "err") {
    setMsg({ text, tone });
    setTimeout(() => setMsg(null), 4000);
  }

  async function provision() {
    setProvisioning(true);
    const res = await fetch(`/api/admin/clients/${clientId}/hollis/provision`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ voice_profile: voiceProfile }),
    });
    const data = await res.json();
    setProvisioning(false);
    if (res.ok) {
      flash(`Provisioned ${data.phone_number_pretty ?? data.phone_number}`, "ok");
      location.reload();
    } else {
      flash(data.error || "Provisioning failed", "err");
    }
  }

  async function saveCfg() {
    setSavingCfg(true);
    const res = await fetch(`/api/admin/clients/${clientId}/hollis/config`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        voice_profile: voiceProfile,
        agent_name: agentName,
        greeting_override: greeting,
        services: services.split(/[,\n]/).map((s) => s.trim()).filter(Boolean),
        hours: { note: hoursNote },
        persona: { notes: personaNote },
        escalation_number: escalation,
        booking_email: bookingEmail,
        booking_mode: bookingMode,
        crm_config: { webhook_url: crmUrl },
        recording_enabled: recording,
        order_ops_enabled: orderOpsEnabled,
        spiro_source_id: spiroSourceId || null,
        slack_channel_id: slackChannelId || null,
        faq: faqRows.filter((f) => f.question.trim() && f.answer.trim()),
      }),
    });
    setSavingCfg(false);
    flash(res.ok ? "Saved" : "Save failed", res.ok ? "ok" : "err");
  }

  async function lineAction(action: "pause" | "resume" | "release") {
    if (action === "release" && !confirm("Release this number? The client will stop receiving AI-answered calls.")) return;
    if (!line) return;
    setBusy(true);
    const res = await fetch(`/api/admin/clients/${clientId}/hollis/lines/${line.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action }),
    });
    const data = await res.json();
    setBusy(false);
    if (res.ok) {
      setLine({ ...line, status: data.status });
      flash(`Line ${data.status}`, "ok");
    } else {
      flash(data.error || "Failed", "err");
    }
  }

  return (
    <div className="admin-card">
      <div className="admin-card-head">
        <h2>Hollis (AI phone receptionist)</h2>
        {line?.phone_number && (
          <span style={{ fontSize: 11, color: "var(--text-mute)", fontFamily: "var(--mono)" }}>
            {line.phone_number} · {line.status}
          </span>
        )}
      </div>

      {!line ? (
        <div className="admin-empty" style={{ padding: 12 }}>
          No phone line yet. Pick a voice and provision a number to start.
          <div style={{ display: "flex", gap: 8, marginTop: 10, alignItems: "center" }}>
            <select className="admin-select" style={{ marginBottom: 0, maxWidth: 160 }} value={voiceProfile} onChange={(e) => setVoiceProfile(e.target.value as "female" | "male")}>
              {VOICES.map((v) => <option key={v.value} value={v.value}>{v.label}</option>)}
            </select>
            <button className="admin-btn admin-btn-sm" onClick={provision} disabled={provisioning}>
              {provisioning ? "Provisioning…" : "Provision a number"}
            </button>
          </div>
        </div>
      ) : (
        <>
          {/* ── Line controls ─────────────────────────────────────────── */}
          <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
            {line.status === "active" && <button className="admin-btn-ghost admin-btn-sm" onClick={() => lineAction("pause")} disabled={busy}>Pause</button>}
            {line.status === "paused" && <button className="admin-btn admin-btn-sm" onClick={() => lineAction("resume")} disabled={busy}>Resume</button>}
            <button className="admin-btn-ghost admin-btn-sm" style={{ color: "var(--red)", borderColor: "rgba(196,82,75,0.4)" }} onClick={() => lineAction("release")} disabled={busy}>Release number</button>
          </div>

          {/* ── Voice + name ──────────────────────────────────────────── */}
          <div className="admin-input-row" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div>
              <label>Voice</label>
              <select className="admin-select" style={{ marginBottom: 0 }} value={voiceProfile} onChange={(e) => setVoiceProfile(e.target.value as "female" | "male")}>
                {VOICES.map((v) => <option key={v.value} value={v.value}>{v.label}</option>)}
              </select>
            </div>
            <div>
              <label>Agent name (what callers hear)</label>
              <input className="admin-input" style={{ marginBottom: 0 }} value={agentName} onChange={(e) => setAgentName(e.target.value)} placeholder="Ava" />
            </div>
          </div>

          <div className="admin-input-row" style={{ marginTop: 12 }}>
            <label>Greeting override <span style={{ color: "var(--text-mute)", fontWeight: 400 }}>(optional — AI + recording disclosure is always appended)</span></label>
            <input className="admin-input" style={{ marginBottom: 0 }} value={greeting} onChange={(e) => setGreeting(e.target.value)} placeholder="Thanks for calling BrightLens Media!" />
          </div>

          <div className="admin-input-row" style={{ marginTop: 12 }}>
            <label>Services <span style={{ color: "var(--text-mute)", fontWeight: 400 }}>(comma-separated)</span></label>
            <input className="admin-input" style={{ marginBottom: 0 }} value={services} onChange={(e) => setServices(e.target.value)} placeholder="Listing photos, Video tours, Drone, 3D tours" />
          </div>

          <div className="admin-input-row" style={{ marginTop: 12, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div>
              <label>Hours</label>
              <input className="admin-input" style={{ marginBottom: 0 }} value={hoursNote} onChange={(e) => setHoursNote(e.target.value)} placeholder="Mon–Sat 8am–6pm" />
            </div>
            <div>
              <label>Transfer-to-human number</label>
              <input className="admin-input" style={{ marginBottom: 0, fontFamily: "var(--mono)" }} value={escalation} onChange={(e) => setEscalation(e.target.value)} placeholder="+18315551234" />
            </div>
          </div>

          <div className="admin-input-row" style={{ marginTop: 12 }}>
            <label>Persona notes <span style={{ color: "var(--text-mute)", fontWeight: 400 }}>(tone, do/don't)</span></label>
            <textarea className="admin-textarea" rows={2} value={personaNote} onChange={(e) => setPersonaNote(e.target.value)} placeholder="Warm, upbeat, professional. Never quote prices over $X — take a message." />
          </div>

          {/* ── Booking delivery ──────────────────────────────────────── */}
          <div className="admin-input-row" style={{ marginTop: 12, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div>
              <label>Delivery</label>
              <select className="admin-select" style={{ marginBottom: 0 }} value={bookingMode} onChange={(e) => setBookingMode(e.target.value as "email" | "crm" | "both")}>
                <option value="email">Email only</option>
                <option value="crm">CRM only</option>
                <option value="both">Email + CRM</option>
              </select>
            </div>
            <div>
              <label>Booking email</label>
              <input className="admin-input" style={{ marginBottom: 0 }} value={bookingEmail} onChange={(e) => setBookingEmail(e.target.value)} placeholder="bookings@studio.com" />
            </div>
          </div>

          {(bookingMode === "crm" || bookingMode === "both") && (
            <div className="admin-input-row" style={{ marginTop: 12 }}>
              <label>CRM webhook URL</label>
              <input className="admin-input" style={{ marginBottom: 0, fontFamily: "var(--mono)", fontSize: 12 }} value={crmUrl} onChange={(e) => setCrmUrl(e.target.value)} placeholder="https://hooks.zapier.com/…" />
            </div>
          )}

          <label style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 12, fontSize: 13, cursor: "pointer" }}>
            <input type="checkbox" checked={recording} onChange={(e) => setRecording(e.target.checked)} />
            <span>Record calls (announces &quot;this call may be recorded&quot;)</span>
          </label>

          {/* ── Order desk ────────────────────────────────────────────── */}
          <div className="admin-card-head" style={{ marginTop: 24, marginBottom: 8, borderTop: "1px solid var(--rule, rgba(28,30,27,0.1))", paddingTop: 16 }}>
            <h2 style={{ fontSize: 14 }}>Order desk (Spiro + Slack)</h2>
          </div>
          <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, cursor: "pointer" }}>
            <input type="checkbox" checked={orderOpsEnabled} onChange={(e) => setOrderOpsEnabled(e.target.checked)} />
            <span>Enable order lookup + change requests</span>
          </label>

          <div className="admin-input-row" style={{ marginTop: 12, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div>
              <label>Spiro source</label>
              <select className="admin-select" style={{ marginBottom: 0 }} value={spiroSourceId} onChange={(e) => setSpiroSourceId(e.target.value)}>
                <option value="">— none —</option>
                {(spiroSources ?? []).map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
              </select>
            </div>
            <div>
              <label>Slack channel ID</label>
              <input className="admin-input" style={{ marginBottom: 0, fontFamily: "var(--mono)" }} value={slackChannelId} onChange={(e) => setSlackChannelId(e.target.value)} placeholder="C0123456789" />
            </div>
          </div>

          <p style={{ marginTop: 8, fontSize: 12, color: "var(--text-mute)" }}>
            Live-transfer number: {escalation ? `set (${escalation})` : "⚠ not set — set the transfer-to-human number above"}
          </p>

          {/* ── FAQ ───────────────────────────────────────────────────── */}
          <div className="admin-card-head" style={{ marginTop: 24, marginBottom: 8, borderTop: "1px solid var(--rule, rgba(28,30,27,0.1))", paddingTop: 16 }}>
            <h2 style={{ fontSize: 14 }}>Knowledge base · {faqRows.length}</h2>
          </div>
          {faqRows.map((f, i) => (
            <div key={i} style={{ display: "grid", gridTemplateColumns: "1fr 1.4fr auto", gap: 8, marginBottom: 8 }}>
              <input className="admin-input" style={{ marginBottom: 0, fontSize: 12 }} value={f.question} placeholder="Question" onChange={(e) => setFaqRows((rows) => rows.map((r, j) => (j === i ? { ...r, question: e.target.value } : r)))} />
              <input className="admin-input" style={{ marginBottom: 0, fontSize: 12 }} value={f.answer} placeholder="Answer" onChange={(e) => setFaqRows((rows) => rows.map((r, j) => (j === i ? { ...r, answer: e.target.value } : r)))} />
              <button className="admin-btn-ghost admin-btn-sm" onClick={() => setFaqRows((rows) => rows.filter((_, j) => j !== i))}>✕</button>
            </div>
          ))}
          <button className="admin-btn-ghost admin-btn-sm" onClick={() => setFaqRows((rows) => [...rows, { question: "", answer: "" }])}>+ Add FAQ</button>

          <div style={{ display: "flex", gap: 8, marginTop: 16, alignItems: "center" }}>
            <button className="admin-btn admin-btn-sm" onClick={saveCfg} disabled={savingCfg}>{savingCfg ? "Saving…" : "Save config"}</button>
            {msg && <span style={{ fontSize: 12, fontFamily: "var(--mono)", color: msg.tone === "ok" ? "var(--sage)" : "var(--red)" }}>{msg.text}</span>}
          </div>

          {/* ── Recent calls ──────────────────────────────────────────── */}
          {calls.length > 0 && (
            <>
              <div className="admin-card-head" style={{ marginTop: 24, marginBottom: 8, borderTop: "1px solid var(--rule, rgba(28,30,27,0.1))", paddingTop: 16 }}>
                <h2 style={{ fontSize: 14 }}>Recent calls · {calls.length}</h2>
              </div>
              {calls.slice(0, 10).map((c) => (
                <div key={c.id} style={{ display: "flex", justifyContent: "space-between", padding: "8px 0", borderBottom: "1px solid var(--rule, rgba(28,30,27,0.06))", fontSize: 13 }}>
                  <span style={{ fontFamily: "var(--mono)", fontSize: 12 }}>{c.caller_number ?? "unknown"}</span>
                  <span>{c.outcome.replace(/_/g, " ")}</span>
                  <span style={{ color: "var(--text-mute)", fontSize: 12 }}>
                    {c.duration_ms ? `${Math.round(c.duration_ms / 1000)}s` : "—"} · {new Date(c.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                  </span>
                </div>
              ))}
            </>
          )}
        </>
      )}

      {!line && msg && (
        <span style={{ fontSize: 12, fontFamily: "var(--mono)", color: msg.tone === "ok" ? "var(--sage)" : "var(--red)", display: "block", marginTop: 8 }}>{msg.text}</span>
      )}
    </div>
  );
}
