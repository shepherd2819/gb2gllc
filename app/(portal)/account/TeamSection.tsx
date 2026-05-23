"use client";
import { useState } from "react";

type Member = {
  id: string;
  email: string;
  invited_at: string;
  joined_at: string | null;
};

type Props = {
  isOwner: boolean;
  ownerEmail: string;
  initialMembers: Member[];
};

const MAX_TEAMMATES = 1;

export function TeamSection({ isOwner, ownerEmail, initialMembers }: Props) {
  const [members, setMembers] = useState(initialMembers);
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ text: string; tone: "ok" | "err" } | null>(null);

  const atCap = members.length >= MAX_TEAMMATES;

  function flash(text: string, tone: "ok" | "err") {
    setMsg({ text, tone });
    setTimeout(() => setMsg(null), 4000);
  }

  async function invite(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim()) return;
    setBusy(true);
    const res = await fetch("/api/portal/team", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    });
    const data = await res.json();
    setBusy(false);
    if (res.ok) {
      setMembers((prev) => [...prev, data.member]);
      setEmail("");
      flash(`Invitation sent to ${data.member.email}`, "ok");
    } else {
      flash(data.error || "Failed to invite", "err");
    }
  }

  async function remove(member: Member) {
    if (!confirm(`Remove ${member.email}? They'll lose access to this portal.`)) return;
    setRemoving(member.id);
    const res = await fetch(`/api/portal/team?memberId=${member.id}`, { method: "DELETE" });
    setRemoving(null);
    if (res.ok) {
      setMembers((prev) => prev.filter((m) => m.id !== member.id));
      flash(`Removed ${member.email}`, "ok");
    } else {
      flash("Failed to remove", "err");
    }
  }

  return (
    <div className="account-edit-card">
      <div className="ae-row" style={{ marginBottom: 12 }}>
        <span className="ae-label">Account owner</span>
        <span style={{ fontSize: 13 }}>{ownerEmail}</span>
      </div>

      {members.length > 0 && (
        <>
          <div className="ae-label" style={{ marginBottom: 8 }}>Teammates</div>
          {members.map((m) => (
            <div
              key={m.id}
              className="ae-row"
              style={{ marginBottom: 8, paddingBottom: 8, borderBottom: "1px solid rgba(28,30,27,0.06)" }}
            >
              <div style={{ display: "flex", flexDirection: "column" }}>
                <span style={{ fontSize: 13 }}>{m.email}</span>
                <span style={{ fontSize: 11, color: "var(--text-mute, #8A8C85)", fontFamily: "var(--mono, monospace)" }}>
                  {m.joined_at
                    ? `Joined ${new Date(m.joined_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`
                    : `Invited ${new Date(m.invited_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })} · pending`}
                </span>
              </div>
              {isOwner && (
                <button
                  onClick={() => remove(m)}
                  disabled={removing === m.id}
                  className="ae-save"
                  style={{
                    background: "transparent",
                    color: "var(--red)",
                    border: "1px solid var(--red)",
                    fontSize: 12,
                    padding: "6px 12px",
                  }}
                >
                  {removing === m.id ? "Removing…" : "Remove"}
                </button>
              )}
            </div>
          ))}
        </>
      )}

      {isOwner ? (
        atCap ? (
          <p style={{ fontSize: 12, color: "var(--text-mute, #8A8C85)", marginTop: 8 }}>
            You&apos;re at the {MAX_TEAMMATES}-teammate limit. Remove someone to invite another.
          </p>
        ) : (
          <form onSubmit={invite} style={{ marginTop: members.length > 0 ? 16 : 0 }}>
            <div className="ae-label" style={{ marginBottom: 6 }}>Invite a teammate</div>
            <div style={{ display: "flex", gap: 8 }}>
              <input
                type="email"
                className="ae-input"
                placeholder="teammate@company.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                style={{ flex: 1 }}
              />
              <button type="submit" className="ae-save" disabled={busy || !email.trim()}>
                {busy ? "Sending…" : "Send invite"}
              </button>
            </div>
            <p style={{ fontSize: 11, color: "var(--text-mute, #8A8C85)", marginTop: 6 }}>
              They&apos;ll get an email to set up their password. You can invite {MAX_TEAMMATES} teammate on this plan.
            </p>
          </form>
        )
      ) : (
        <p style={{ fontSize: 12, color: "var(--text-mute, #8A8C85)", marginTop: 8 }}>
          Only the account owner can invite or remove teammates.
        </p>
      )}

      {msg && (
        <div className={`ae-msg ${msg.tone === "ok" ? "ae-ok" : "ae-err"}`} style={{ marginTop: 12 }}>
          {msg.text}
        </div>
      )}
    </div>
  );
}
