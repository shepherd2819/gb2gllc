// lib/wren/anchor.ts
//
// Match an inbound support email's sender to a known client and hydrate
// the warm context the classifier uses to ground its draft. Single I/O
// function (findClientForSender) plus a pure summary helper that's tested.

import type { MatchedClient } from "./classify";

type LogEntry = { created_at: string; message: string };

/** Pure: format the last 3 client_logs into a one-line summary. */
export function summarizeRecentLogs(logs: LogEntry[]): string | null {
  if (!logs.length) return null;
  const top = logs.slice(0, 3).map((l) => {
    const d = new Date(l.created_at);
    const day = d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
    return `${day}: ${l.message}`;
  });
  return top.join(" · ");
}

/**
 * Look up a client by sender email (case-insensitive). Returns null if no
 * matching client. When a match is found, also hydrates active products and
 * a short recent-logs summary for the classifier prompt.
 */
export async function findClientForSender(fromEmail: string): Promise<MatchedClient | null> {
  // Lazy: lib/supabase.ts evaluates createClient() at module load with non-null
  // env vars, which would crash test runs that don't set NEXT_PUBLIC_SUPABASE_URL.
  const { supabaseAdmin } = await import("@/lib/supabase");
  const email = fromEmail.trim().toLowerCase();
  if (!email) return null;

  const { data: client } = await supabaseAdmin
    .from("clients")
    .select("id, name, company")
    .ilike("email", email)
    .maybeSingle<{ id: string; name: string | null; company: string | null }>();
  if (!client) return null;

  const [{ data: products }, { data: logs }] = await Promise.all([
    supabaseAdmin.from("client_products").select("product").eq("client_id", client.id).eq("active", true),
    supabaseAdmin
      .from("client_logs")
      .select("created_at, message")
      .eq("client_id", client.id)
      .order("created_at", { ascending: false })
      .limit(5),
  ]);

  return {
    id: client.id,
    name: client.name,
    company: client.company,
    active_products: (products ?? []).map((p: { product: string }) => p.product),
    recent_logs_summary: summarizeRecentLogs((logs ?? []) as LogEntry[]),
  };
}
