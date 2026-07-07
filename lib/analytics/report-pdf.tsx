// lib/analytics/report-pdf.tsx
import { Document, Page, Text, View, StyleSheet, renderToBuffer } from "@react-pdf/renderer";
import type { InsightCard } from "./insights";
import type { SnapshotRow } from "./snapshot";

const styles = StyleSheet.create({
  page: { padding: 48, fontFamily: "Helvetica", fontSize: 10, lineHeight: 1.5, color: "#1c1c1c" },
  title: { fontSize: 18, fontFamily: "Helvetica-Bold", marginBottom: 4 },
  period: { fontSize: 9, color: "#555555", marginBottom: 18 },
  sectionTitle: { fontSize: 11, fontFamily: "Helvetica-Bold", marginTop: 16, marginBottom: 6 },
  kpiGrid: { flexDirection: "row", flexWrap: "wrap" },
  kpiCell: { width: "25%", paddingRight: 12, marginBottom: 8 },
  kpiLabel: { fontSize: 8, color: "#555555" },
  kpiValue: { fontSize: 13, fontFamily: "Helvetica-Bold" },
  headRow: { flexDirection: "row", borderBottomWidth: 1, borderBottomColor: "#1c1c1c", paddingVertical: 3 },
  row: { flexDirection: "row", borderBottomWidth: 0.5, borderBottomColor: "#bbbbbb", paddingVertical: 3 },
  cellWide: { width: "40%" },
  cell: { width: "30%" },
  bold: { fontFamily: "Helvetica-Bold" },
  insight: { marginBottom: 6 },
  insightTitle: { fontFamily: "Helvetica-Bold" },
  footnote: { marginTop: 20, fontSize: 8, color: "#777777" },
});

function money(n: number): string {
  return `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function AnalyticsReportDocument({ snapshot }: { snapshot: SnapshotRow }) {
  const p = snapshot.payload;
  const insights: InsightCard[] = snapshot.insights ?? [];
  return (
    <Document>
      <Page size="LETTER" style={styles.page}>
        <Text style={styles.title}>Analytics Report</Text>
        <Text style={styles.period}>
          Data as of{" "}
          {new Date(p.generatedAt).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })}
        </Text>

        <Text style={styles.sectionTitle}>This Month</Text>
        <View style={styles.kpiGrid}>
          <View style={styles.kpiCell}>
            <Text style={styles.kpiLabel}>Revenue</Text>
            <Text style={styles.kpiValue}>{money(p.kpis.revenueThisMonth)}</Text>
          </View>
          <View style={styles.kpiCell}>
            <Text style={styles.kpiLabel}>Orders</Text>
            <Text style={styles.kpiValue}>{String(p.kpis.ordersThisMonth)}</Text>
          </View>
          <View style={styles.kpiCell}>
            <Text style={styles.kpiLabel}>Avg order value</Text>
            <Text style={styles.kpiValue}>{money(p.kpis.avgOrderValue)}</Text>
          </View>
          <View style={styles.kpiCell}>
            <Text style={styles.kpiLabel}>Active customers</Text>
            <Text style={styles.kpiValue}>{String(p.kpis.activeCustomers)}</Text>
          </View>
        </View>

        <Text style={styles.sectionTitle}>Revenue &amp; Orders — trailing months</Text>
        <View style={styles.headRow}>
          <Text style={[styles.cellWide, styles.bold]}>Month</Text>
          <Text style={[styles.cell, styles.bold]}>Revenue</Text>
          <Text style={[styles.cell, styles.bold]}>Orders</Text>
        </View>
        {p.trend.map((r) => (
          <View key={r.month} style={styles.row}>
            <Text style={styles.cellWide}>{r.month}</Text>
            <Text style={styles.cell}>{money(r.revenue)}</Text>
            <Text style={styles.cell}>{String(r.orders)}</Text>
          </View>
        ))}

        <Text style={styles.sectionTitle}>Top Companies</Text>
        <View style={styles.headRow}>
          <Text style={[styles.cellWide, styles.bold]}>Company</Text>
          <Text style={[styles.cell, styles.bold]}>Revenue</Text>
          <Text style={[styles.cell, styles.bold]}>Orders</Text>
        </View>
        {p.topCompanies.map((r) => (
          <View key={r.name} style={styles.row}>
            <Text style={styles.cellWide}>{r.name}</Text>
            <Text style={styles.cell}>{money(r.revenue)}</Text>
            <Text style={styles.cell}>{String(r.orders)}</Text>
          </View>
        ))}

        {insights.length > 0 && (
          <View>
            <Text style={styles.sectionTitle}>Insights</Text>
            {insights.map((card, i) => (
              <View key={i} style={styles.insight}>
                <Text style={styles.insightTitle}>{card.title}</Text>
                <Text>{card.body}</Text>
              </View>
            ))}
            <Text style={styles.footnote}>Insights are AI-generated from your synced data.</Text>
          </View>
        )}
      </Page>
    </Document>
  );
}

export async function renderAnalyticsReportPdf(snapshot: SnapshotRow): Promise<Buffer> {
  return await renderToBuffer(<AnalyticsReportDocument snapshot={snapshot} />);
}
