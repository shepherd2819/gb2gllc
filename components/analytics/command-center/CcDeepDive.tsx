// components/analytics/command-center/CcDeepDive.tsx
"use client";
import { useEffect, useState } from "react";
import { Drawer } from "@/components/ui";
import { Sparkline } from "@/components/charts/Sparkline";
import { fmtCurrency, fmtInt } from "@/lib/analytics/format";
import type { RankedSelection } from "./CcRankedList";

type EntitySeries = {
  dim: string;
  name: string;
  months: Array<{ month: string; revenue: number; orders: number }>;
  totals: { revenue: number; orders: number };
};

export function CcDeepDive({
  selection,
  onClose,
}: {
  selection: RankedSelection | null;
  onClose: () => void;
}) {
  const [data, setData] = useState<EntitySeries | null>(null);
  const [state, setState] = useState<"idle" | "loading" | "error">("idle");

  useEffect(() => {
    if (!selection) {
      setData(null);
      setState("idle");
      return;
    }
    let alive = true;
    setState("loading");
    setData(null);
    const url = `/api/portal/analytics/entity?dim=${encodeURIComponent(selection.dim)}&name=${encodeURIComponent(selection.name)}`;
    fetch(url)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d: EntitySeries) => {
        if (alive) {
          setData(d);
          setState("idle");
        }
      })
      .catch(() => {
        if (alive) setState("error");
      });
    return () => {
      alive = false;
    };
  }, [selection]);

  const months = data?.months ?? [];
  const hasData = months.some((m) => m.revenue > 0 || m.orders > 0);

  return (
    <Drawer
      open={selection !== null}
      onClose={onClose}
      title={selection?.name ?? "Details"}
      className="cc-deepdive"
    >
      {state === "loading" ? (
        <p className="cc-deepdive-empty">Loading…</p>
      ) : state === "error" || !data || !hasData ? (
        <p className="cc-deepdive-empty">No breakdown data yet for this source.</p>
      ) : (
        <div className="cc-deepdive-body">
          <div className="cc-deepdive-totals">
            <div className="cc-deepdive-stat">
              <div className="cc-deepdive-num">{fmtCurrency(data.totals.revenue)}</div>
              <div className="cc-deepdive-lbl">revenue · trailing 13 mo</div>
            </div>
            <div className="cc-deepdive-stat">
              <div className="cc-deepdive-num">{fmtInt(data.totals.orders)}</div>
              <div className="cc-deepdive-lbl">orders · trailing 13 mo</div>
            </div>
          </div>
          <Sparkline
            points={months.map((m) => m.revenue)}
            ariaLabel={`Revenue trend for ${data.name}`}
            width={320}
            height={72}
            fill
            dot
          />
        </div>
      )}
    </Drawer>
  );
}
