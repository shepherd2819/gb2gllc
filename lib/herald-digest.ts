import { supabaseAdmin } from "@/lib/supabase";
import { fetchWeeklyMetrics } from "@/lib/chatbot";
import { resend, DEFAULT_FROM } from "@/lib/resend";
import { heraldDigestHtml, heraldDigestSubject } from "@/lib/email-templates/herald-digest";
import { logEvent } from "@/lib/logger";

const HOME_URL = process.env.NEXT_PUBLIC_HOME_URL ?? "https://home.gb2gllc.com";

type Outcome = {
  client_id: string;
  email: string;
  status: "sent" | "failed" | "skipped";
  reason?: string;
  step?: string;
};

function log(...args: unknown[]) {
  console.log("[herald-digest]", ...args);
}
function logErr(...args: unknown[]) {
  console.error("[herald-digest]", ...args);
}

export async function sendDigestForClient(clientId: string, opts: { force?: boolean } = {}): Promise<Outcome> {
  log("start", { clientId, force: !!opts.force });

  // ── 1. Load client ────────────────────────────────────────────────────────
  const { data: client, error: lookupErr } = await supabaseAdmin
    .from("clients")
    .select("id, email, name, company, status, chatbot_bot_id, chatbot_agent_name, herald_digest_enabled")
    .eq("id", clientId)
    .single();

  if (lookupErr || !client) {
    const reason = lookupErr?.message ?? "client not found";
    logErr("client lookup failed", { clientId, reason });
    return { client_id: clientId, email: "", status: "failed", reason, step: "lookup" };
  }
  log("client loaded", {
    id: client.id,
    email: client.email,
    status: client.status,
    has_bot_id: !!client.chatbot_bot_id,
    digest_enabled: client.herald_digest_enabled,
  });

  // ── 2. Eligibility checks ────────────────────────────────────────────────
  if (!opts.force) {
    if (client.status && client.status !== "active") return skipped(client, "client not active", "eligibility");
    if (!client.herald_digest_enabled) return skipped(client, "digest disabled for client", "eligibility");
  }
  if (!client.chatbot_bot_id) return skipped(client, "no chatbot_bot_id set on client", "eligibility");

  // ── 3. Env checks (fail fast with clear reason) ──────────────────────────
  if (!process.env.CHATBOT_API_KEY) {
    const reason = "CHATBOT_API_KEY env var is not set";
    logErr(reason);
    await recordDigest(client.id, new Date(), new Date(), {}, "failed", reason, null);
    await logEvent({ clientId: client.id, category: "herald", level: "error", message: reason });
    return { client_id: client.id, email: client.email, status: "failed", reason, step: "env" };
  }
  if (!process.env.RESEND_API_KEY) {
    const reason = "RESEND_API_KEY env var is not set";
    logErr(reason);
    await recordDigest(client.id, new Date(), new Date(), {}, "failed", reason, null);
    await logEvent({ clientId: client.id, category: "herald", level: "error", message: reason });
    return { client_id: client.id, email: client.email, status: "failed", reason, step: "env" };
  }

  const now = new Date();
  const periodEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const periodStart = new Date(periodEnd.getTime() - 7 * 24 * 60 * 60 * 1000);

  // ── 4. Fetch metrics from chatbot.com ────────────────────────────────────
  log("fetching metrics", {
    bot_id: client.chatbot_bot_id,
    from: periodStart.toISOString(),
    to: periodEnd.toISOString(),
  });
  let metrics;
  try {
    metrics = await fetchWeeklyMetrics(client.chatbot_bot_id, periodStart, periodEnd);
    log("metrics fetched", metrics);
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    logErr("metrics fetch failed", reason);
    await recordDigest(client.id, periodStart, periodEnd, {}, "failed", reason, null);
    await logEvent({
      clientId: client.id,
      category: "herald",
      level: "error",
      message: `Digest failed: chatbot.com fetch error — ${reason}`,
      metadata: { bot_id: client.chatbot_bot_id },
    });
    return { client_id: client.id, email: client.email, status: "failed", reason, step: "chatbot_fetch" };
  }

  // ── 5. Render email ──────────────────────────────────────────────────────
  const html = heraldDigestHtml({
    clientName: client.name ?? "",
    company: client.company,
    agentName: client.chatbot_agent_name ?? null,
    periodStart,
    periodEnd,
    metrics,
    portalUrl: HOME_URL,
  });

  // ── 6. Send via Resend ───────────────────────────────────────────────────
  log("sending via Resend", { to: client.email, from: DEFAULT_FROM });
  try {
    const sent = await resend().emails.send({
      from: DEFAULT_FROM,
      to: client.email,
      subject: heraldDigestSubject(periodEnd, client.chatbot_agent_name),
      html,
    });
    if (sent.error) {
      const reason = `Resend error: ${sent.error.message ?? JSON.stringify(sent.error)}`;
      logErr("Resend returned error", sent.error);
      await recordDigest(client.id, periodStart, periodEnd, metrics, "failed", reason, null);
      await logEvent({ clientId: client.id, category: "herald", level: "error", message: reason });
      return { client_id: client.id, email: client.email, status: "failed", reason, step: "resend" };
    }
    const resendId = sent.data?.id ?? null;
    log("sent", { resend_id: resendId });
    await recordDigest(client.id, periodStart, periodEnd, metrics, "sent", null, resendId);
    await supabaseAdmin
      .from("clients")
      .update({ herald_digest_last_sent_at: new Date().toISOString() })
      .eq("id", client.id);
    await logEvent({
      clientId: client.id,
      category: "herald",
      level: "info",
      message: `Weekly digest sent to ${client.email}`,
      metadata: { resend_id: resendId, ...metrics },
    });
    return { client_id: client.id, email: client.email, status: "sent" };
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    logErr("Resend threw", err);
    await recordDigest(client.id, periodStart, periodEnd, metrics, "failed", reason, null);
    await logEvent({ clientId: client.id, category: "herald", level: "error", message: `Digest failed: ${reason}` });
    return { client_id: client.id, email: client.email, status: "failed", reason, step: "resend" };
  }
}

export async function sendDigestForAllActiveClients(): Promise<Outcome[]> {
  const { data: clients } = await supabaseAdmin
    .from("clients")
    .select("id")
    .eq("herald_digest_enabled", true)
    .not("chatbot_bot_id", "is", null)
    .or("status.is.null,status.eq.active");

  log("batch start", { count: clients?.length ?? 0 });
  const results: Outcome[] = [];
  for (const c of clients ?? []) {
    results.push(await sendDigestForClient(c.id));
  }
  log("batch done", {
    sent: results.filter((r) => r.status === "sent").length,
    failed: results.filter((r) => r.status === "failed").length,
    skipped: results.filter((r) => r.status === "skipped").length,
  });
  return results;
}

function skipped(client: { id: string; email: string }, reason: string, step: string): Outcome {
  log("skipped", { client_id: client.id, reason });
  return { client_id: client.id, email: client.email, status: "skipped", reason, step };
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
  try {
    await supabaseAdmin.from("herald_digests").insert({
      client_id: clientId,
      period_start: periodStart.toISOString(),
      period_end: periodEnd.toISOString(),
      metrics,
      status,
      error,
      resend_id: resendId,
    });
  } catch (e) {
    logErr("herald_digests insert failed", e);
  }
}
