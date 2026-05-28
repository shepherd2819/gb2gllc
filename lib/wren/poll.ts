// lib/wren/poll.ts
//
// Per-account poller for Wren — the support-mailbox triage agent.
// Mirrors lib/iris/poll.ts with three deltas: uses wren_* tables,
// calls findClientForSender before classify, and labels with
// Wren/{category} instead of Iris/{category}.

import { supabaseAdmin } from "@/lib/supabase";
import { logEvent } from "@/lib/logger";
import {
  refreshGoogleToken,
  listInboxMessageIds,
  getGmailMessage,
  parseGmailMessage,
  getOrCreateLabel,
  addLabelToMessage,
  createGmailDraft,
} from "@/lib/gmail";
import type { ParsedMessage } from "@/lib/gmail";
import { classifyAndDraft, MODEL_NAME } from "./classify";
import type { Classification } from "./classify";
import { findClientForSender } from "./anchor";

const LOOKBACK_SEC = 60 * 10;             // 10 min — 2x the cron interval
const MAX_PER_POLL_PER_ACCOUNT = 25;

export type AccountRow = {
  id: string;
  workos_user_id: string;
  email_address: string;
  aliases: string[];
  access_token: string;
  refresh_token: string;
  token_expires_at: string;
  history_id: string | null;
  status: "active" | "paused" | "revoked";
};

export type SettingsRow = {
  account_id: string;
  draft_categories: string[];
  ignore_from_patterns: string[];
  voice_notes: string | null;
  signature: string | null;
};

export type PollResult = {
  account_id: string;
  email: string;
  fetched: number;
  classified: number;
  drafted: number;
  skipped: number;
  errors: string[];
};

export async function pollAccount(accountId: string): Promise<PollResult> {
  const { data: acct, error: acctErr } = await supabaseAdmin
    .from("wren_inbox_accounts")
    .select("*")
    .eq("id", accountId)
    .single<AccountRow>();

  if (acctErr || !acct) {
    return { account_id: accountId, email: "", fetched: 0, classified: 0, drafted: 0, skipped: 0, errors: [`account not found: ${acctErr?.message}`] };
  }
  if (acct.status !== "active") {
    return { account_id: acct.id, email: acct.email_address, fetched: 0, classified: 0, drafted: 0, skipped: 0, errors: [`account status=${acct.status}`] };
  }

  const result: PollResult = {
    account_id: acct.id,
    email: acct.email_address,
    fetched: 0,
    classified: 0,
    drafted: 0,
    skipped: 0,
    errors: [],
  };

  // Refresh access token if expiring within 60s.
  let accessToken = acct.access_token;
  try {
    accessToken = await ensureFreshToken(acct);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await markPollError(acct.id, `token refresh: ${msg}`);
    result.errors.push(`token refresh: ${msg}`);
    return result;
  }

  // Settings (or defaults).
  const { data: settingsRow } = await supabaseAdmin
    .from("wren_settings")
    .select("*")
    .eq("account_id", acct.id)
    .maybeSingle<SettingsRow>();
  const settings: SettingsRow = settingsRow ?? {
    account_id: acct.id,
    draft_categories: ["bug", "feature_request", "account_help", "billing_question", "general"],
    ignore_from_patterns: ["noreply@", "no-reply@", "donotreply@", "mailer-daemon@"],
    voice_notes: null,
    signature: null,
  };

  // 1. List recent inbox ids.
  const afterSec = Math.floor(Date.now() / 1000) - LOOKBACK_SEC;
  let ids: string[] = [];
  try {
    const list = await listInboxMessageIds(accessToken, { afterSec, maxResults: MAX_PER_POLL_PER_ACCOUNT });
    ids = list.ids;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await markPollError(acct.id, `messages.list: ${msg}`);
    result.errors.push(`messages.list: ${msg}`);
    return result;
  }

  // 2. Dedupe against what we already have.
  if (ids.length) {
    const { data: existing } = await supabaseAdmin
      .from("wren_messages")
      .select("gmail_message_id")
      .eq("account_id", acct.id)
      .in("gmail_message_id", ids);
    const seen = new Set((existing ?? []).map((r: { gmail_message_id: string }) => r.gmail_message_id));
    ids = ids.filter((id) => !seen.has(id));
  }

  // 3. For each new message: fetch, ingest, anchor, classify, label, draft.
  for (const id of ids) {
    try {
      const msg = await getGmailMessage(accessToken, id);
      const parsed = parseGmailMessage(msg);
      result.fetched++;

      const ignore = shouldIgnore(parsed, settings.ignore_from_patterns);
      const inserted = await insertMessage(acct.id, parsed);
      if (!inserted) { result.skipped++; continue; }

      if (ignore) {
        await markIgnored(inserted.id, "ignored by from-pattern");
        result.skipped++;
        continue;
      }

      // Warm context: try to match the sender to a known client.
      const matched = parsed.from_email ? await findClientForSender(parsed.from_email).catch(() => null) : null;

      // Classify.
      let classification: Classification;
      try {
        classification = await classifyAndDraft({
          from_email: parsed.from_email ?? "(unknown)",
          from_name: parsed.from_name,
          delivered_to: parsed.delivered_to,
          subject: parsed.subject,
          body_text: parsed.body_text,
          voice_notes: settings.voice_notes ?? undefined,
          signature: settings.signature ?? undefined,
          draft_categories: settings.draft_categories,
          matched_client: matched,
        });
      } catch (err) {
        const m = err instanceof Error ? err.message : String(err);
        await markClassifyError(inserted.id, m);
        result.errors.push(`classify ${id}: ${m}`);
        continue;
      }
      result.classified++;

      // Label.
      let labelId: string | null = null;
      try {
        labelId = await getOrCreateLabel(accessToken, `Wren/${classification.category}`);
        await addLabelToMessage(accessToken, parsed.id, labelId);
      } catch (err) {
        const m = err instanceof Error ? err.message : String(err);
        result.errors.push(`label ${id}: ${m}`);
      }

      // Draft.
      let draftId: string | null = null;
      if (classification.draft_reply && parsed.from_email) {
        try {
          const fromAlias = parsed.delivered_to || acct.email_address;
          const messageIdHeader = headerValue(msg.payload?.headers, "Message-Id");
          const replySubject = parsed.subject || "(no subject)";
          const draft = await createGmailDraft(accessToken, {
            threadId: parsed.threadId,
            to: parsed.from_email,
            from: fromAlias,
            inReplyToMessageId: messageIdHeader || undefined,
            subject: replySubject,
            body: classification.draft_reply,
          });
          draftId = draft.id;
          result.drafted++;
        } catch (err) {
          const m = err instanceof Error ? err.message : String(err);
          result.errors.push(`draft ${id}: ${m}`);
        }
      }

      // Persist classification + artifact ids.
      await supabaseAdmin
        .from("wren_messages")
        .update({
          category: classification.category,
          priority: classification.priority,
          reasoning: classification.reasoning,
          suggested_action: classification.suggested_action,
          draft_reply: classification.draft_reply || null,
          matched_client_id: matched?.id ?? null,
          classified_at: new Date().toISOString(),
          classify_model: MODEL_NAME,
          gmail_label_id: labelId,
          gmail_draft_id: draftId,
          status: "classified",
          updated_at: new Date().toISOString(),
        })
        .eq("id", inserted.id);
    } catch (err) {
      const m = err instanceof Error ? err.message : String(err);
      result.errors.push(`${id}: ${m}`);
    }
  }

  await supabaseAdmin
    .from("wren_inbox_accounts")
    .update({
      last_polled_at: new Date().toISOString(),
      last_poll_error: result.errors.length ? result.errors.slice(0, 3).join(" | ").slice(0, 500) : null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", acct.id);

  if (result.fetched || result.errors.length) {
    await logEvent({
      category: "wren",
      level: result.errors.length ? "warn" : "info",
      message: `Wren poll ${acct.email_address}: ${result.fetched} new, ${result.classified} classified, ${result.drafted} drafted, ${result.skipped} skipped, ${result.errors.length} errors`,
      metadata: { account_id: acct.id, errors: result.errors.slice(0, 5) },
    });
  }

  return result;
}

export async function pollAllActiveAccounts(): Promise<PollResult[]> {
  const { data: accounts } = await supabaseAdmin
    .from("wren_inbox_accounts")
    .select("id")
    .eq("status", "active");
  const results: PollResult[] = [];
  for (const a of accounts ?? []) results.push(await pollAccount(a.id));
  return results;
}

// ─── helpers (parallel to lib/iris/poll.ts) ───────────────────────────────

async function ensureFreshToken(acct: AccountRow): Promise<string> {
  const expiresAt = new Date(acct.token_expires_at).getTime();
  if (Date.now() < expiresAt - 60_000) return acct.access_token;
  const refreshed = await refreshGoogleToken(acct.refresh_token);
  const newExpires = new Date(Date.now() + refreshed.expires_in * 1000).toISOString();
  await supabaseAdmin
    .from("wren_inbox_accounts")
    .update({
      access_token: refreshed.access_token,
      token_expires_at: newExpires,
      ...(refreshed.refresh_token ? { refresh_token: refreshed.refresh_token } : {}),
      updated_at: new Date().toISOString(),
    })
    .eq("id", acct.id);
  return refreshed.access_token;
}

function shouldIgnore(p: ParsedMessage, patterns: string[]): boolean {
  if (!p.from_email) return true;
  const from = p.from_email.toLowerCase();
  for (const pat of patterns) {
    if (!pat) continue;
    if (from.includes(pat.toLowerCase())) return true;
  }
  return false;
}

async function insertMessage(accountId: string, p: ParsedMessage): Promise<{ id: string } | null> {
  const { data, error } = await supabaseAdmin
    .from("wren_messages")
    .insert({
      account_id: accountId,
      gmail_message_id: p.id,
      gmail_thread_id: p.threadId,
      from_email: p.from_email,
      from_name: p.from_name,
      to_addresses: p.to_addresses,
      delivered_to: p.delivered_to,
      subject: p.subject,
      snippet: p.snippet,
      received_at: p.received_at,
      body_text: p.body_text || null,
      body_html: p.body_html || null,
      status: "new",
    })
    .select("id")
    .single<{ id: string }>();
  if (error) {
    if (error.code === "23505") return null; // duplicate from a concurrent poll — fine
    throw new Error(`insert ${p.id}: ${error.message}`);
  }
  return data ?? null;
}

async function markIgnored(messageId: string, reason: string): Promise<void> {
  await supabaseAdmin
    .from("wren_messages")
    .update({
      category: "spam",
      priority: "low",
      reasoning: reason,
      suggested_action: "Archive — auto-ignored",
      status: "classified",
      classified_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", messageId);
}

async function markClassifyError(messageId: string, error: string): Promise<void> {
  await supabaseAdmin
    .from("wren_messages")
    .update({ classify_error: error.slice(0, 1000), updated_at: new Date().toISOString() })
    .eq("id", messageId);
}

async function markPollError(accountId: string, error: string): Promise<void> {
  await supabaseAdmin
    .from("wren_inbox_accounts")
    .update({
      last_polled_at: new Date().toISOString(),
      last_poll_error: error.slice(0, 500),
      updated_at: new Date().toISOString(),
    })
    .eq("id", accountId);
}

function headerValue(headers: { name: string; value: string }[] | undefined, name: string): string {
  return headers?.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value ?? "";
}
