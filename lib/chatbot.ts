// chatbot.com API client for the Herald *product* clients buy (the white-label
// website chatbot). Feeds the weekly digest in lib/herald-digest.ts. Distinct
// from the in-house Herald intake assistant (app/api/herald + lib/anthropic.ts).
const BASE = "https://api.chatbot.com";

function authHeaders() {
  const token = process.env.CHATBOT_API_KEY;
  if (!token) throw new Error("CHATBOT_API_KEY not set");
  return { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
}

async function get<T>(path: string, params?: Record<string, string | number | undefined>): Promise<T> {
  const url = new URL(`${BASE}${path}`);
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== "") url.searchParams.set(k, String(v));
    }
  }
  console.log("[chatbot] GET", url.toString());
  const res = await fetch(url, { headers: authHeaders(), cache: "no-store" });
  const text = await res.text();
  if (!res.ok) {
    console.error("[chatbot] error response", res.status, text.slice(0, 300));
    throw new Error(`chatbot.com ${path} ${res.status}: ${text.slice(0, 200)}`);
  }
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(`chatbot.com ${path}: invalid JSON: ${text.slice(0, 200)}`);
  }
}

export type ChatbotStory = {
  id: string;
  name: string;
  default?: boolean;
  created_at?: string;
};

export async function listStories() {
  // Stories endpoint uses /v2 prefix per docs
  return get<{ data: ChatbotStory[] }>("/v2/stories");
}

// Reports endpoints do NOT use /v2 prefix and accept ISO 8601 dates
type ReportRange = { from: string; to: string; storyId?: string };

type ReportPoint = { date: string; value: number };
type ReportSummary = { total: number; min: number; max: number; avg: number };
type ReportResponse = { data: ReportPoint[]; summary?: ReportSummary };

type BusiestPoint = { hour?: number; day_of_week?: number; value: number };
type BusiestResponse = { data: BusiestPoint[]; summary?: ReportSummary };

type InteractionPoint = { interaction: string; value: number };
type InteractionResponse = { data: InteractionPoint[]; summary?: ReportSummary };

function buildRange(periodStart: Date, periodEnd: Date, storyId: string): ReportRange {
  return {
    from: periodStart.toISOString(),
    to: periodEnd.toISOString(),
    storyId,
  };
}

export type WeeklyMetrics = {
  conversations: number;
  messages: number;
  paid_conversations: number;
  avg_per_day: number;
  busiest_hour: number | null;
  top_interactions: Array<{ interaction: string; value: number }>;
};

export async function fetchWeeklyMetrics(storyId: string, periodStart: Date, periodEnd: Date): Promise<WeeklyMetrics> {
  const range = buildRange(periodStart, periodEnd, storyId);

  const [conv, msg, paid, busy, pop] = await Promise.all([
    get<ReportResponse>("/reports/conversations", range).catch((e) => {
      console.error("[chatbot] conversations failed", e);
      return { data: [], summary: undefined } as ReportResponse;
    }),
    get<ReportResponse>("/reports/conversations-messages", range).catch((e) => {
      console.error("[chatbot] messages failed", e);
      return { data: [], summary: undefined } as ReportResponse;
    }),
    get<ReportResponse>("/reports/paid-conversations", range).catch((e) => {
      console.error("[chatbot] paid failed", e);
      return { data: [], summary: undefined } as ReportResponse;
    }),
    get<BusiestResponse>("/reports/busiest-period", range).catch((e) => {
      console.error("[chatbot] busiest failed", e);
      return { data: [], summary: undefined } as BusiestResponse;
    }),
    get<InteractionResponse>("/reports/interactions-popularity", range).catch((e) => {
      console.error("[chatbot] interactions failed", e);
      return { data: [], summary: undefined } as InteractionResponse;
    }),
  ]);

  const totalFrom = (r: ReportResponse) =>
    r.summary?.total ?? (r.data ?? []).reduce((a, p) => a + (p.value ?? 0), 0);

  const conversations = totalFrom(conv);
  const messages = totalFrom(msg);
  const paid_conversations = totalFrom(paid);
  const avg_per_day = conv.summary?.avg ?? (conv.data?.length ? conversations / conv.data.length : 0);

  const busiest = (busy.data ?? []).slice().sort((a, b) => b.value - a.value)[0];
  const busiest_hour = typeof busiest?.hour === "number" ? busiest.hour : null;

  const top_interactions = (pop.data ?? [])
    .slice()
    .sort((a, b) => b.value - a.value)
    .slice(0, 5);

  return {
    conversations,
    messages,
    paid_conversations,
    avg_per_day,
    busiest_hour,
    top_interactions,
  };
}
