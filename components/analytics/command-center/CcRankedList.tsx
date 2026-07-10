// components/analytics/command-center/CcRankedList.tsx
"use client";
import { Sparkline } from "@/components/charts/Sparkline";
import { fmtCurrency } from "@/lib/analytics/format";
import { barFraction } from "@/lib/analytics/cc-format";

export type RankedRow = { name: string; value: number; spark?: number[] };
export type RankedSelection = { dim: "company" | "product" | "agent"; name: string };

export function CcRankedList({
  title,
  dim,
  rows,
  onSelect,
}: {
  title: string;
  dim: "company" | "product" | "agent";
  rows: RankedRow[];
  onSelect: (sel: RankedSelection) => void;
}) {
  const top = rows.length > 0 ? rows[0].value : 0;
  return (
    <div className="cc-ranked">
      <h2 className="cc-ranked-title">{title}</h2>
      {rows.length === 0 ? (
        <div className="cc-ranked-empty">No data yet</div>
      ) : (
        <ol className="cc-ranked-list">
          {rows.map((row, i) => (
            <li key={row.name} className="cc-ranked-item">
              <button
                type="button"
                className="cc-ranked-row"
                onClick={() => onSelect({ dim, name: row.name })}
              >
                <span className="cc-ranked-rank" aria-hidden>{i + 1}</span>
                <span className="cc-ranked-name" title={row.name}>{row.name}</span>
                <span className="cc-ranked-bar" aria-hidden>
                  <span
                    className="cc-ranked-bar-fill"
                    style={{ width: `${Math.round(barFraction(row.value, top) * 100)}%` }}
                  />
                </span>
                {row.spark && row.spark.length > 1 ? (
                  <span className="cc-ranked-spark" aria-hidden>
                    <Sparkline points={row.spark} ariaLabel="" width={72} height={22} />
                  </span>
                ) : null}
                <span className="cc-ranked-value">{fmtCurrency(row.value)}</span>
              </button>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
