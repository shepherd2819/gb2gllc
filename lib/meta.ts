import crypto from "node:crypto";

const ADMIN_URL = process.env.NEXT_PUBLIC_ADMIN_URL ?? "https://admin.gb2gllc.com";
const GRAPH_BASE = "https://graph.facebook.com/v21.0";
const OAUTH_BASE = "https://www.facebook.com/v21.0/dialog/oauth";

export const META_REDIRECT_URI = `${ADMIN_URL}/api/meta/oauth/callback`;

const SCOPES = [
  "pages_show_list",
  "pages_messaging",
  "pages_manage_metadata",
  "pages_read_engagement",
  "pages_manage_engagement",
  "instagram_basic",
  "instagram_manage_messages",
  "instagram_manage_comments",
  "business_management",
];

// ─── OAuth ───────────────────────────────────────────────────────────────
export function metaInstallUrl(state: string): string {
  const clientId = process.env.META_APP_ID;
  if (!clientId) throw new Error("META_APP_ID not set");
  const url = new URL(OAUTH_BASE);
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", META_REDIRECT_URI);
  url.searchParams.set("state", state);
  url.searchParams.set("scope", SCOPES.join(","));
  url.searchParams.set("response_type", "code");
  return url.toString();
}

export type ShortLivedTokenResponse = {
  access_token: string;
  token_type: string;
  expires_in?: number;
};

export async function exchangeMetaCode(code: string): Promise<ShortLivedTokenResponse> {
  const appId = process.env.META_APP_ID;
  const appSecret = process.env.META_APP_SECRET;
  if (!appId || !appSecret) throw new Error("META_APP_ID or META_APP_SECRET not set");

  const url = new URL(`${GRAPH_BASE}/oauth/access_token`);
  url.searchParams.set("client_id", appId);
  url.searchParams.set("client_secret", appSecret);
  url.searchParams.set("redirect_uri", META_REDIRECT_URI);
  url.searchParams.set("code", code);

  const res = await fetch(url, { cache: "no-store" });
  const text = await res.text();
  if (!res.ok) throw new Error(`Meta token exchange failed: ${res.status} ${text.slice(0, 200)}`);
  return JSON.parse(text);
}

// Page tokens issued from a user token are already long-lived (~60 days).
// For Maya's purposes we use the page token directly per page.
export type MetaPage = {
  id: string;
  name: string;
  access_token: string;
  tasks?: string[];
  instagram_business_account?: { id: string };
};

export async function listUserPages(userAccessToken: string): Promise<MetaPage[]> {
  const url = new URL(`${GRAPH_BASE}/me/accounts`);
  url.searchParams.set("fields", "id,name,access_token,tasks,instagram_business_account");
  url.searchParams.set("access_token", userAccessToken);
  const res = await fetch(url, { cache: "no-store" });
  const text = await res.text();
  if (!res.ok) throw new Error(`Meta /me/accounts failed: ${res.status} ${text.slice(0, 200)}`);
  const json = JSON.parse(text);
  return json.data ?? [];
}

export async function getInstagramUsername(igAccountId: string, pageAccessToken: string): Promise<string | null> {
  const url = new URL(`${GRAPH_BASE}/${igAccountId}`);
  url.searchParams.set("fields", "username");
  url.searchParams.set("access_token", pageAccessToken);
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) return null;
  const j = await res.json();
  return j.username ?? null;
}

// ─── Subscribe app to a page (so we receive webhooks for it) ─────────────
export async function subscribePageToApp(pageId: string, pageAccessToken: string): Promise<boolean> {
  const url = `${GRAPH_BASE}/${pageId}/subscribed_apps`;
  const body = new URLSearchParams({
    access_token: pageAccessToken,
    subscribed_fields: "messages,messaging_postbacks,feed",
  });
  const res = await fetch(url, { method: "POST", body });
  return res.ok;
}

// ─── Send a DM (Facebook Messenger Send API) ────────────────────────────
export async function sendFacebookMessage(opts: {
  pageAccessToken: string;
  recipientPsid: string;
  text: string;
}): Promise<{ ok: boolean; error?: string; message_id?: string }> {
  const url = `${GRAPH_BASE}/me/messages?access_token=${encodeURIComponent(opts.pageAccessToken)}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      recipient: { id: opts.recipientPsid },
      message: { text: opts.text },
      messaging_type: "RESPONSE",
    }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) return { ok: false, error: JSON.stringify(json).slice(0, 300) };
  return { ok: true, message_id: json.message_id };
}

// ─── Send an Instagram DM (same Send API, but on the IG-User-ID) ────────
export async function sendInstagramMessage(opts: {
  igUserId: string;        // the IG Business Account ID we own
  pageAccessToken: string;
  recipientIgsid: string;
  text: string;
}): Promise<{ ok: boolean; error?: string; message_id?: string }> {
  const url = `${GRAPH_BASE}/${opts.igUserId}/messages?access_token=${encodeURIComponent(opts.pageAccessToken)}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      recipient: { id: opts.recipientIgsid },
      message: { text: opts.text },
    }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) return { ok: false, error: JSON.stringify(json).slice(0, 300) };
  return { ok: true, message_id: json.message_id };
}

// ─── Reply publicly to a comment (works for both FB Page comments and IG comments) ──
export async function replyToComment(opts: {
  commentId: string;
  pageAccessToken: string;
  text: string;
}): Promise<{ ok: boolean; error?: string; id?: string }> {
  const url = `${GRAPH_BASE}/${opts.commentId}/replies?access_token=${encodeURIComponent(opts.pageAccessToken)}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message: opts.text }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) return { ok: false, error: JSON.stringify(json).slice(0, 300) };
  return { ok: true, id: json.id };
}

// ─── Private reply: DM the person who commented (FB only). Within 7 days of comment. ──
export async function privateReplyToComment(opts: {
  commentId: string;
  pageAccessToken: string;
  text: string;
}): Promise<{ ok: boolean; error?: string; id?: string }> {
  const url = `${GRAPH_BASE}/${opts.commentId}/private_replies?access_token=${encodeURIComponent(opts.pageAccessToken)}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message: opts.text }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) return { ok: false, error: JSON.stringify(json).slice(0, 300) };
  return { ok: true, id: json.id };
}

// ─── Webhook signature verification ──────────────────────────────────────
export function verifyMetaSignature(rawBody: string, signatureHeader: string | null): boolean {
  const secret = process.env.META_APP_SECRET;
  if (!secret || !signatureHeader) return false;
  // Header looks like "sha256=<hex>"
  const [algo, hex] = signatureHeader.split("=");
  if (algo !== "sha256" || !hex) return false;
  const mac = crypto.createHmac("sha256", secret).update(rawBody).digest("hex");
  const a = Buffer.from(mac);
  const b = Buffer.from(hex);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

export function verifyWebhookSubscription(modeQ: string | null, tokenQ: string | null): string | null {
  const verifyToken = process.env.META_VERIFY_TOKEN;
  if (modeQ === "subscribe" && verifyToken && tokenQ === verifyToken) {
    return tokenQ; // we return the challenge param in the route handler
  }
  return null;
}
