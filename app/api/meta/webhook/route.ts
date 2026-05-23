import { NextRequest, NextResponse, after } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import {
  verifyMetaSignature,
  verifyWebhookSubscription,
  sendFacebookMessage,
  sendInstagramMessage,
  replyToComment,
  privateReplyToComment,
} from "@/lib/meta";
import { draftMayaReply, getMayaConfig, postMayaEscalation } from "@/lib/maya";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

// ─── GET: webhook subscription verification ──────────────────────────────
export async function GET(req: NextRequest) {
  const mode = req.nextUrl.searchParams.get("hub.mode");
  const token = req.nextUrl.searchParams.get("hub.verify_token");
  const challenge = req.nextUrl.searchParams.get("hub.challenge");
  if (verifyWebhookSubscription(mode, token)) {
    return new NextResponse(challenge ?? "", { status: 200 });
  }
  return new NextResponse("Forbidden", { status: 403 });
}

// ─── POST: actual events ────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  const rawBody = await req.text();
  const sig = req.headers.get("x-hub-signature-256");
  if (!verifyMetaSignature(rawBody, sig)) {
    console.warn("[meta webhook] signature rejected");
    return NextResponse.json({ error: "bad signature" }, { status: 401 });
  }

  // Always ack within 5s. Meta retries if we don't.
  let body: unknown;
  try { body = JSON.parse(rawBody); }
  catch { return NextResponse.json({ ok: true }); }

  after(handleEvents(body));
  return NextResponse.json({ ok: true });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function handleEvents(body: any) {
  const entries: any[] = body?.entry ?? [];
  for (const entry of entries) {
    const objectType = body.object as "page" | "instagram";

    // ── DMs: entry.messaging[] ─────────────────────────────────────────
    for (const m of entry.messaging ?? []) {
      try { await handleDm(objectType, entry, m); }
      catch (err) { console.error("[meta webhook] DM handler error", err); }
    }

    // ── Changes (comments, etc): entry.changes[] ───────────────────────
    for (const change of entry.changes ?? []) {
      try { await handleChange(objectType, entry, change); }
      catch (err) { console.error("[meta webhook] change handler error", err); }
    }
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function handleDm(objectType: "page" | "instagram", entry: any, m: any) {
  if (m.message?.is_echo) return; // skip our own outbound echoes
  const text: string | undefined = m.message?.text;
  if (!text) return; // ignore stickers/images/etc for v1

  const recipientId: string = m.recipient?.id; // our page or IG-User-id
  const senderId: string = m.sender?.id;       // PSID or IGSID

  // Resolve the page subscription that owns this recipient
  const platform: "facebook" | "instagram" = objectType === "instagram" ? "instagram" : "facebook";
  const sub = await resolveSubscription(platform, recipientId);
  if (!sub) {
    console.warn("[meta webhook] no subscription for recipient", { recipientId, platform });
    return;
  }

  // Don't reply if the agent assignment is paused or DMs are disabled
  const enabled = await dmReplyEnabled(sub.client_id);
  await logInteraction({
    client_id: sub.client_id,
    platform,
    kind: "dm",
    direction: "inbound",
    page_id: sub.page_id,
    ig_account_id: sub.instagram_account_id,
    sender_id: senderId,
    thread_id: senderId,
    text,
    status: enabled ? "received" : "ignored",
    raw: m,
  });
  if (!enabled) return;

  await replyToDm({ sub, platform, senderId, recipientId, text });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function handleChange(objectType: "page" | "instagram", entry: any, change: any) {
  if (change.field !== "feed" && change.field !== "comments") return;

  const v = change.value ?? {};
  // Filter to comment-add events. FB feed sends many event types under "feed".
  if (objectType === "page") {
    if (v.item !== "comment" || v.verb !== "add") return;
  }
  const commentId: string | undefined = v.comment_id ?? v.id;
  const text: string | undefined = v.message ?? v.text;
  if (!commentId || !text) return;
  // Don't reply to our own page's comments (the bot's replies show up as new comments)
  const fromId: string | undefined = v.from?.id;
  const senderName: string | undefined = v.from?.name ?? v.from?.username;

  const platform: "facebook" | "instagram" = objectType === "instagram" ? "instagram" : "facebook";
  const pageOwnerId = entry.id as string;
  const sub = await resolveSubscription(platform, pageOwnerId);
  if (!sub) return;
  if (fromId && (fromId === sub.page_id || fromId === sub.instagram_account_id)) return;

  const enabled = await commentReplyEnabled(sub.client_id);
  await logInteraction({
    client_id: sub.client_id,
    platform,
    kind: "comment",
    direction: "inbound",
    page_id: sub.page_id,
    ig_account_id: sub.instagram_account_id,
    sender_id: fromId ?? null,
    sender_username: senderName ?? null,
    thread_id: commentId,
    text,
    status: enabled ? "received" : "ignored",
    raw: change,
  });
  if (!enabled) return;

  await replyToCommentFlow({ sub, platform, commentId, fromId: fromId ?? null, senderName: senderName ?? null, text });
}

// ── helpers ─────────────────────────────────────────────────────────────

type Sub = {
  client_id: string;
  page_id: string;
  page_access_token: string;
  page_name: string;
  instagram_account_id: string | null;
  instagram_username: string | null;
};

async function resolveSubscription(platform: "facebook" | "instagram", recipientId: string): Promise<Sub | null> {
  const col = platform === "instagram" ? "instagram_account_id" : "page_id";
  const { data } = await supabaseAdmin
    .from("meta_page_subscriptions")
    .select("client_id, page_id, page_access_token, page_name, instagram_account_id, instagram_username")
    .eq(col, recipientId)
    .eq("active", true)
    .maybeSingle();
  return data ?? null;
}

async function dmReplyEnabled(clientId: string): Promise<boolean> {
  const { data } = await supabaseAdmin
    .from("client_social_configs").select("reply_to_dms").eq("client_id", clientId).maybeSingle();
  // default to true if no config row yet
  return data?.reply_to_dms ?? true;
}
async function commentReplyEnabled(clientId: string): Promise<boolean> {
  const { data } = await supabaseAdmin
    .from("client_social_configs").select("reply_to_comments").eq("client_id", clientId).maybeSingle();
  return data?.reply_to_comments ?? true;
}

async function replyToDm(opts: {
  sub: Sub;
  platform: "facebook" | "instagram";
  senderId: string;
  recipientId: string;
  text: string;
}) {
  const { sub, platform, senderId, recipientId, text } = opts;
  const [{ data: client }, config] = await Promise.all([
    supabaseAdmin.from("clients").select("company, name").eq("id", sub.client_id).single(),
    getMayaConfig(sub.client_id),
  ]);
  const company = client?.company ?? client?.name ?? null;

  const draft = await draftMayaReply({ company, config, platform, kind: "dm", userMessage: text });

  if (draft.kind === "escalate") {
    const { data: cfg } = await supabaseAdmin
      .from("client_social_configs").select("escalation_channel").eq("client_id", sub.client_id).maybeSingle();
    await postMayaEscalation({
      clientId: sub.client_id,
      channel: cfg?.escalation_channel ?? null,
      context: `*${platform} DM* on *${sub.page_name}* — Maya flagged: ${draft.reason}\n>${text}`,
    });
    await logInteraction({
      client_id: sub.client_id, platform, kind: "dm", direction: "outbound",
      page_id: sub.page_id, ig_account_id: sub.instagram_account_id,
      sender_id: senderId, thread_id: senderId, text: `[escalated] ${draft.reason}`,
      status: "escalated", escalation_reason: draft.reason,
    });
    return;
  }
  if (draft.kind === "error") {
    await logInteraction({
      client_id: sub.client_id, platform, kind: "dm", direction: "outbound",
      page_id: sub.page_id, ig_account_id: sub.instagram_account_id,
      sender_id: senderId, thread_id: senderId, text: "",
      status: "error", error: draft.error,
    });
    return;
  }

  const send = platform === "instagram"
    ? await sendInstagramMessage({ igUserId: recipientId, pageAccessToken: sub.page_access_token, recipientIgsid: senderId, text: draft.text })
    : await sendFacebookMessage({ pageAccessToken: sub.page_access_token, recipientPsid: senderId, text: draft.text });

  await logInteraction({
    client_id: sub.client_id, platform, kind: "dm", direction: "outbound",
    page_id: sub.page_id, ig_account_id: sub.instagram_account_id,
    sender_id: senderId, thread_id: senderId, text: draft.text,
    status: send.ok ? "replied" : "error", error: send.ok ? null : send.error ?? null,
  });
}

async function replyToCommentFlow(opts: {
  sub: Sub;
  platform: "facebook" | "instagram";
  commentId: string;
  fromId: string | null;
  senderName: string | null;
  text: string;
}) {
  const { sub, platform, commentId, fromId, senderName, text } = opts;
  const [{ data: client }, config] = await Promise.all([
    supabaseAdmin.from("clients").select("company, name").eq("id", sub.client_id).single(),
    getMayaConfig(sub.client_id),
  ]);
  const company = client?.company ?? client?.name ?? null;

  // 1. Draft a SHORT public reply (no link — link goes in the private DM)
  const publicDraft = await draftMayaReply({
    company, config, platform, kind: "comment",
    userMessage: text, senderName,
  });
  if (publicDraft.kind === "escalate") {
    const { data: cfg } = await supabaseAdmin
      .from("client_social_configs").select("escalation_channel").eq("client_id", sub.client_id).maybeSingle();
    await postMayaEscalation({
      clientId: sub.client_id,
      channel: cfg?.escalation_channel ?? null,
      context: `*${platform} comment* on *${sub.page_name}* — Maya flagged: ${publicDraft.reason}\n>${text}`,
    });
    await logInteraction({
      client_id: sub.client_id, platform, kind: "comment", direction: "outbound",
      page_id: sub.page_id, ig_account_id: sub.instagram_account_id,
      sender_id: fromId, sender_username: senderName, thread_id: commentId,
      text: `[escalated] ${publicDraft.reason}`, status: "escalated", escalation_reason: publicDraft.reason,
    });
    return;
  }
  if (publicDraft.kind === "error") return;

  // 2. Post the public reply
  const pub = await replyToComment({ commentId, pageAccessToken: sub.page_access_token, text: publicDraft.text });
  await logInteraction({
    client_id: sub.client_id, platform, kind: "comment", direction: "outbound",
    page_id: sub.page_id, ig_account_id: sub.instagram_account_id,
    sender_id: fromId, sender_username: senderName, thread_id: commentId,
    text: publicDraft.text, status: pub.ok ? "replied" : "error",
    error: pub.ok ? null : pub.error ?? null,
  });

  // 3. Private reply with full info + link (FB only — IG doesn't support private_replies the same way for v1)
  if (platform === "facebook") {
    const dmDraft = await draftMayaReply({
      company, config, platform, kind: "dm",
      userMessage: text, senderName,
    });
    if (dmDraft.kind === "reply") {
      const pr = await privateReplyToComment({ commentId, pageAccessToken: sub.page_access_token, text: dmDraft.text });
      await logInteraction({
        client_id: sub.client_id, platform, kind: "private_reply", direction: "outbound",
        page_id: sub.page_id, ig_account_id: sub.instagram_account_id,
        sender_id: fromId, sender_username: senderName,
        thread_id: commentId, in_reply_to_comment: commentId,
        text: dmDraft.text, status: pr.ok ? "replied" : "error",
        error: pr.ok ? null : pr.error ?? null,
      });
    }
  }
}

type LogArgs = {
  client_id: string;
  platform: "facebook" | "instagram";
  kind: "dm" | "comment" | "private_reply";
  direction: "inbound" | "outbound";
  page_id: string | null;
  ig_account_id?: string | null;
  sender_id?: string | null;
  sender_username?: string | null;
  thread_id?: string | null;
  in_reply_to_comment?: string | null;
  text: string;
  status: "received" | "replied" | "escalated" | "ignored" | "error";
  escalation_reason?: string | null;
  error?: string | null;
  raw?: unknown;
};
async function logInteraction(a: LogArgs) {
  await supabaseAdmin.from("social_interactions").insert({
    client_id: a.client_id,
    platform: a.platform,
    kind: a.kind,
    direction: a.direction,
    page_id: a.page_id,
    ig_account_id: a.ig_account_id ?? null,
    sender_id: a.sender_id ?? null,
    sender_username: a.sender_username ?? null,
    thread_id: a.thread_id ?? null,
    in_reply_to_comment: a.in_reply_to_comment ?? null,
    text: a.text,
    status: a.status,
    escalation_reason: a.escalation_reason ?? null,
    error: a.error ?? null,
    raw: a.raw ?? null,
  });
}
