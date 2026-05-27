import { supabaseAdmin } from "@/lib/supabase";
import { IrisAccountsList } from "./IrisAccountsList";

export const dynamic = "force-dynamic";

type Account = {
  id: string;
  email_address: string;
  aliases: string[];
  status: string;
  last_polled_at: string | null;
  last_poll_error: string | null;
  updated_at: string;
};

export default async function IrisIndexPage({ searchParams }: { searchParams: Promise<{ iris_install?: string }> }) {
  const sp = await searchParams;
  const banner = installBanner(sp.iris_install);

  const { data: accounts } = await supabaseAdmin
    .from("iris_inbox_accounts")
    .select("id, email_address, aliases, status, last_polled_at, last_poll_error, updated_at")
    .order("updated_at", { ascending: false });

  // Per-account "pending review" count (classified but not yet sent/archived).
  const counts: Record<string, { pending: number }> = {};
  for (const a of accounts ?? []) {
    const { count } = await supabaseAdmin
      .from("iris_messages")
      .select("id", { count: "exact", head: true })
      .eq("account_id", a.id)
      .eq("status", "classified");
    counts[a.id] = { pending: count ?? 0 };
  }

  return (
    <>
      <div className="admin-page-header">
        <div>
          <h1>📥 Iris · Inbox manager</h1>
          <span className="client-email">
            Internal agent. Polls connected inboxes every 2 minutes, sorts each new email,
            and saves a draft reply in the thread. Drafts never auto-send.
          </span>
        </div>
      </div>

      {banner && (
        <div className={`admin-card`} style={{ padding: 14, marginBottom: 16, background: banner.tone === "ok" ? "var(--green-soft, rgba(60,140,90,0.08))" : "var(--red-soft, rgba(190,80,80,0.08))" }}>
          {banner.text}
        </div>
      )}

      <IrisAccountsList initial={(accounts ?? []) as Account[]} counts={counts} />
    </>
  );
}

function installBanner(p: string | undefined): { tone: "ok" | "err"; text: string } | null {
  if (!p) return null;
  if (p === "connected") return { tone: "ok", text: "Inbox connected. First poll runs within ~2 minutes." };
  const map: Record<string, string> = {
    missing_code:    "Google didn't return an auth code. Try again.",
    state_mismatch:  "Auth flow cookie didn't match. Try again from this page.",
    bad_state:       "Bad install state. Try again.",
    no_refresh_token:"Google didn't issue a refresh token. Open Google Account → Security → Third-party access, remove the GB2G entry, then click Connect again so Google forces a consent screen.",
    exchange_failed: "Token exchange with Google failed. Check that GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET are set and the redirect URI is whitelisted.",
    save_failed:     "Got tokens from Google but failed to save the connection. Check server logs.",
  };
  return { tone: "err", text: map[p] ?? `Install error: ${p}` };
}
