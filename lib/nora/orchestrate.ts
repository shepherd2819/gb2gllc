import type Stripe from "stripe";
import { supabaseAdmin } from "@/lib/supabase";
import { logEvent } from "@/lib/logger";
import { fetchMetrics, getCustomer, stripeFor } from "./stripe";
import { classifyStripeEvent, type Classified } from "./classify";
import { draftDunning, DUNNING_MODEL_NAME } from "./dunning";
import { writeWeeklyDigest } from "./digest";
import { sendAlertEmail, sendDunningEmail, sendDigestEmail } from "./email";
import { getStripeSecretOrThrow } from "./env";

const ADMIN_EMAIL = process.env.ADMIN_EMAIL ?? "john@gb2gllc.com";

// ─── Single Stripe event → Nora event row (+ alert email + dunning draft) ──
// Called from both the webhook (real-time) and the nightly reconciliation
// poll. Idempotent on stripe_event_id.
export async function processStripeEvent(accountId: string, stripeEvent: Stripe.Event): Promise<{ ok: true; event_id: string; created: boolean } | { ok: false; error: string }> {
  // Already processed? (webhook retries are common)
  const { data: existing } = await supabaseAdmin
    .from("nora_events")
    .select("id")
    .eq("account_id", accountId)
    .eq("stripe_event_id", stripeEvent.id)
    .maybeSingle();
  if (existing) return { ok: true, event_id: existing.id, created: false };

  const { data: acct } = await supabaseAdmin
    .from("nora_accounts")
    .select("id, livemode")
    .eq("id", accountId)
    .single();
  if (!acct) return { ok: false, error: "account not found" };

  const stripeKey = getStripeSecretOrThrow();
  const cls = classifyStripeEvent(stripeEvent);

  // Enrich customer info (the event payload sometimes doesn't include the email)
  let customerEmail: string | null = null;
  let customerName: string | null = null;
  if (cls.stripe_customer_id) {
    const c = await getCustomer(stripeKey, cls.stripe_customer_id);
    if (c) { customerEmail = c.email; customerName = c.name; }
  }
  // Some events (invoice.*) include customer_email directly on the payload
  if (!customerEmail) {
    const inv = stripeEvent.data.object as { customer_email?: string };
    if (inv.customer_email) customerEmail = inv.customer_email;
  }

  // Insert the event row (status='new')
  const { data: inserted, error: insErr } = await supabaseAdmin
    .from("nora_events")
    .insert({
      account_id: accountId,
      stripe_event_id: stripeEvent.id,
      stripe_event_type: stripeEvent.type,
      stripe_object_id: cls.stripe_object_id,
      stripe_customer_id: cls.stripe_customer_id,
      customer_email: customerEmail,
      customer_name: customerName,
      amount_cents: cls.amount_cents,
      currency: cls.currency,
      category: cls.category,
      severity: cls.severity,
      summary: cls.summary,
      payload_json: stripeEvent as unknown as object,
      status: "new",
    })
    .select("id")
    .single();
  if (insErr || !inserted) {
    if (insErr?.code === "23505") return { ok: true, event_id: "", created: false };  // race
    return { ok: false, error: `insert: ${insErr?.message}` };
  }

  // Load settings (defaults if missing)
  const { data: settingsRow } = await supabaseAdmin
    .from("nora_settings").select("*").eq("account_id", accountId).maybeSingle();
  const settings = settingsRow ?? defaultSettings(accountId);

  // Draft dunning email if applicable
  let draftPatch: Record<string, unknown> = {};
  if (cls.should_draft_dunning && settings.dunning_enabled && customerEmail) {
    try {
      const inv = stripeEvent.data.object as { hosted_invoice_url?: string };
      const draft = await draftDunning({
        classified: cls,
        customer: { name: customerName, email: customerEmail },
        business_name: "GB2GLLC",
        voice_notes: settings.dunning_voice_notes,
        signature: settings.dunning_signature,
        invoice_hosted_url: inv.hosted_invoice_url ?? null,
      });
      draftPatch = {
        draft_to_email: draft.to,
        draft_subject: draft.subject,
        draft_body: draft.body,
        draft_model: DUNNING_MODEL_NAME,
        drafted_at: new Date().toISOString(),
        draft_error: null,
      };
    } catch (err) {
      draftPatch = { draft_error: (err instanceof Error ? err.message : String(err)).slice(0, 1000) };
    }
  }

  // Send "alert me" email to admin if this category is in the urgent list
  let alertPatch: Record<string, unknown> = {};
  const deliveryTo = settings.delivery_email || ADMIN_EMAIL;
  if (settings.urgent_alert_categories.includes(cls.category)) {
    const link = stripeDashboardLink(acct.livemode, cls.stripe_object_id);
    const detail = `${cls.summary}${customerEmail ? `\n\nCustomer: ${customerName ? `${customerName} <${customerEmail}>` : customerEmail}` : ""}${draftPatch.draft_subject ? `\n\nNora drafted a reply you can review and send from the dashboard.` : ""}`;
    const send = await sendAlertEmail({
      to: deliveryTo,
      subject: `Nora · ${cls.severity.toUpperCase()} · ${truncate(cls.summary, 80)}`,
      summary: cls.summary,
      detail,
      link_label: draftPatch.draft_subject ? "Review draft" : "View in Nora",
      link_url: noraEventUrl(inserted.id),
      severity: cls.severity,
    });
    if (send.ok) {
      alertPatch = { alert_email_id: send.id, alert_sent_at: new Date().toISOString() };
    }
    // Also keep the Stripe dashboard link in the body, just appended to detail.
    if (link) alertPatch = { ...alertPatch, /* link tracking only */ };
  }

  await supabaseAdmin
    .from("nora_events")
    .update({
      ...draftPatch,
      ...alertPatch,
      status: "classified",
      updated_at: new Date().toISOString(),
    })
    .eq("id", inserted.id);

  await logEvent({
    category: "nora",
    level: cls.severity === "critical" ? "warn" : "info",
    message: `Nora event ${cls.category} (${cls.severity}): ${truncate(cls.summary, 120)}`,
    metadata: { account_id: accountId, stripe_event_id: stripeEvent.id, stripe_type: stripeEvent.type },
  });

  return { ok: true, event_id: inserted.id, created: true };
}

// ─── Nightly reconciliation: catch anything the webhook missed ──────────
export async function nightlyReconcile(accountId: string): Promise<{ scanned: number; new_events: number; errors: string[] }> {
  const { data: acct } = await supabaseAdmin
    .from("nora_accounts").select("id").eq("id", accountId).single();
  if (!acct) return { scanned: 0, new_events: 0, errors: ["account not found"] };

  let stripeKey: string;
  try { stripeKey = getStripeSecretOrThrow(); }
  catch (err) { return { scanned: 0, new_events: 0, errors: [err instanceof Error ? err.message : String(err)] }; }
  const s = stripeFor(stripeKey);
  const since = Math.floor(Date.now() / 1000) - 36 * 3600;     // 36-hour lookback
  let scanned = 0, newEvents = 0;
  const errors: string[] = [];

  const types = [
    "invoice.payment_failed",
    "customer.subscription.deleted",
    "customer.subscription.updated",
    "charge.failed",
    "charge.dispute.created",
    "charge.refunded",
    "payout.failed",
    "customer.subscription.created",
  ];

  try {
    for await (const ev of s.events.list({ created: { gte: since }, types, limit: 100 } as Stripe.EventListParams)) {
      scanned++;
      const r = await processStripeEvent(accountId, ev);
      if (r.ok && r.created) newEvents++;
      if (!r.ok) errors.push(r.error);
    }
  } catch (err) {
    errors.push(err instanceof Error ? err.message : String(err));
  }
  return { scanned, new_events: newEvents, errors };
}

// ─── Weekly digest ──────────────────────────────────────────────────────
export async function maybeSendWeeklyDigest(accountId: string, opts?: { force?: boolean }): Promise<{ sent: boolean; reason?: string }> {
  const { data: acct } = await supabaseAdmin
    .from("nora_accounts").select("*").eq("id", accountId).single();
  if (!acct) return { sent: false, reason: "no account" };
  const { data: settings } = await supabaseAdmin
    .from("nora_settings").select("*").eq("account_id", accountId).maybeSingle();
  const s = settings ?? defaultSettings(accountId);

  if (!s.weekly_digest_enabled && !opts?.force) return { sent: false, reason: "digest disabled" };

  if (!opts?.force) {
    // Time check
    const tz = s.timezone || "UTC";
    const now = new Date();
    const localDow = Number(new Intl.DateTimeFormat("en-US", { weekday: "long", timeZone: tz }).format(now));   // not numeric — see below
    // Better: build local date and pull day-of-week from its UTC components after offset adjust
    const fmt = new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hour12: false, weekday: undefined, timeZone: tz });
    const parts = fmt.formatToParts(now);
    const year  = Number(parts.find((p) => p.type === "year")?.value);
    const month = Number(parts.find((p) => p.type === "month")?.value);
    const day   = Number(parts.find((p) => p.type === "day")?.value);
    const hour  = Number(parts.find((p) => p.type === "hour")?.value);
    const dow = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
    if (dow !== s.weekly_digest_dow) return { sent: false, reason: `not digest day (today ${dow}, target ${s.weekly_digest_dow})` };
    if (hour !== s.weekly_digest_local_hour) return { sent: false, reason: `not digest hour (local ${hour}, target ${s.weekly_digest_local_hour})` };

    // Already sent this week?
    const { data: recent } = await supabaseAdmin
      .from("nora_digests")
      .select("sent_at")
      .eq("account_id", accountId)
      .not("sent_at", "is", null)
      .gte("sent_at", new Date(Date.now() - 6 * 86400_000).toISOString())
      .limit(1);
    if (recent && recent.length > 0) return { sent: false, reason: "already sent this week" };
    // unused alias suppression for the formatLocale dow variable
    void localDow;
  }

  // Fetch metrics
  let metrics;
  try {
    const stripeKey = getStripeSecretOrThrow();
    metrics = await fetchMetrics(stripeKey);
  }
  catch (err) { return { sent: false, reason: `metrics fetch failed: ${err instanceof Error ? err.message : String(err)}` }; }

  // Pull previous digest's metrics for week-over-week
  const { data: prevDigest } = await supabaseAdmin
    .from("nora_digests").select("metrics_json").eq("account_id", accountId).order("created_at", { ascending: false }).limit(1);
  const prevMetrics = prevDigest && prevDigest.length > 0 ? prevDigest[0].metrics_json : null;

  const periodEnd = new Date();
  const periodStart = new Date(periodEnd.getTime() - 7 * 86400_000);

  const markdown = await writeWeeklyDigest({
    metrics,
    prev_metrics: prevMetrics,
    monthly_burn_cents: s.monthly_burn_cents ?? null,
    business_name: "GB2GLLC",
    voice_notes: s.dunning_voice_notes,         // reuse the same voice notes for tone
    period_start: periodStart.toISOString(),
    period_end: periodEnd.toISOString(),
  });

  const to = s.delivery_email || ADMIN_EMAIL;
  const send = await sendDigestEmail({
    to,
    subject: `Nora · weekly cash digest (${periodEnd.toLocaleDateString("en-US", { month: "short", day: "numeric" })})`,
    markdown,
  });

  await supabaseAdmin.from("nora_digests").insert({
    account_id: accountId,
    period_start: periodStart.toISOString(),
    period_end: periodEnd.toISOString(),
    metrics_json: metrics,
    markdown,
    sent_at: send.ok ? new Date().toISOString() : null,
    resend_id: send.ok ? send.id : null,
    send_error: send.ok ? null : send.error.slice(0, 1000),
  });

  // Update account metrics cache too
  await supabaseAdmin.from("nora_accounts").update({
    last_metrics_json: metrics,
    last_metrics_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }).eq("id", accountId);

  return send.ok ? { sent: true } : { sent: false, reason: send.error };
}

// ─── Send a drafted dunning email (admin clicked Send) ──────────────────
export async function sendDraftedDunning(eventId: string): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const { data: ev } = await supabaseAdmin
    .from("nora_events")
    .select("id, draft_to_email, draft_subject, draft_body, status")
    .eq("id", eventId)
    .single();
  if (!ev) return { ok: false, error: "not found" };
  if (!ev.draft_to_email || !ev.draft_body) return { ok: false, error: "no draft" };
  if (ev.status === "sent") return { ok: false, error: "already sent" };

  const send = await sendDunningEmail({
    to: ev.draft_to_email,
    subject: ev.draft_subject ?? "About your recent payment",
    body: ev.draft_body,
  });
  if (!send.ok) return send;

  await supabaseAdmin.from("nora_events").update({
    status: "sent",
    sent_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }).eq("id", eventId);
  return send;
}

// ─── Run nightly + digest pass for all active accounts ──────────────────
export async function runNoraForAllActive(): Promise<{ accounts: number; new_events: number; digests_sent: number; errors: string[] }> {
  const { data: accounts } = await supabaseAdmin.from("nora_accounts").select("id").eq("status", "active");
  let newEvents = 0, digests = 0;
  const errors: string[] = [];
  for (const a of accounts ?? []) {
    const recon = await nightlyReconcile(a.id);
    newEvents += recon.new_events;
    errors.push(...recon.errors.map((e) => `${a.id}: ${e}`));

    // Refresh metrics cache for the dashboard
    try {
      const m = await fetchMetrics(getStripeSecretOrThrow());
      await supabaseAdmin.from("nora_accounts").update({ last_metrics_json: m, last_metrics_at: new Date().toISOString() }).eq("id", a.id);
    } catch (err) { errors.push(`${a.id}: metrics: ${err instanceof Error ? err.message : String(err)}`); }

    const d = await maybeSendWeeklyDigest(a.id);
    if (d.sent) digests++;
  }
  return { accounts: accounts?.length ?? 0, new_events: newEvents, digests_sent: digests, errors };
}

// ─── Helpers ────────────────────────────────────────────────────────────
const ADMIN_URL = process.env.NEXT_PUBLIC_ADMIN_URL ?? "https://admin.gb2gllc.com";

function noraEventUrl(eventId: string): string { return `${ADMIN_URL}/agents/nora?event=${eventId}`; }

function stripeDashboardLink(livemode: boolean, objId: string | null): string | null {
  if (!objId) return null;
  const base = livemode ? "https://dashboard.stripe.com" : "https://dashboard.stripe.com/test";
  if (objId.startsWith("in_"))  return `${base}/invoices/${objId}`;
  if (objId.startsWith("ch_"))  return `${base}/payments/${objId}`;
  if (objId.startsWith("sub_")) return `${base}/subscriptions/${objId}`;
  if (objId.startsWith("dp_") || objId.startsWith("du_")) return `${base}/disputes/${objId}`;
  if (objId.startsWith("po_"))  return `${base}/payouts/${objId}`;
  return null;
}

function truncate(s: string, n: number): string { return s.length <= n ? s : s.slice(0, n - 1) + "…"; }

type SettingsRow = {
  account_id: string;
  dunning_enabled: boolean;
  dunning_voice_notes: string | null;
  dunning_signature: string | null;
  urgent_alert_categories: string[];
  delivery_email: string | null;
  weekly_digest_enabled: boolean;
  weekly_digest_dow: number;
  weekly_digest_local_hour: number;
  timezone: string;
  monthly_burn_cents: number | null;
};

function defaultSettings(accountId: string): SettingsRow {
  return {
    account_id: accountId,
    dunning_enabled: true,
    dunning_voice_notes: null,
    dunning_signature: null,
    urgent_alert_categories: ["payment_failed", "charge_disputed", "payout_failed"],
    delivery_email: null,
    weekly_digest_enabled: true,
    weekly_digest_dow: 1,
    weekly_digest_local_hour: 8,
    timezone: "America/Chicago",
    monthly_burn_cents: null,
  };
}

export type { Classified };
