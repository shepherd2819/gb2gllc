import crypto from "node:crypto";

const ADMIN_URL = process.env.NEXT_PUBLIC_ADMIN_URL ?? "https://admin.gb2gllc.com";

// ─── Signature verification ──────────────────────────────────────────────
// Slack signs every request with HMAC-SHA256 using your Signing Secret.
// We verify the X-Slack-Signature header matches before trusting the body.
export function verifySlackSignature(opts: {
  rawBody: string;
  timestamp: string | null;
  signature: string | null;
}): { ok: boolean; reason?: string } {
  const secret = process.env.SLACK_SIGNING_SECRET;
  if (!secret) return { ok: false, reason: "SLACK_SIGNING_SECRET not set" };
  if (!opts.timestamp || !opts.signature) return { ok: false, reason: "missing signature headers" };

  // Reject replays older than 5 minutes
  const ts = Number(opts.timestamp);
  if (!Number.isFinite(ts) || Math.abs(Date.now() / 1000 - ts) > 300) {
    return { ok: false, reason: "stale timestamp" };
  }

  const base = `v0:${opts.timestamp}:${opts.rawBody}`;
  const mac = "v0=" + crypto.createHmac("sha256", secret).update(base).digest("hex");
  const a = Buffer.from(mac);
  const b = Buffer.from(opts.signature);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return { ok: false, reason: "signature mismatch" };
  }
  return { ok: true };
}

// ─── OAuth ───────────────────────────────────────────────────────────────
const REDIRECT_URI = `${ADMIN_URL}/api/slack/oauth/callback`;

// Union of scopes any current or future Steward Slack agent might need.
// Each agent only actually calls the API methods it needs; requesting them all
// up front avoids forcing every workspace to reinstall when we add new agents.
const SCOPES = [
  // Mark + any agent that posts replies / handles slash commands
  "commands",
  "chat:write",
  "chat:write.public",
  // Conversational agents (mentions, DMs)
  "app_mentions:read",
  "im:history",
  "im:read",
  "im:write",
  // Monitoring agents (read channels)
  "channels:history",
  "channels:read",
  "groups:history",
  "groups:read",
  // File-aware agents
  "files:read",
  // Reaction-based approvals
  "reactions:read",
  "reactions:write",
  // Identity & workspace context
  "users:read",
  "users:read.email",
  "team:read",
].join(",");

export function slackInstallUrl(state: string) {
  const clientId = process.env.SLACK_CLIENT_ID;
  if (!clientId) throw new Error("SLACK_CLIENT_ID not set");
  const url = new URL("https://slack.com/oauth/v2/authorize");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("scope", SCOPES);
  url.searchParams.set("redirect_uri", REDIRECT_URI);
  url.searchParams.set("state", state);
  return url.toString();
}

export type SlackOAuthResponse = {
  ok: boolean;
  error?: string;
  app_id?: string;
  authed_user?: { id: string };
  scope?: string;
  token_type?: string;
  access_token?: string; // bot token (xoxb-)
  bot_user_id?: string;
  team?: { id: string; name: string };
  enterprise?: { id: string; name: string } | null;
};

export async function exchangeSlackCode(code: string): Promise<SlackOAuthResponse> {
  const clientId = process.env.SLACK_CLIENT_ID;
  const clientSecret = process.env.SLACK_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    return { ok: false, error: "SLACK_CLIENT_ID or SLACK_CLIENT_SECRET not set" };
  }

  const res = await fetch("https://slack.com/api/oauth.v2.access", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      code,
      redirect_uri: REDIRECT_URI,
    }),
  });
  return res.json() as Promise<SlackOAuthResponse>;
}

// ─── Web API: post a message to a channel ────────────────────────────────
export async function postSlackMessage(opts: {
  botToken: string;
  channel: string;
  text: string;
  thread_ts?: string;
}): Promise<{ ok: boolean; error?: string; ts?: string }> {
  const res = await fetch("https://slack.com/api/chat.postMessage", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${opts.botToken}`,
      "Content-Type": "application/json; charset=utf-8",
    },
    body: JSON.stringify({
      channel: opts.channel,
      text: opts.text,
      thread_ts: opts.thread_ts,
      mrkdwn: true,
    }),
  });
  return res.json();
}

// ─── Web API: respond to a slash command via response_url ────────────────
// response_url is short-lived (30 min, 5 uses) but does NOT require a token.
export async function respondToSlashCommand(responseUrl: string, payload: {
  text: string;
  response_type?: "in_channel" | "ephemeral";
  replace_original?: boolean;
}) {
  await fetch(responseUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ response_type: "in_channel", ...payload }),
  });
}
