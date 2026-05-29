import { supabaseAdmin } from "@/lib/supabase";
import { HoltAccountsList } from "./HoltAccountsList";

export const dynamic = "force-dynamic";

type Account = {
  id: string;
  email_address: string;
  timezone: string | null;
  status: string;
  last_polled_at: string | null;
  last_poll_error: string | null;
  updated_at: string;
};

export default async function HoltIndexPage({ searchParams }: { searchParams: Promise<{ holt_install?: string }> }) {
  const sp = await searchParams;
  const banner = installBanner(sp.holt_install);

  const { data: accounts } = await supabaseAdmin
    .from("holt_accounts")
    .select("id, email_address, timezone, status, last_polled_at, last_poll_error, updated_at")
    .order("updated_at", { ascending: false });

  // Per-account "upcoming external" count for the next 24h
  const counts: Record<string, { upcoming: number; sent_today: number }> = {};
  const since24h = new Date(Date.now() - 24 * 3600_000).toISOString();
  const now = new Date().toISOString();
  const in24h = new Date(Date.now() + 24 * 3600_000).toISOString();
  for (const a of accounts ?? []) {
    const [{ count: upcoming }, { count: sentToday }] = await Promise.all([
      supabaseAdmin
        .from("holt_briefings")
        .select("id", { count: "exact", head: true })
        .eq("account_id", a.id).eq("decision", "briefable")
        .gte("event_start_at", now).lt("event_start_at", in24h),
      supabaseAdmin
        .from("holt_briefings")
        .select("id", { count: "exact", head: true })
        .eq("account_id", a.id)
        .gte("prebrief_sent_at", since24h),
    ]);
    counts[a.id] = { upcoming: upcoming ?? 0, sent_today: sentToday ?? 0 };
  }

  return (
    <>
      <div className="admin-page-header">
        <div>
          <h1>🗓️ Holt · Meeting prep</h1>
          <span className="client-email">
            Internal agent. Reads your Google Calendar (read-only), researches external attendees,
            and emails you a one-page briefing the night before + 2 hours before each external meeting.
          </span>
        </div>
      </div>

      {banner && (
        <div className="admin-card" style={{ padding: 14, marginBottom: 16, background: banner.tone === "ok" ? "var(--green-soft, rgba(60,140,90,0.08))" : "var(--red-soft, rgba(190,80,80,0.08))" }}>
          {banner.text}
        </div>
      )}

      <HoltAccountsList initial={(accounts ?? []) as Account[]} counts={counts} />
    </>
  );
}

function installBanner(p: string | undefined): { tone: "ok" | "err"; text: string } | null {
  if (!p) return null;
  if (p === "connected") return { tone: "ok", text: "Calendar connected. First scan runs within ~15 minutes — or hit 'Run now' below to trigger immediately." };
  const map: Record<string, string> = {
    missing_code:     "Google didn't return an auth code. Try again.",
    state_mismatch:   "Auth flow cookie didn't match. Try again from this page.",
    bad_state:        "Bad install state. Try again.",
    no_refresh_token: "Google didn't issue a refresh token. Open Google Account → Security → Third-party access, remove the GB2G entry, then click Connect again so Google forces a consent screen.",
    exchange_failed:  "Token exchange with Google failed. Check GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET and that the redirect URI is whitelisted.",
    save_failed:      "Got tokens from Google but failed to save the connection. Check server logs.",
  };
  return { tone: "err", text: map[p] ?? `Install error: ${p}` };
}
