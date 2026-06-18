import { withAuth } from "@workos-inc/authkit-nextjs";
import { redirect, notFound } from "next/navigation";
import { supabaseAdmin } from "@/lib/supabase";

export const dynamic = "force-dynamic";

const ADMIN_EMAIL = process.env.ADMIN_EMAIL ?? "john@gb2gllc.com";

type Params = { params: Promise<{ callId: string }> };

type TranscriptTurn = { role?: string; content?: string; text?: string };

export default async function HollisCallDetail({ params }: Params) {
  const { user } = await withAuth();
  if (!user) redirect("/auth/signin");
  if (user.email !== ADMIN_EMAIL) redirect("/auth/no-account");

  const { callId } = await params;
  const { data: call } = await supabaseAdmin
    .from("hollis_calls")
    .select("*, clients(name, company)")
    .eq("id", callId)
    .maybeSingle();
  if (!call) notFound();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const c = call as any;
  const client = c.clients as { name: string | null; company: string | null } | null;
  const transcript = c.transcript;
  const turns: TranscriptTurn[] = Array.isArray(transcript) ? transcript : [];

  return (
    <>
      <div className="page-header">
        <a href="/agents/hollis" className="back-link">← All calls</a>
        <h1 className="page-title">{client?.company || client?.name || "Call"}</h1>
        <p className="page-sub">
          {c.caller_number ?? "unknown caller"} · {c.outcome.replace(/_/g, " ")} ·{" "}
          {c.duration_ms ? `${Math.round(c.duration_ms / 1000)}s` : "—"} ·{" "}
          {new Date(c.created_at).toLocaleString()}
        </p>
      </div>

      <div className="admin-card" style={{ marginBottom: 16 }}>
        <div className="admin-card-head"><h2 style={{ fontSize: 14 }}>Summary</h2></div>
        <dl style={{ fontSize: 13, display: "grid", gridTemplateColumns: "auto 1fr", gap: "6px 16px" }}>
          <dt style={{ color: "var(--text-mute)" }}>Outcome</dt><dd>{c.outcome.replace(/_/g, " ")}</dd>
          <dt style={{ color: "var(--text-mute)" }}>AI disclosed</dt><dd>{c.disclosure_at ? new Date(c.disclosure_at).toLocaleString() : "—"}</dd>
          <dt style={{ color: "var(--text-mute)" }}>Recording consent</dt><dd>{c.recording_consent_at ? new Date(c.recording_consent_at).toLocaleString() : "not recorded"}</dd>
          <dt style={{ color: "var(--text-mute)" }}>Ticket</dt><dd>{c.ticket_id ? <a href={`/support`}>{String(c.ticket_id).slice(0, 8)}</a> : "—"}</dd>
        </dl>
        {c.recording_url && (
          <audio controls src={c.recording_url} style={{ width: "100%", marginTop: 12 }}>
            <track kind="captions" />
          </audio>
        )}
      </div>

      {c.captured && Object.keys(c.captured).length > 1 && (
        <div className="admin-card" style={{ marginBottom: 16 }}>
          <div className="admin-card-head"><h2 style={{ fontSize: 14 }}>Captured</h2></div>
          <pre style={{ whiteSpace: "pre-wrap", fontSize: 12, fontFamily: "var(--mono)", margin: 0 }}>
            {JSON.stringify(c.captured, null, 2)}
          </pre>
        </div>
      )}

      <div className="admin-card">
        <div className="admin-card-head"><h2 style={{ fontSize: 14 }}>Transcript</h2></div>
        {turns.length === 0 ? (
          <p className="muted" style={{ fontSize: 13 }}>
            {typeof transcript === "string" && transcript ? transcript : "No transcript available."}
          </p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8, fontSize: 13 }}>
            {turns.map((t, i) => (
              <div key={i}>
                <span style={{ fontSize: 10, fontFamily: "var(--mono)", textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--text-mute)" }}>
                  {t.role ?? "—"}
                </span>
                <div style={{ lineHeight: 1.5 }}>{t.content ?? t.text ?? ""}</div>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
