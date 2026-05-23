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
      if (v !== undefined) url.searchParams.set(k, String(v));
    }
  }
  const res = await fetch(url, { headers: authHeaders(), cache: "no-store" });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`chatbot.com ${path} ${res.status}: ${text.slice(0, 200)}`);
  }
  return res.json() as Promise<T>;
}

export type ChatbotStory = {
  id: string;
  name: string;
  default?: boolean;
  created_at?: string;
};

export async function listStories() {
  return get<{ data: ChatbotStory[] }>("/v2/stories");
}

// All reports endpoints accept ISO date range
type DateRange = { date_from: string; date_to: string; story?: string };

export type ConversationsReport = {
  data: Array<{ date: string; value: number }>;
  total?: number;
};

export async function conversationsReport(range: DateRange) {
  return get<ConversationsReport>("/v2/reports/conversations", range);
}

export async function paidConversationsReport(range: DateRange) {
  return get<ConversationsReport>("/v2/reports/paid-conversations", range);
}

export async function conversationMessagesReport(range: DateRange) {
  return get<ConversationsReport>("/v2/reports/conversations-messages", range);
}

export async function averageConversationsReport(range: DateRange) {
  return get<{ data: Array<{ date: string; value: number }>; average?: number }>(
    "/v2/reports/average-conversations",
    range
  );
}

export async function busiestPeriodReport(range: DateRange) {
  return get<{ data: Array<{ hour: number; day_of_week?: number; value: number }> }>(
    "/v2/reports/busiest-period",
    range
  );
}

export async function interactionsPopularityReport(range: DateRange) {
  return get<{ data: Array<{ interaction: string; value: number }> }>(
    "/v2/reports/interactions-popularity",
    range
  );
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
  const range: DateRange = {
    date_from: periodStart.toISOString().slice(0, 10),
    date_to: periodEnd.toISOString().slice(0, 10),
    story: storyId,
  };

  const [conv, msg, paid, avg, busy, pop] = await Promise.all([
    conversationsReport(range).catch(() => ({ data: [], total: 0 })),
    conversationMessagesReport(range).catch(() => ({ data: [], total: 0 })),
    paidConversationsReport(range).catch(() => ({ data: [], total: 0 })),
    averageConversationsReport(range).catch(() => ({ data: [], average: 0 })),
    busiestPeriodReport(range).catch(() => ({ data: [] })),
    interactionsPopularityReport(range).catch(() => ({ data: [] })),
  ]);

  const sum = (rows: Array<{ value: number }>) => rows.reduce((a, r) => a + (r.value ?? 0), 0);

  const busiest = (busy.data ?? []).slice().sort((a, b) => b.value - a.value)[0]?.hour ?? null;

  return {
    conversations: conv.total ?? sum(conv.data ?? []),
    messages: msg.total ?? sum(msg.data ?? []),
    paid_conversations: paid.total ?? sum(paid.data ?? []),
    avg_per_day: avg.average ?? (avg.data?.length ? sum(avg.data) / avg.data.length : 0),
    busiest_hour: busiest,
    top_interactions: (pop.data ?? []).slice(0, 5),
  };
}
