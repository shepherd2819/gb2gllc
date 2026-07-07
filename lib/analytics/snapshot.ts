// lib/analytics/snapshot.ts
// Precomputed dashboard snapshot shapes (analytics_snapshots.payload — the
// one-row-per-client read powering portal + admin dashboards). computeSnapshot
// is added to this file by the snapshot-computation task; the shapes are
// seeded here so store.ts can type readSnapshot/writeSnapshot.
import type { InsightCard } from "./insights";

export type SnapshotPayload = {
  generatedAt: string;
  kpis: {
    revenueThisMonth: number;
    ordersThisMonth: number;
    avgOrderValue: number;
    activeCustomers: number;
    revenueMoM: number | null;
    ordersMoM: number | null;
  };
  trend: Array<{ month: string; revenue: number; orders: number }>;
  productMix: Array<{ name: string; revenue: number }>;
  statusMix: Array<{ name: string; count: number }>;
  topCompanies: Array<{ name: string; revenue: number; orders: number }>;
  topAgents: Array<{ name: string; revenue: number; orders: number }>;
  sources: Array<{
    id: string;
    label: string;
    provider: string;
    status: string;
    lastSyncAt: string | null;
    lastSyncError: string | null;
  }>;
};

export type SnapshotRow = {
  client_id: string;
  payload: SnapshotPayload;
  insights: InsightCard[];
  computed_at: string;
};
