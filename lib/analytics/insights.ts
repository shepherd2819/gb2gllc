// lib/analytics/insights.ts
// AI insight card shape, stored in analytics_snapshots.insights and rendered
// as "AI-generated" cards. INSIGHTS_MODEL, findCandidates and generateInsights
// are added to this file by the insights task; the type is seeded here so
// store.ts and snapshot.ts can compile first.
export type InsightCard = { title: string; body: string; tone: "up" | "down" | "neutral" };
