// components/analytics/InsightCards.tsx
import type { InsightCard } from "@/lib/analytics/insights";

export function InsightCards({ cards, computedAt }: { cards: InsightCard[]; computedAt: string }) {
  if (!cards.length) return null;
  const date = new Date(computedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  return (
    <section className="ds-analytics-block">
      <h2 className="section-title">AI-generated · {date}</h2>
      <div className="ds-insight-grid">
        {cards.map((c, i) => (
          <div key={i} className={`ds-insight-card ds-insight-card--${c.tone}`}>
            <div className="ds-insight-title">{c.title}</div>
            <p className="ds-insight-body">{c.body}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
