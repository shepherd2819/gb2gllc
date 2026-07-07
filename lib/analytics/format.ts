// lib/analytics/format.ts
// Pure display formatters for the analytics dashboard (tested in format.test.ts).

const INT = new Intl.NumberFormat("en-US");

export function fmtCurrency(n: number): string {
  return `$${INT.format(Math.round(n))}`;
}

export function fmtCompactCurrency(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `$${Math.round(n / 1_000)}k`;
  return `$${Math.round(n)}`;
}

export function fmtInt(n: number): string {
  return INT.format(Math.round(n));
}

export type DeltaView = { text: string; arrow: "▲" | "▼" | "—"; tone: "up" | "down" | "neutral" };

/** ratio is a fractional MoM change (0.12 = +12%). null / 0 render neutral. */
export function fmtDelta(ratio: number | null): DeltaView {
  if (ratio === null || !Number.isFinite(ratio)) return { text: "—", arrow: "—", tone: "neutral" };
  const pct = ratio * 100;
  if (ratio > 0) return { text: `+${pct.toFixed(0)}%`, arrow: "▲", tone: "up" };
  if (ratio < 0) return { text: `${pct.toFixed(0)}%`, arrow: "▼", tone: "down" };
  return { text: "0%", arrow: "—", tone: "neutral" };
}

/** "YYYY-MM" or full ISO date → short month name; passes through on parse fail. */
export function fmtMonthLabel(iso: string): string {
  const parts = iso.split("-");
  if (parts.length < 2) return iso;
  const y = Number(parts[0]);
  const m = Number(parts[1]);
  if (!Number.isFinite(y) || !Number.isFinite(m) || m < 1 || m > 12) return iso;
  return new Date(y, m - 1, 1).toLocaleString("en-US", { month: "short" });
}
