// Gmail / Google OAuth helpers for Iris.
//
// Scope choices:
//   gmail.modify         → read messages, create labels, modify labels, create drafts
//   userinfo.email       → fetch which mailbox we connected
//   userinfo.profile     → display name on the connected-accounts page
//
// We deliberately do NOT request gmail.send. Iris never sends without a human
// click. The send path uses the user-clicked draft, promoted to a real send.
// (To upgrade to actually sending the draft via Gmail, we'll add gmail.send
// later behind an explicit toggle.)

const OAUTH_AUTH  = "https://accounts.google.com/o/oauth2/v2/auth";
const OAUTH_TOKEN = "https://oauth2.googleapis.com/token";
const GMAIL_API   = "https://gmail.googleapis.com/gmail/v1";
const USERINFO    = "https://openidconnect.googleapis.com/v1/userinfo";

const SCOPES = [
  "https://www.googleapis.com/auth/gmail.modify",
  "https://www.googleapis.com/auth/userinfo.email",
  "https://www.googleapis.com/auth/userinfo.profile",
  "openid",
];

// ─── OAuth start ─────────────────────────────────────────────────────────
export function googleInstallUrl(opts: { state: string; redirectUri: string }): string {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  if (!clientId) throw new Error("GOOGLE_CLIENT_ID not set");
  const url = new URL(OAUTH_AUTH);
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", opts.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", SCOPES.join(" "));
  url.searchParams.set("access_type", "offline");      // required to get refresh_token
  url.searchParams.set("prompt", "consent");           // force refresh_token on every install
  url.searchParams.set("include_granted_scopes", "true");
  url.searchParams.set("state", opts.state);
  return url.toString();
}

export type GoogleTokenResponse = {
  access_token: string;
  expires_in: number;             // seconds, typically 3599
  refresh_token?: string;         // only on first consent
  scope: string;
  token_type: string;
  id_token?: string;
};

export async function exchangeGoogleCode(opts: { code: string; redirectUri: string }): Promise<GoogleTokenResponse> {
  const clientId     = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new Error("GOOGLE_CLIENT_ID or GOOGLE_CLIENT_SECRET not set");

  const res = await fetch(OAUTH_TOKEN, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code: opts.code,
      redirect_uri: opts.redirectUri,
      client_id: clientId,
      client_secret: clientSecret,
    }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Google token exchange ${res.status}: ${text.slice(0, 300)}`);
  return JSON.parse(text);
}

export async function refreshGoogleToken(refreshToken: string): Promise<GoogleTokenResponse> {
  const clientId     = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new Error("GOOGLE_CLIENT_ID or GOOGLE_CLIENT_SECRET not set");

  const res = await fetch(OAUTH_TOKEN, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: clientId,
      client_secret: clientSecret,
    }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Google refresh ${res.status}: ${text.slice(0, 300)}`);
  return JSON.parse(text);
}

export type GoogleUserInfo = {
  sub: string;
  email: string;
  email_verified: boolean;
  name?: string;
  picture?: string;
};

export async function getGoogleUserInfo(accessToken: string): Promise<GoogleUserInfo> {
  const res = await fetch(USERINFO, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`Google userinfo ${res.status}: ${t.slice(0, 200)}`);
  }
  return res.json();
}

// ─── Gmail API ───────────────────────────────────────────────────────────

export type GmailProfile = { emailAddress: string; messagesTotal: number; historyId: string };

export async function getGmailProfile(accessToken: string): Promise<GmailProfile> {
  const res = await fetch(`${GMAIL_API}/users/me/profile`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error(`Gmail profile ${res.status}: ${await res.text()}`);
  return res.json();
}

// Best-effort enumeration of send-as aliases configured on the mailbox.
// Requires gmail.settings.basic scope to be perfect — without it, Gmail
// returns 403 and we just fall back to the primary address. Either way, the
// Delivered-To header on each message also reveals which alias received it.
export async function getGmailSendAs(accessToken: string): Promise<string[]> {
  const res = await fetch(`${GMAIL_API}/users/me/settings/sendAs`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) return [];
  const json = await res.json().catch(() => ({}));
  const arr: { sendAsEmail?: string }[] = Array.isArray(json.sendAs) ? json.sendAs : [];
  return arr.map((a) => a.sendAsEmail).filter((e): e is string => typeof e === "string");
}

// List message ids received since `afterDate` (epoch seconds) in INBOX.
// We deliberately scope to INBOX + UNREAD to keep volume sane on first
// connect (would otherwise dump months of read mail into the queue).
export async function listInboxMessageIds(
  accessToken: string,
  opts: { afterSec: number; maxResults?: number; pageToken?: string }
): Promise<{ ids: string[]; nextPageToken?: string }> {
  const params = new URLSearchParams({
    q: `in:inbox after:${opts.afterSec}`,
    maxResults: String(opts.maxResults ?? 25),
  });
  if (opts.pageToken) params.set("pageToken", opts.pageToken);
  const res = await fetch(`${GMAIL_API}/users/me/messages?${params.toString()}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error(`Gmail messages.list ${res.status}: ${await res.text()}`);
  const json = await res.json();
  const messages: { id: string }[] = Array.isArray(json.messages) ? json.messages : [];
  return { ids: messages.map((m) => m.id), nextPageToken: json.nextPageToken };
}

export type GmailMessage = {
  id: string;
  threadId: string;
  labelIds?: string[];
  snippet?: string;
  internalDate?: string;            // epoch ms (string)
  payload?: GmailPayload;
};

type GmailPayload = {
  partId?: string;
  mimeType?: string;
  filename?: string;
  headers?: { name: string; value: string }[];
  body?: { data?: string; size?: number };
  parts?: GmailPayload[];
};

export async function getGmailMessage(accessToken: string, id: string): Promise<GmailMessage> {
  const res = await fetch(`${GMAIL_API}/users/me/messages/${id}?format=full`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error(`Gmail messages.get ${res.status}: ${await res.text()}`);
  return res.json();
}

export type ParsedMessage = {
  id: string;
  threadId: string;
  from_email: string | null;
  from_name: string | null;
  to_addresses: string[];
  delivered_to: string | null;
  subject: string;
  snippet: string;
  received_at: string;              // ISO
  body_text: string;
  body_html: string;
};

export function parseGmailMessage(m: GmailMessage): ParsedMessage {
  const headers = m.payload?.headers ?? [];
  const h = (name: string) => headers.find((x) => x.name.toLowerCase() === name.toLowerCase())?.value ?? "";

  const from = h("From");
  const { email: fromEmail, name: fromName } = parseAddress(from);

  const toRaw = h("To");
  const to_addresses = toRaw.split(",").map((s) => parseAddress(s).email).filter(Boolean) as string[];
  const delivered_to = h("Delivered-To") || h("X-Delivered-To") || (to_addresses[0] ?? null);

  const subject = h("Subject");
  const dateStr = h("Date");
  const internalMs = m.internalDate ? Number(m.internalDate) : NaN;
  const received_at = Number.isFinite(internalMs)
    ? new Date(internalMs).toISOString()
    : dateStr ? new Date(dateStr).toISOString() : new Date().toISOString();

  const { text, html } = extractBody(m.payload);

  return {
    id: m.id,
    threadId: m.threadId,
    from_email: fromEmail,
    from_name: fromName,
    to_addresses,
    delivered_to,
    subject,
    snippet: m.snippet ?? "",
    received_at,
    body_text: text,
    body_html: html,
  };
}

function parseAddress(raw: string): { email: string | null; name: string | null } {
  if (!raw) return { email: null, name: null };
  const m = raw.match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/);
  if (m) return { name: m[1].trim() || null, email: m[2].trim().toLowerCase() };
  const e = raw.match(/([^\s<>"]+@[^\s<>"]+)/);
  return { email: e ? e[1].toLowerCase() : null, name: null };
}

function extractBody(payload?: GmailPayload): { text: string; html: string } {
  if (!payload) return { text: "", html: "" };
  let text = "";
  let html = "";
  const walk = (p: GmailPayload) => {
    const data = p.body?.data;
    if (data) {
      const decoded = base64UrlDecode(data);
      if (p.mimeType === "text/plain" && !text) text = decoded;
      else if (p.mimeType === "text/html" && !html) html = decoded;
    }
    p.parts?.forEach(walk);
  };
  walk(payload);
  if (!text && html) text = stripHtml(html);
  return { text: text.slice(0, 50_000), html: html.slice(0, 200_000) };
}

function base64UrlDecode(s: string): string {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/");
  const pad = b64.length % 4 === 0 ? "" : "=".repeat(4 - (b64.length % 4));
  try { return Buffer.from(b64 + pad, "base64").toString("utf8"); }
  catch { return ""; }
}

function stripHtml(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// ─── Labels ──────────────────────────────────────────────────────────────
// Iris uses a single nested label hierarchy: "Iris/lead", "Iris/support", etc.
// We cache (name → labelId) per call site.

export type GmailLabel = { id: string; name: string };

export async function listGmailLabels(accessToken: string): Promise<GmailLabel[]> {
  const res = await fetch(`${GMAIL_API}/users/me/labels`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error(`Gmail labels.list ${res.status}: ${await res.text()}`);
  const json = await res.json();
  return (json.labels ?? []).map((l: GmailLabel) => ({ id: l.id, name: l.name }));
}

export async function getOrCreateLabel(accessToken: string, name: string): Promise<string> {
  const labels = await listGmailLabels(accessToken);
  const existing = labels.find((l) => l.name === name);
  if (existing) return existing.id;

  const res = await fetch(`${GMAIL_API}/users/me/labels`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      name,
      labelListVisibility: "labelShow",
      messageListVisibility: "show",
    }),
  });
  if (!res.ok) throw new Error(`Gmail labels.create ${res.status}: ${await res.text()}`);
  const json = await res.json();
  return json.id as string;
}

export async function addLabelToMessage(accessToken: string, messageId: string, labelId: string): Promise<void> {
  const res = await fetch(`${GMAIL_API}/users/me/messages/${messageId}/modify`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ addLabelIds: [labelId] }),
  });
  if (!res.ok) throw new Error(`Gmail messages.modify ${res.status}: ${await res.text()}`);
}

// ─── Drafts ──────────────────────────────────────────────────────────────
// We save the draft inside the original thread so the user sees it as a
// pending reply in their normal Gmail UI — even if they ignore the admin
// dashboard.

export type DraftArgs = {
  threadId: string;
  to: string;
  from: string;                     // alias the original message was sent to (so reply goes from the same address)
  inReplyToMessageId?: string;      // RFC822 Message-Id of the email we're replying to (for proper threading)
  subject: string;
  body: string;
};

export async function createGmailDraft(accessToken: string, args: DraftArgs): Promise<{ id: string; messageId: string }> {
  const raw = buildRfc822(args);
  const res = await fetch(`${GMAIL_API}/users/me/drafts`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ message: { raw, threadId: args.threadId } }),
  });
  if (!res.ok) throw new Error(`Gmail drafts.create ${res.status}: ${await res.text()}`);
  const json = await res.json();
  return { id: json.id as string, messageId: json.message?.id as string };
}

export async function updateGmailDraft(accessToken: string, draftId: string, args: DraftArgs): Promise<void> {
  const raw = buildRfc822(args);
  const res = await fetch(`${GMAIL_API}/users/me/drafts/${draftId}`, {
    method: "PUT",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ message: { raw, threadId: args.threadId } }),
  });
  if (!res.ok) throw new Error(`Gmail drafts.update ${res.status}: ${await res.text()}`);
}

export async function sendGmailDraft(accessToken: string, draftId: string): Promise<{ messageId: string }> {
  const res = await fetch(`${GMAIL_API}/users/me/drafts/send`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ id: draftId }),
  });
  if (!res.ok) throw new Error(`Gmail drafts.send ${res.status}: ${await res.text()}`);
  const json = await res.json();
  return { messageId: json.id as string };
}

function buildRfc822(args: DraftArgs): string {
  const replySubject = args.subject.toLowerCase().startsWith("re:") ? args.subject : `Re: ${args.subject}`;
  const headers = [
    `From: ${args.from}`,
    `To: ${args.to}`,
    `Subject: ${encodeHeader(replySubject)}`,
    `Content-Type: text/plain; charset="UTF-8"`,
    `Content-Transfer-Encoding: 7bit`,
    `MIME-Version: 1.0`,
  ];
  if (args.inReplyToMessageId) {
    headers.push(`In-Reply-To: ${args.inReplyToMessageId}`);
    headers.push(`References: ${args.inReplyToMessageId}`);
  }
  const message = `${headers.join("\r\n")}\r\n\r\n${args.body}`;
  return Buffer.from(message, "utf8").toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// Subjects with non-ASCII need RFC 2047 encoding. We keep it simple: if any
// non-ASCII, base64-wrap the whole subject. Plain ASCII passes through.
function encodeHeader(s: string): string {
  // eslint-disable-next-line no-control-regex
  return /[^\x00-\x7F]/.test(s) ? `=?UTF-8?B?${Buffer.from(s, "utf8").toString("base64")}?=` : s;
}
