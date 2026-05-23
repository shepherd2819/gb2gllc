import { supabaseAdmin } from "@/lib/supabase";
import { fetchWeeklyMetrics } from "@/lib/chatbot";
import { resend, DEFAULT_FROM } from "@/lib/resend";
import { heraldDigestHtml, heraldDigestSubject } from "@/lib/email-templates/herald-digest";

const HOME_URL = process.env.NEXT_PUBLIC_HOME_URL ?? "https://home.gb2gllc.com";

type Outcome = { client_id: string; email: string; status: "sent" | "failed" | "skipped"; reason?: string };

export async function sendDigestForClient(clientId: string, opts: { force?: boolean } = {}): Promise<Outcome> {
  const { data: client, error } = await supabaseAdmin
    .from("clients")
    .select("id, email, name, company, status, chatbot_bot_id, herald_digest_enabled")
    .eq("id", clientId)
    .single();

  if (error || !client) {
    return { client_id: clientId, email: "", status: "failed", reason: error?.message ?? "client not found" };
  }

  if (!opts.force) {
    if (client.status && client.status !== "active") return skipped(client, "client not active");
    if (!client.herald_digest_enabled) return skipped(client, "digest disabled");
  }
  if (!client.chatbot_bot_id) return skipped(client, "no chatbot_bot_id");

  const now = new Date();
  const periodEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const periodStart = new Date(periodEnd.getTime() - 7 * 24 * 60 * 60 * 1000);

  let metrics;
  try {
    metrics = await fetchWeeklyMetrics(client.chatbot_bot_id, periodStart, periodEnd);
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    await recordDigest(client.id, periodStart, periodEnd, {}, "failed", reason, null);
    return { client_id: client.id, email: client.email, status: "failed", reason };
  }

  const html = heraldDigestHtml({
    clientName: client.name ?? "",
    company: client.company,
    periodStart,
    periodEnd,
    metrics,
    portalUrl: HOME_URL,
  });

  try {
    const sent = await resend().emails.send({
      from: DEFAULT_FROM,
      to: client.email,
      subject: heraldDigestSubject(periodEnd),
      html,
    });
    const resendId = sent.data?.id ?? null;
    await recordDigest(client.id, periodStart, periodEnd, metrics, "sent", null, resendId);
    await supabaseAdmin
      .from("clients")
      .update({ herald_digest_last_sent_at: new Date().toISOString() })
      .eq("id", client.id);
    return { client_id: client.id, email: client.email, status: "sent" };
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    await recordDigest(client.id, periodStart, periodEnd, metrics, "failed", reason, null);
    return { client_id: client.id, email: client.email, status: "failed", reason };
  }
}

export async function sendDigestForAllActiveClients(): Promise<Outcome[]> {
  const { data: clients } = await supabaseAdmin
    .from("clients")
    .select("id")
    .eq("herald_digest_enabled", true)
    .not("chatbot_bot_id", "is", null)
    .or("status.is.null,status.eq.active");

  const results: Outcome[] = [];
  for (const c of clients ?? []) {
    results.push(await sendDigestForClient(c.id));
  }
  return results;
}

function skipped(client: { id: string; email: string }, reason: string): Outcome {
  return { client_id: client.id, email: client.email, status: "skipped", reason };
}

async function recordDigest(
  clientId: string,
  periodStart: Date,
  periodEnd: Date,
  metrics: object,
  status: "sent" | "failed" | "skipped",
  error: string | null,
  resendId: string | null
) {
  await supabaseAdmin.from("herald_digests").insert({
    client_id: clientId,
    period_start: periodStart.toISOString(),
    period_end: periodEnd.toISOString(),
    metrics,
    status,
    error,
    resend_id: resendId,
  });
}
