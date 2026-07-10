// components/analytics/command-center/CcExplore.tsx
"use client";
import { useState } from "react";
import { CcRankedList, type RankedRow, type RankedSelection } from "./CcRankedList";
import { CcDeepDive } from "./CcDeepDive";

export function CcExplore({
  companies,
  products,
  agents,
}: {
  companies: RankedRow[];
  products: RankedRow[];
  agents: RankedRow[];
}) {
  const [selection, setSelection] = useState<RankedSelection | null>(null);
  return (
    <div className="cc-explore">
      <div className="cc-ranked-grid">
        <CcRankedList title="Top companies" dim="company" rows={companies} onSelect={setSelection} />
        <CcRankedList title="Top products" dim="product" rows={products} onSelect={setSelection} />
        <CcRankedList title="Top agents" dim="agent" rows={agents} onSelect={setSelection} />
      </div>
      <CcDeepDive selection={selection} onClose={() => setSelection(null)} />
    </div>
  );
}
