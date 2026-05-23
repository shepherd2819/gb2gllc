import { anthropic } from "./anthropic";
import { supabaseAdmin } from "./supabase";

const MAYA_MODEL = "claude-haiku-4-5";
const MAX_TOKENS = 512;

export type MayaConfig = {
  website_url: string | null;
  booking_url: string | null;
  order_url: string | null;
  custom_link_label: string | null;
  custom_link_url: string | null;
  custom_instructions: string | null;
  business_hours: string | null;
};

export async function getMayaConfig(clientId: string): Promise<MayaConfig | null> {
  const { data } = await supabaseAdmin
    .from("client_social_configs")
    .select("website_url, booking_url, order_url, custom_link_label, custom_link_url, custom_instructions, business_hours")
    .eq("client_id", clientId)
    .single();
  return data ?? null;
}

function buildSystemPrompt(opts: {
  company: string | null;
  config: MayaConfig | null;
  platform: "facebook" | "instagram";
  kind: "dm" | "comment";
}): string {
  const c = opts.config;
  const links: string[] = [];
  if (c?.website_url)    links.push(`- Website (general info): ${c.website_url}`);
  if (c?.booking_url)    links.push(`- Booking link (for appointments): ${c.booking_url}`);
  if (c?.order_url)      links.push(`- Order / pricing: ${c.order_url}`);
  if (c?.custom_link_url && c?.custom_link_label) links.push(`- ${c.custom_link_label}: ${c.custom_link_url}`);
  const linksBlock = links.length ? links.join("\n") : "- (no links configured yet — keep replies short and offer to follow up)";

  const channelHint = opts.kind === "comment"
    ? `This is a PUBLIC COMMENT, so your reply will be visible on the post. Keep it warm and brief (1-2 sentences). You will ALSO send a private DM with the link, so you don't need to include the URL in this public reply — just acknowledge and say you'll DM details.`
    : `This is a DIRECT MESSAGE. Be helpful and specific. If the right link applies, include it. Keep it under 3 short sentences.`;

  return `You are Maya, a friendly social media manager for ${opts.company || "this business"} on ${opts.platform === "facebook" ? "Facebook" : "Instagram"}.

${channelHint}

Your job: respond promptly, sound human, and convert curiosity into action by directing people to the right link. Never make up information. If you don't know something, say you'll follow up.

Available links:
${linksBlock}

${c?.business_hours ? `Business hours: ${c.business_hours}` : ""}
${c?.custom_instructions ? `Brand voice / extra instructions from the team:\n${c.custom_instructions}` : ""}

Hard rules:
- Never include phone numbers, emails, or links not in the list above.
- Never invite the user to call or text — only use the configured links.
- Don't sign messages with your name ("Maya") — just respond naturally.
- Plain text only, no markdown bold/italics (the platforms strip them).
- If the message is hostile, threatens legal action, mentions a refund/dispute, names a specific medical condition, or is genuinely ambiguous about intent — DO NOT REPLY. Output only the JSON object {"escalate": true, "reason": "<short reason>"} on a single line.

For all other messages, output ONLY the reply text the user should receive. No preamble. No "Here is my reply:".`;
}

export type MayaResponse =
  | { kind: "reply"; text: string }
  | { kind: "escalate"; reason: string }
  | { kind: "error"; error: string };

export async function draftMayaReply(opts: {
  company: string | null;
  config: MayaConfig | null;
  platform: "facebook" | "instagram";
  kind: "dm" | "comment";
  userMessage: string;
  senderName?: string | null;
}): Promise<MayaResponse> {
  const system = buildSystemPrompt(opts);
  const userBlock = `${opts.senderName ? `${opts.senderName} says: ` : ""}${opts.userMessage}`;

  try {
    const res = await anthropic.messages.create({
      model: MAYA_MODEL,
      max_tokens: MAX_TOKENS,
      system,
      messages: [{ role: "user", content: userBlock }],
    });
    const text = (res.content[0]?.type === "text" ? res.content[0].text : "").trim();

    // Detect escalation signal
    if (text.startsWith("{") && text.includes('"escalate"')) {
      try {
        const parsed = JSON.parse(text);
        if (parsed.escalate) {
          return { kind: "escalate", reason: parsed.reason || "Maya flagged for human review" };
        }
      } catch {
        // fall through and treat as a reply
      }
    }

    if (!text) return { kind: "error", error: "Empty response from Claude" };
    return { kind: "reply", text };
  } catch (err) {
    return { kind: "error", error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Notify the client's Slack workspace (if connected) that Maya needs help.
 * Uses the slack platform token for that client, posts to the configured
 * escalation_channel (or DMs the bot user / falls back to a #general write).
 */
export async function postMayaEscalation(opts: {
  clientId: string;
  channel: string | null;
  context: string;
}): Promise<{ ok: boolean; error?: string }> {
  const { data: token } = await supabaseAdmin
    .from("steward_platform_tokens")
    .select("token_data")
    .eq("client_id", opts.clientId)
    .eq("platform", "slack")
    .maybeSingle();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const botToken = (token?.token_data as any)?.access_token;
  if (!botToken) return { ok: false, error: "No Slack workspace connected for this client" };
  if (!opts.channel) return { ok: false, error: "No escalation_channel configured" };

  const res = await fetch("https://slack.com/api/chat.postMessage", {
    method: "POST",
    headers: { Authorization: `Bearer ${botToken}`, "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify({
      channel: opts.channel,
      text: `🚨 *Maya escalation*\n${opts.context}`,
      mrkdwn: true,
    }),
  });
  const json = await res.json().catch(() => ({}));
  if (!json.ok) return { ok: false, error: json.error || `HTTP ${res.status}` };
  return { ok: true };
}
