"use client";

import { useState, useEffect } from "react";

export function SignForm({ token, defaultRepresenting }: { token: string; defaultRepresenting: string }) {
  const [name, setName] = useState("");
  const [representing, setRepresenting] = useState(defaultRepresenting);
  const [agree, setAgree] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  // Best-effort viewed-at
  useEffect(() => {
    fetch(`/api/sign/${token}`, { method: "PATCH" }).catch(() => { /* non-critical */ });
  }, [token]);

  if (done) {
    return (
      <div className="sign-success">
        <h2>Signed.</h2>
        <p>Check your inbox for a copy. Welcome.</p>
      </div>
    );
  }

  const canSubmit = name.trim().length > 0 && representing.trim().length > 0 && agree && !submitting;

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch(`/api/sign/${token}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ signer_name: name.trim(), signer_representing: representing.trim(), agree }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        setError(j.error || `Sign failed (${res.status})`);
        setSubmitting(false);
        return;
      }
      setDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error");
      setSubmitting(false);
    }
  };

  return (
    <form className="sign-form" onSubmit={onSubmit}>
      <h3>Sign here</h3>
      <label>
        Your full name
        <input type="text" required value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" />
      </label>
      <label>
        You are signing as (your name and title or role)
        <input type="text" required value={representing} onChange={(e) => setRepresenting(e.target.value)} />
      </label>
      <label className="check">
        <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} />
        <span>I confirm I have full legal authority to sign this Agreement on behalf of the company named above, and I agree to its terms.</span>
      </label>
      <button type="submit" disabled={!canSubmit}>{submitting ? "Signing…" : "Sign contract"}</button>
      {error && <div className="sign-error">{error}</div>}
    </form>
  );
}
