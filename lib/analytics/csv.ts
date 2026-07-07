// lib/analytics/csv.ts
// RFC 4180 CSV serialization + pure snapshot→table row builders for exports.
import type { SnapshotPayload } from "./snapshot";

export function toCsv(headers: string[], rows: Array<Array<string | number | null>>): string {
  const escape = (field: string | number | null): string => {
    if (field === null) return "";
    const s = String(field);
    // Quote when the field contains a comma, a quote, or any line break;
    // embedded quotes are doubled (RFC 4180 §2.6–2.7).
    if (/[",\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  };
  const lines = [headers.map(escape).join(","), ...rows.map((row) => row.map(escape).join(","))];
  return lines.join("\r\n") + "\r\n";
}

export const EXPORT_TABLES = ["trend", "productMix", "statusMix", "topCompanies", "topAgents"] as const;
export type ExportTable = (typeof EXPORT_TABLES)[number];

export function buildExportRows(
  payload: SnapshotPayload,
  table: string,
): { headers: string[]; rows: Array<Array<string | number | null>> } | null {
  switch (table) {
    case "trend":
      return {
        headers: ["month", "revenue", "orders"],
        rows: payload.trend.map((r) => [r.month, r.revenue, r.orders]),
      };
    case "productMix":
      return {
        headers: ["product", "revenue"],
        rows: payload.productMix.map((r) => [r.name, r.revenue]),
      };
    case "statusMix":
      return {
        headers: ["status", "count"],
        rows: payload.statusMix.map((r) => [r.name, r.count]),
      };
    case "topCompanies":
      return {
        headers: ["company", "revenue", "orders"],
        rows: payload.topCompanies.map((r) => [r.name, r.revenue, r.orders]),
      };
    case "topAgents":
      return {
        headers: ["agent", "revenue", "orders"],
        rows: payload.topAgents.map((r) => [r.name, r.revenue, r.orders]),
      };
    default:
      return null;
  }
}
