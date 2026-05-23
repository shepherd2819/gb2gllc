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
    <div className="team-card">
      <div className="team-section">
        <div className="team-row">
          <div className="team-row-main">
            <div className="team-email">{ownerEmail}</div>
            <div className="team-meta">Account owner</div>
          </div>
        </div>

        {members.map((m) => (
          <div key={m.id} className="team-row">
            <div className="team-row-main">
              <div className="team-email">{m.email}</div>
              <div className="team-meta">
                {m.joined_at
                  ? `Teammate · joined ${new Date(m.joined_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`
                  : `Teammate · invited ${new Date(m.invited_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })} · pending sign-up`}
              </div>
            </div>
            {isOwner && (
              <button
                onClick={() => remove(m)}
                disabled={removing === m.id}
                className="team-remove-btn"
              >
                {removing === m.id ? "Removing…" : "Remove"}
              </button>
            )}
          </div>
        ))}
      </div>

      {isOwner ? (
        atCap ? (
          <div className="team-footer">
            <p className="team-hint">
              You&apos;re at the {MAX_TEAMMATES}-teammate limit on this plan. Remove someone to invite another.
            </p>
          </div>
        ) : (
          <form onSubmit={invite} className="team-invite">
            <label htmlFor="team-invite-email" className="team-invite-label">
              Invite a teammate
            </label>
            <div className="team-invite-row">
              <input
                id="team-invite-email"
                type="email"
                className="team-invite-input"
                placeholder="teammate@company.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
              <button type="submit" className="team-invite-btn" disabled={busy || !email.trim()}>
                {busy ? "Sending…" : "Send invite"}
              </button>
            </div>
            <p className="team-hint">
              They&apos;ll get an email to set up their password and join your portal. You can invite {MAX_TEAMMATES} teammate on this plan.
            </p>
          </form>
        )
      ) : (
        <div className="team-footer">
          <p className="team-hint">Only the account owner can invite or remove teammates.</p>
        </div>
      )}

      {msg && (
        <div className={`team-msg ${msg.tone === "ok" ? "team-ok" : "team-err"}`}>
          {msg.text}
        </div>
      )}
    </div>
  );
}
