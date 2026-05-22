"use client";
import { useState } from "react";

type Props = {
  name: string | null;
  company: string | null;
  email: string;
};

export function AccountForm({ name, company, email }: Props) {
  const [profile, setProfile] = useState({ name: name ?? "", company: company ?? "", email });
  const [profileMsg, setProfileMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [profileSaving, setProfileSaving] = useState(false);

  const [password, setPassword] = useState({ newPassword: "", confirm: "" });
  const [passwordMsg, setPasswordMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [passwordSaving, setPasswordSaving] = useState(false);

  async function saveProfile(e: React.FormEvent) {
    e.preventDefault();
    setProfileSaving(true);
    setProfileMsg(null);
    try {
      const res = await fetch("/api/portal/account", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: profile.name, company: profile.company, email: profile.email }),
      });
      const data = await res.json();
      if (!res.ok) setProfileMsg({ ok: false, text: data.error ?? "Something went wrong." });
      else setProfileMsg({ ok: true, text: "Profile updated." });
    } catch {
      setProfileMsg({ ok: false, text: "Network error." });
    } finally {
      setProfileSaving(false);
    }
  }

  async function savePassword(e: React.FormEvent) {
    e.preventDefault();
    if (password.newPassword !== password.confirm) {
      setPasswordMsg({ ok: false, text: "Passwords don't match." });
      return;
    }
    if (password.newPassword.length < 8) {
      setPasswordMsg({ ok: false, text: "Password must be at least 8 characters." });
      return;
    }
    setPasswordSaving(true);
    setPasswordMsg(null);
    try {
      const res = await fetch("/api/portal/account", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: password.newPassword }),
      });
      const data = await res.json();
      if (!res.ok) setPasswordMsg({ ok: false, text: data.error ?? "Something went wrong." });
      else {
        setPasswordMsg({ ok: true, text: "Password updated." });
        setPassword({ newPassword: "", confirm: "" });
      }
    } catch {
      setPasswordMsg({ ok: false, text: "Network error." });
    } finally {
      setPasswordSaving(false);
    }
  }

  return (
    <>
      <form className="account-edit-card" onSubmit={saveProfile}>
        <div className="ae-row">
          <label className="ae-label" htmlFor="ae-name">Name</label>
          <input
            id="ae-name"
            className="ae-input"
            value={profile.name}
            onChange={e => setProfile(p => ({ ...p, name: e.target.value }))}
            placeholder="Your name"
          />
        </div>
        <div className="ae-row">
          <label className="ae-label" htmlFor="ae-company">Company</label>
          <input
            id="ae-company"
            className="ae-input"
            value={profile.company}
            onChange={e => setProfile(p => ({ ...p, company: e.target.value }))}
            placeholder="Company name"
          />
        </div>
        <div className="ae-row">
          <label className="ae-label" htmlFor="ae-email">Email</label>
          <input
            id="ae-email"
            className="ae-input"
            type="email"
            value={profile.email}
            onChange={e => setProfile(p => ({ ...p, email: e.target.value }))}
            placeholder="you@example.com"
          />
        </div>
        <div className="ae-footer">
          {profileMsg && (
            <span className={profileMsg.ok ? "ae-msg ae-ok" : "ae-msg ae-err"}>{profileMsg.text}</span>
          )}
          <button className="ae-save" type="submit" disabled={profileSaving}>
            {profileSaving ? "Saving…" : "Save changes"}
          </button>
        </div>
      </form>

      <div className="account-section-title">Password</div>
      <form className="account-edit-card" onSubmit={savePassword}>
        <div className="ae-row">
          <label className="ae-label" htmlFor="ae-pw">New password</label>
          <input
            id="ae-pw"
            className="ae-input"
            type="password"
            value={password.newPassword}
            onChange={e => setPassword(p => ({ ...p, newPassword: e.target.value }))}
            placeholder="At least 8 characters"
            autoComplete="new-password"
          />
        </div>
        <div className="ae-row">
          <label className="ae-label" htmlFor="ae-pw2">Confirm</label>
          <input
            id="ae-pw2"
            className="ae-input"
            type="password"
            value={password.confirm}
            onChange={e => setPassword(p => ({ ...p, confirm: e.target.value }))}
            placeholder="Repeat new password"
            autoComplete="new-password"
          />
        </div>
        <div className="ae-footer">
          {passwordMsg && (
            <span className={passwordMsg.ok ? "ae-msg ae-ok" : "ae-msg ae-err"}>{passwordMsg.text}</span>
          )}
          <button className="ae-save" type="submit" disabled={passwordSaving}>
            {passwordSaving ? "Updating…" : "Update password"}
          </button>
        </div>
      </form>
    </>
  );
}
