import { supabaseAdmin } from "@/lib/supabase";
import { logEvent } from "@/lib/logger";
import { refreshGoogleToken } from "@/lib/gmail";
import {
  listCalendarEvents,
  classifyAttendees,
  eventStartIso,
  eventEndIso,
  type CalendarEvent,
  type AttendeeClassification,
} from "./calendar";
import { getPriorThreads, researchAttendee } from "./research";
import { writeBriefing, writeEveningDigest, BRIEF_MODEL_NAME } from "./brief";
import { sendBriefingEmail } from "./email";

// Look 16h ahead so we always catch tomorrow's evening-digest window and the
// 2h-before window for every meeting in the next 14h.
const HORIZON_HOURS = 16;
const MAX_EVENTS_PER_POLL = 50;

export type AccountRow = {
  id: string;
  workos_user_id: string;
  email_address: string;
  access_token: string;
  refresh_token: string;
  token_expires_at: string;
  timezone: string | null;
  status: "active" | "paused" | "revoked";
};

export type SettingsRow = {
  account_id: string;
  internal_domains: string[];
  evening_digest_enabled: boolean;
  evening_digest_local_hour: number;
  prebrief_minutes_before: number;
  enable_web_research: boolean;
  voice_notes: string | null;
  delivery_email: string | null;
};

export type OrchestrateResult = {
  account_id: string;
  email: string;
  events_scanned: number;
  briefable_new: number;
  prebriefs_sent: number;
  evening_digests_sent: number;
  errors: string[];
};

// ─── Single account orchestration ─────────────────────────────────────────
export async function runHoltForAccount(accountId: string, opts?: { force?: boolean }): Promise<OrchestrateResult> {
  const { data: acct } = await supabaseAdmin
    .from("holt_accounts")
    .select("*")
    .eq("id", accountId)
    .single<AccountRow>();

  if (!acct) return { account_id: accountId, email: "", events_scanned: 0, briefable_new: 0, prebriefs_sent: 0, evening_digests_sent: 0, errors: ["account not found"] };
  if (acct.status !== "active" && !opts?.force) return { account_id: acct.id, email: acct.email_address, events_scanned: 0, briefable_new: 0, prebriefs_sent: 0, evening_digests_sent: 0, errors: [`status=${acct.status}`] };

  const result: OrchestrateResult = {
    account_id: acct.id, email: acct.email_address,
    events_scanned: 0, briefable_new: 0, prebriefs_sent: 0, evening_digests_sent: 0, errors: [],
  };

  // Token
  let accessToken: string;
  try { accessToken = await ensureFreshToken(acct); }
  catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await markPollError(acct.id, `token refresh: ${msg}`);
    result.errors.push(`token refresh: ${msg}`);
    return result;
  }

  // Settings
  const { data: settingsRow } = await supabaseAdmin
    .from("holt_settings").select("*").eq("account_id", acct.id).maybeSingle<SettingsRow>();
  const settings: SettingsRow = settingsRow ?? defaultSettings(acct);

  // 1. Pull upcoming events
  const now = new Date();
  const timeMin = now.toISOString();
  const timeMax = new Date(now.getTime() + HORIZON_HOURS * 3600_000).toISOString();
  let events: CalendarEvent[];
  try { events = await listCalendarEvents(accessToken, { timeMin, timeMax, maxResults: MAX_EVENTS_PER_POLL }); }
  catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await markPollError(acct.id, `events.list: ${msg}`);
    result.errors.push(`events.list: ${msg}`);
    return result;
  }
  result.events_scanned = events.length;

  // 2. Classify + upsert each event into holt_briefings (cheap; no LLM yet)
  for (const ev of events) {
    const startIso = eventStartIso(ev);
    if (!startIso) continue;
    const endIso = eventEndIso(ev);
    const cls = classifyAttendees(ev, acct.email_address, settings.internal_domains.length ? settings.internal_domains : domainOf(acct.email_address));

    const wasNew = await upsertBriefingRow(acct.id, ev, startIso, endIso, cls);
    if (wasNew && cls.decision === "briefable") result.briefable_new++;
  }

  // 3. Decide which briefings are due to send and process them.
  //
  //    Prebrief: when current time is within `prebrief_minutes_before` of event start
  //    and we haven't sent a prebrief yet.
  //
  //    Evening digest: once per day, at evening_digest_local_hour, sent if we
  //    have at least one briefable meeting *tomorrow*.
  await runPrebriefs(acct, settings, accessToken, result);
  await runEveningDigest(acct, settings, result);

  // Update poll cursor
  await supabaseAdmin.from("holt_accounts").update({
    last_polled_at: new Date().toISOString(),
    last_poll_error: result.errors.length ? result.errors.slice(0, 3).join(" | ").slice(0, 500) : null,
    updated_at: new Date().toISOString(),
  }).eq("id", acct.id);

  if (result.events_scanned || result.errors.length || result.prebriefs_sent || result.evening_digests_sent) {
    await logEvent({
      category: "holt", level: result.errors.length ? "warn" : "info",
      message: `Holt run ${acct.email_address}: ${result.events_scanned} events, ${result.briefable_new} new briefable, ${result.prebriefs_sent} prebriefs sent, ${result.evening_digests_sent} digests sent, ${result.errors.length} errors`,
      metadata: { account_id: acct.id, errors: result.errors.slice(0, 5) },
    });
  }

  return result;
}

// ─── All-account orchestration (cron entry) ────────────────────────────
export async function runHoltForAllActive(): Promise<OrchestrateResult[]> {
  const { data: accounts } = await supabaseAdmin.from("holt_accounts").select("id").eq("status", "active");
  const out: OrchestrateResult[] = [];
  for (const a of accounts ?? []) out.push(await runHoltForAccount(a.id));
  return out;
}

// ─── Prebriefs: per-meeting deep brief ────────────────────────────────
async function runPrebriefs(acct: AccountRow, settings: SettingsRow, _accessToken: string, result: OrchestrateResult) {
  const now = Date.now();
  const windowEnd = new Date(now + settings.prebrief_minutes_before * 60_000).toISOString();
  const { data: due } = await supabaseAdmin
    .from("holt_briefings")
    .select("*")
    .eq("account_id", acct.id)
    .eq("decision", "briefable")
    .is("prebrief_sent_at", null)
    .lte("event_start_at", windowEnd)
    .gt("event_start_at", new Date(now).toISOString())  // skip past-due
    .order("event_start_at", { ascending: true })
    .limit(10);                                          // sanity cap per run

  for (const row of due ?? []) {
    try {
      await buildAndSendPrebrief(acct, settings, row);
      result.prebriefs_sent++;
    } catch (err) {
      const m = err instanceof Error ? err.message : String(err);
      result.errors.push(`prebrief ${row.id}: ${m}`);
      await supabaseAdmin.from("holt_briefings").update({
        generate_error: m.slice(0, 1000), updated_at: new Date().toISOString(),
      }).eq("id", row.id);
    }
  }
}

async function buildAndSendPrebrief(acct: AccountRow, settings: SettingsRow, row: HoltBriefingRow) {
  const externals: { email: string; name: string | null; company: string | null }[] = Array.isArray(row.external_attendees) ? row.external_attendees : [];

  // Research each attendee + pull their prior threads
  const attendeePackets = await Promise.all(externals.map(async (a) => {
    const [research, prior_threads] = await Promise.all([
      researchAttendee({
        email: a.email, name: a.name, companyHint: a.company,
        webSearchEnabled: settings.enable_web_research,
      }),
      getPriorThreads(acct.workos_user_id, a.email, 5),
    ]);
    return { research, prior_threads };
  }));

  const markdown = await writeBriefing({
    event: {
      summary: row.event_summary ?? "(no title)",
      start_at: row.event_start_at,
      end_at: row.event_end_at,
      location: row.event_location,
      description: row.event_description,
      timezone: acct.timezone,
    },
    attendees: attendeePackets,
    voice_notes: settings.voice_notes,
    user_name: null,
  });

  // Flatten sources
  const sources = attendeePackets.flatMap((p) => p.research.sources).slice(0, 10);

  const to = settings.delivery_email || acct.email_address;
  const subject = `Holt · prep for ${row.event_summary || "your meeting"}`;
  const send = await sendBriefingEmail({ to, subject, markdownBody: markdown, sources });

  await supabaseAdmin.from("holt_briefings").update({
    briefing_markdown: markdown,
    research_json: { attendees: attendeePackets.map((p) => ({ email: p.research.email, research: p.research, prior_count: p.prior_threads.length })) },
    generated_at: new Date().toISOString(),
    generate_model: BRIEF_MODEL_NAME,
    generate_error: send.ok ? null : send.error.slice(0, 1000),
    prebrief_sent_at: send.ok ? new Date().toISOString() : null,
    resend_email_id: send.ok ? send.id : null,
    updated_at: new Date().toISOString(),
  }).eq("id", row.id);

  if (!send.ok) throw new Error(`email send: ${send.error}`);
}

// ─── Evening digest ─────────────────────────────────────────────────────
async function runEveningDigest(acct: AccountRow, settings: SettingsRow, result: OrchestrateResult) {
  if (!settings.evening_digest_enabled) return;

  // Are we in the local-time hour to send? Use the account timezone if known.
  const tz = acct.timezone ?? "UTC";
  const nowLocalHour = Number(new Intl.DateTimeFormat("en-US", { hour: "numeric", hour12: false, timeZone: tz }).format(new Date()));
  if (nowLocalHour !== settings.evening_digest_local_hour) return;

  // Bucket today's local date — used as the "digest day" to avoid resending in the same hour.
  const todayLocal = new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "numeric", timeZone: tz }).format(new Date());

  // Have we already sent a digest today? We mark digests on the *first* tomorrow-briefing
  // we touch (evening_sent_at on the row). Use a marker row in holt_briefings or a
  // separate table? Simpler: store the digest's "last sent local date" on the account.
  // We'll re-use last_poll_error column? No — add a quick heuristic: query if ANY
  // briefing has evening_sent_at within the last 6 hours.
  const { data: recent } = await supabaseAdmin
    .from("holt_briefings")
    .select("evening_sent_at")
    .eq("account_id", acct.id)
    .not("evening_sent_at", "is", null)
    .gte("evening_sent_at", new Date(Date.now() - 6 * 3600_000).toISOString())
    .limit(1);
  if (recent && recent.length > 0) return;             // already sent today

  // Find tomorrow's briefable meetings (in the account's local "tomorrow")
  const tomorrowStartUtc = startOfTomorrowUtc(tz);
  const tomorrowEndUtc = new Date(tomorrowStartUtc.getTime() + 24 * 3600_000);
  const { data: tomorrowBriefs } = await supabaseAdmin
    .from("holt_briefings")
    .select("id, event_summary, event_start_at, external_attendees")
    .eq("account_id", acct.id)
    .eq("decision", "briefable")
    .gte("event_start_at", tomorrowStartUtc.toISOString())
    .lt("event_start_at", tomorrowEndUtc.toISOString())
    .order("event_start_at", { ascending: true });

  if (!tomorrowBriefs || tomorrowBriefs.length === 0) return;

  const meetings = tomorrowBriefs.map((b: { event_summary: string | null; event_start_at: string; external_attendees: unknown }) => {
    const externals = Array.isArray(b.external_attendees) ? (b.external_attendees as { email: string; name: string | null }[]) : [];
    const short = externals.slice(0, 3).map((a) => a.name ?? a.email).join(", ") + (externals.length > 3 ? ` +${externals.length - 3}` : "");
    return {
      summary: b.event_summary ?? "(no title)",
      start_at: b.event_start_at,
      timezone: tz,
      attendees_short: short,
    };
  });

  const md = await writeEveningDigest({ meetings, user_name: null, voice_notes: settings.voice_notes });

  const to = settings.delivery_email || acct.email_address;
  const subject = `Holt · ${meetings.length} external meeting${meetings.length === 1 ? "" : "s"} tomorrow (${todayLocal})`;
  const send = await sendBriefingEmail({ to, subject, markdownBody: md });
  if (!send.ok) { result.errors.push(`evening digest: ${send.error}`); return; }

  // Mark all of tomorrow's briefable rows with evening_sent_at so we don't resend
  await supabaseAdmin.from("holt_briefings").update({
    evening_sent_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }).in("id", tomorrowBriefs.map((b: { id: string }) => b.id));

  result.evening_digests_sent++;
}

// ─── Helpers ────────────────────────────────────────────────────────────
type HoltBriefingRow = {
  id: string;
  account_id: string;
  event_summary: string | null;
  event_description: string | null;
  event_location: string | null;
  event_start_at: string;
  event_end_at: string | null;
  external_attendees: { email: string; name: string | null; company: string | null }[];
  decision: string;
};

async function upsertBriefingRow(
  accountId: string, ev: CalendarEvent, startIso: string, endIso: string | null, cls: AttendeeClassification
): Promise<boolean> {
  // Was there already a row for this event?
  const { data: existing } = await supabaseAdmin
    .from("holt_briefings")
    .select("id, decision")
    .eq("account_id", accountId)
    .eq("gcal_event_id", ev.id)
    .maybeSingle();

  const payload = {
    account_id: accountId,
    gcal_event_id: ev.id,
    gcal_calendar_id: "primary",
    event_summary: ev.summary ?? null,
    event_description: ev.description ?? null,
    event_location: ev.location ?? null,
    event_start_at: startIso,
    event_end_at: endIso,
    external_attendees: cls.external_attendees,
    decision: cls.decision,
    updated_at: new Date().toISOString(),
  };

  if (!existing) {
    await supabaseAdmin.from("holt_briefings").insert(payload);
    return true;
  }
  await supabaseAdmin.from("holt_briefings").update(payload).eq("id", existing.id);
  return false;
}

async function ensureFreshToken(acct: AccountRow): Promise<string> {
  const expiresAt = new Date(acct.token_expires_at).getTime();
  if (Date.now() < expiresAt - 60_000) return acct.access_token;
  const refreshed = await refreshGoogleToken(acct.refresh_token);
  await supabaseAdmin.from("holt_accounts").update({
    access_token: refreshed.access_token,
    token_expires_at: new Date(Date.now() + refreshed.expires_in * 1000).toISOString(),
    ...(refreshed.refresh_token ? { refresh_token: refreshed.refresh_token } : {}),
    updated_at: new Date().toISOString(),
  }).eq("id", acct.id);
  return refreshed.access_token;
}

async function markPollError(accountId: string, error: string): Promise<void> {
  await supabaseAdmin.from("holt_accounts").update({
    last_polled_at: new Date().toISOString(),
    last_poll_error: error.slice(0, 500),
    updated_at: new Date().toISOString(),
  }).eq("id", accountId);
}

function defaultSettings(acct: AccountRow): SettingsRow {
  return {
    account_id: acct.id,
    internal_domains: domainOf(acct.email_address),
    evening_digest_enabled: true,
    evening_digest_local_hour: 21,
    prebrief_minutes_before: 120,
    enable_web_research: true,
    voice_notes: null,
    delivery_email: null,
  };
}

function domainOf(email: string): string[] {
  const d = email.split("@")[1]?.toLowerCase();
  return d ? [d] : [];
}

// Start of tomorrow in the user's local tz, as a UTC Date.
function startOfTomorrowUtc(tz: string): Date {
  // Get today's date in the tz, add 1 day, then construct UTC for midnight in that tz.
  const fmt = new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "numeric", timeZone: tz });
  const today = fmt.format(new Date());            // YYYY-MM-DD in the tz
  const [y, m, d] = today.split("-").map(Number);
  const tomorrow = new Date(Date.UTC(y, m - 1, d + 1, 0, 0, 0));
  // Adjust for tz offset at that moment
  const offsetMs = getTzOffsetMs(tomorrow, tz);
  return new Date(tomorrow.getTime() - offsetMs);
}

// Approximate tz offset (ms) for a given UTC instant.
function getTzOffsetMs(utcDate: Date, tz: string): number {
  const tzString = new Intl.DateTimeFormat("en-US", {
    timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
  }).format(utcDate);
  // tzString looks like "MM/DD/YYYY, HH:MM:SS"
  const [date, time] = tzString.split(", ");
  const [mm, dd, yyyy] = date.split("/").map(Number);
  const [hh, mi, ss] = time.split(":").map(Number);
  const asLocal = Date.UTC(yyyy, mm - 1, dd, hh, mi, ss);
  return asLocal - utcDate.getTime();
}
