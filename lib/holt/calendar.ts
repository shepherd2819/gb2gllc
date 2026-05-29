// Google Calendar API helpers for Holt.
//
// Read-only: we only ever list + get events. No create/update/delete.
// OAuth scope: calendar.readonly + userinfo + openid (see oauth route).

const CALENDAR_API = "https://www.googleapis.com/calendar/v3";

export const HOLT_GOOGLE_SCOPES = [
  "https://www.googleapis.com/auth/calendar.readonly",
  "https://www.googleapis.com/auth/calendar.settings.readonly",
  "https://www.googleapis.com/auth/userinfo.email",
  "https://www.googleapis.com/auth/userinfo.profile",
  "openid",
];

// ─── Settings: timezone ─────────────────────────────────────────────────
// We use the user's Google Calendar timezone to decide *when* (local time)
// to send the evening digest.
export async function getCalendarTimezone(accessToken: string): Promise<string | null> {
  const res = await fetch(`${CALENDAR_API}/users/me/settings/timezone`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) return null;
  const json = await res.json().catch(() => ({}));
  return typeof json.value === "string" ? json.value : null;
}

// ─── Events ─────────────────────────────────────────────────────────────
export type CalendarAttendee = {
  email: string;
  displayName?: string;
  organizer?: boolean;
  self?: boolean;
  responseStatus?: "needsAction" | "declined" | "tentative" | "accepted";
  optional?: boolean;
};

export type CalendarEvent = {
  id: string;
  status?: string;                        // confirmed / tentative / cancelled
  summary?: string;
  description?: string;
  location?: string;
  start: { dateTime?: string; date?: string; timeZone?: string };
  end:   { dateTime?: string; date?: string; timeZone?: string };
  organizer?: { email?: string; self?: boolean };
  creator?: { email?: string };
  attendees?: CalendarAttendee[];
  hangoutLink?: string;
  conferenceData?: unknown;
  recurringEventId?: string;
};

// List confirmed events in [timeMin, timeMax] from the user's primary calendar.
// `singleEvents=true` expands recurring events into instances so each meeting
// becomes its own row in holt_briefings.
export async function listCalendarEvents(
  accessToken: string,
  opts: { timeMin: string; timeMax: string; maxResults?: number }
): Promise<CalendarEvent[]> {
  const params = new URLSearchParams({
    timeMin: opts.timeMin,
    timeMax: opts.timeMax,
    singleEvents: "true",
    orderBy: "startTime",
    maxResults: String(opts.maxResults ?? 50),
    showDeleted: "false",
  });
  const url = `${CALENDAR_API}/calendars/primary/events?${params.toString()}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!res.ok) throw new Error(`Calendar events.list ${res.status}: ${await res.text()}`);
  const json = await res.json();
  const items: CalendarEvent[] = Array.isArray(json.items) ? json.items : [];
  return items.filter((e) => e.status !== "cancelled");
}

// ─── Classification: is this brief-worthy? ──────────────────────────────
export type AttendeeClassification = {
  decision: "briefable" | "skipped_internal" | "skipped_solo" | "skipped_declined";
  external_attendees: { email: string; name: string | null; company: string | null }[];
};

export function classifyAttendees(
  event: CalendarEvent,
  selfEmail: string,
  internalDomains: string[]
): AttendeeClassification {
  // User declined the event entirely → no brief
  const selfAttendee = event.attendees?.find((a) => a.self || a.email.toLowerCase() === selfEmail.toLowerCase());
  if (selfAttendee?.responseStatus === "declined") {
    return { decision: "skipped_declined", external_attendees: [] };
  }

  // No attendees or only-self → focus block
  const others = (event.attendees ?? []).filter((a) => !a.self && a.email.toLowerCase() !== selfEmail.toLowerCase());
  if (others.length === 0) {
    return { decision: "skipped_solo", external_attendees: [] };
  }

  const internal = new Set(internalDomains.map((d) => d.toLowerCase().replace(/^@/, "")));
  const externals = others
    .filter((a) => a.responseStatus !== "declined")
    .filter((a) => {
      const dom = (a.email.split("@")[1] ?? "").toLowerCase();
      return !internal.has(dom);
    })
    .map((a) => ({
      email: a.email.toLowerCase(),
      name: a.displayName ?? null,
      company: companyFromEmail(a.email),
    }));

  if (externals.length === 0) {
    return { decision: "skipped_internal", external_attendees: [] };
  }
  return { decision: "briefable", external_attendees: externals };
}

// "marketing@acme.com" → "acme" (loose — used as a research hint, not authoritative)
function companyFromEmail(email: string): string | null {
  const host = email.split("@")[1]?.toLowerCase() ?? "";
  if (!host) return null;
  // strip common public-mail hosts; for those we have no company signal
  if (["gmail.com", "yahoo.com", "outlook.com", "hotmail.com", "icloud.com", "proton.me", "protonmail.com"].includes(host)) return null;
  const root = host.replace(/\.(com|net|org|io|co|ai|app|dev|so|xyz|us|uk|ca|de)$/i, "").split(".").pop();
  return root ? root.charAt(0).toUpperCase() + root.slice(1) : null;
}

// ─── Event helpers ──────────────────────────────────────────────────────
export function eventStartIso(e: CalendarEvent): string | null {
  return e.start.dateTime ?? (e.start.date ? new Date(`${e.start.date}T00:00:00Z`).toISOString() : null);
}
export function eventEndIso(e: CalendarEvent): string | null {
  return e.end.dateTime ?? (e.end.date ? new Date(`${e.end.date}T00:00:00Z`).toISOString() : null);
}
