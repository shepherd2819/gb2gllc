// lib/analytics/present.ts
// Pure slide-sequence builder for the full-screen presentation mode
// (components/analytics/command-center/CcPresent). No React — unit-tested.
import type { SnapshotPayload } from "./snapshot";

export type PresentSlide =
  | { kind: "northstar"; label: string; value: number; momLabel: string }
  | { kind: "movers"; items: Array<{ label: string; delta: number | null }> }
  | { kind: "briefing"; text: string }
  | { kind: "companies"; rows: Array<{ name: string; revenue: number }> };

/**
 * The ordered highlight reel: north-star → movers → briefing → top companies.
 * The briefing slide is omitted when there is no briefing text; the companies
 * slide is omitted when there are no ranked companies. North-star is always
 * present, so the reel is never empty.
 */
export function buildPresentSlides(payload: SnapshotPayload, briefing: string): PresentSlide[] {
  const slides: PresentSlide[] = [];
  const mom = payload.kpis.revenueMoM;

  slides.push({
    kind: "northstar",
    label: "Revenue this month",
    value: payload.kpis.revenueThisMonth,
    momLabel: mom === null ? "no prior month" : `${mom >= 0 ? "+" : ""}${Math.round(mom * 100)}% MoM`,
  });

  slides.push({
    kind: "movers",
    items: [
      { label: "Revenue MoM", delta: payload.kpis.revenueMoM },
      { label: "Orders MoM", delta: payload.kpis.ordersMoM },
      { label: "Revenue YoY", delta: payload.yoy.revenueYoY },
    ],
  });

  const text = briefing.trim();
  if (text.length > 0) slides.push({ kind: "briefing", text });

  if (payload.topCompanies.length > 0) {
    slides.push({
      kind: "companies",
      rows: payload.topCompanies.map((c) => ({ name: c.name, revenue: c.revenue })),
    });
  }

  return slides;
}
