import { Document, Page, Text, View, StyleSheet, Font, renderToBuffer } from "@react-pdf/renderer";
import type { AuditData } from "./audit";

// Use Google Fonts that ship via CDN — @react-pdf/renderer fetches once and caches
Font.register({
  family: "EB Garamond",
  fonts: [
    { src: "https://fonts.gstatic.com/s/ebgaramond/v30/SlGDmQSNjdsmc35JDF1K5E55YMjF_7DPuGi-6_RUA4V-eteoZQ.ttf", fontWeight: 400 },
    { src: "https://fonts.gstatic.com/s/ebgaramond/v30/SlGDmQSNjdsmc35JDF1K5E55YMjF_7DPuGi-6_RUA4VVeteoZQ.ttf", fontWeight: 500, fontStyle: "italic" },
  ],
});
Font.register({
  family: "Inter",
  fonts: [
    { src: "https://fonts.gstatic.com/s/inter/v18/UcCO3FwrK3iLTeHuS_nVMrMxCp50ojIw2boKoduKmMEVuLyfMZhrib2Bg-4.ttf", fontWeight: 400 },
    { src: "https://fonts.gstatic.com/s/inter/v18/UcCO3FwrK3iLTeHuS_nVMrMxCp50ojIw2boKoduKmMEVuI6fMZhrib2Bg-4.ttf", fontWeight: 500 },
    { src: "https://fonts.gstatic.com/s/inter/v18/UcCO3FwrK3iLTeHuS_nVMrMxCp50ojIw2boKoduKmMEVuFuYMZhrib2Bg-4.ttf", fontWeight: 600 },
  ],
});

const PARCHMENT = "#FAF6EC";
const INK = "#1C1E1B";
const INK_MUTE = "#6B6E66";
const GOLD = "#C9A961";
const RULE = "#E5DECF";

const s = StyleSheet.create({
  page: { padding: 56, backgroundColor: PARCHMENT, fontFamily: "Inter", color: INK, fontSize: 11 },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 28 },
  wordmark: { fontSize: 18, fontWeight: 500, letterSpacing: -0.3, color: INK },
  wordmarkItalic: { fontFamily: "EB Garamond", fontStyle: "italic", color: GOLD },
  eyebrow: { fontSize: 8, letterSpacing: 1, textTransform: "uppercase", color: INK_MUTE },
  hero: { marginBottom: 28, paddingBottom: 18, borderBottomWidth: 1, borderBottomColor: RULE },
  heroEyebrow: { fontSize: 9, letterSpacing: 1.5, textTransform: "uppercase", color: INK_MUTE, marginBottom: 10 },
  heroTitle: { fontFamily: "EB Garamond", fontSize: 26, lineHeight: 1.15, marginBottom: 6 },
  heroSub: { fontSize: 11, color: INK_MUTE, marginBottom: 14 },
  heroBody: { fontSize: 12, lineHeight: 1.55 },
  sectionLabel: { fontSize: 9, letterSpacing: 1.5, textTransform: "uppercase", color: INK_MUTE, marginBottom: 14, marginTop: 10 },
  opp: { marginBottom: 18, padding: 14, backgroundColor: "#FFFFFF", borderRadius: 8, borderWidth: 1, borderColor: RULE },
  oppHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 6 },
  oppAgent: { fontFamily: "EB Garamond", fontSize: 16, color: INK },
  oppProduct: { fontSize: 8, letterSpacing: 1, textTransform: "uppercase", color: GOLD, paddingTop: 4 },
  oppHeadline: { fontSize: 11, marginBottom: 8, color: INK, lineHeight: 1.4 },
  oppWhy: { fontSize: 10, color: INK_MUTE, marginBottom: 8, lineHeight: 1.5 },
  oppListLabel: { fontSize: 8, letterSpacing: 1, textTransform: "uppercase", color: INK_MUTE, marginBottom: 4, marginTop: 4 },
  oppListItem: { fontSize: 10, marginBottom: 3, paddingLeft: 8, color: INK },
  oppHours: { fontSize: 9, color: GOLD, marginTop: 6, fontWeight: 500 },
  closing: { marginTop: 14, padding: 14, borderRadius: 8, borderWidth: 1, borderColor: RULE, backgroundColor: "#FFFFFF" },
  closingLabel: { fontSize: 8, letterSpacing: 1, textTransform: "uppercase", color: INK_MUTE, marginBottom: 6 },
  closingBody: { fontSize: 11, lineHeight: 1.55, color: INK, marginBottom: 10 },
  signature: { fontSize: 10, color: INK_MUTE, marginTop: 4 },
  footer: { position: "absolute", bottom: 36, left: 56, right: 56, flexDirection: "row", justifyContent: "space-between", fontSize: 8, color: INK_MUTE, letterSpacing: 0.5 },
});

export function AuditDoc({ audit, websiteUrl }: { audit: AuditData; websiteUrl: string }) {
  return (
    <Document title={`AI Opportunity Audit · ${audit.company_name}`} author="GB2GLLC">
      <Page size="LETTER" style={s.page}>
        <View style={s.header}>
          <Text style={s.wordmark}>
            gb<Text style={s.wordmarkItalic}>2</Text>g
          </Text>
          <Text style={s.eyebrow}>AI Opportunity Audit</Text>
        </View>

        <View style={s.hero}>
          <Text style={s.heroEyebrow}>Prepared for</Text>
          <Text style={s.heroTitle}>{audit.company_name}</Text>
          <Text style={s.heroSub}>{audit.tagline}</Text>
          <Text style={s.heroBody}>{audit.what_they_do_summary}</Text>
        </View>

        <Text style={s.sectionLabel}>Where AI fits in</Text>
        {audit.opportunities.map((op, i) => (
          <View key={i} style={s.opp} wrap={false}>
            <View style={s.oppHead}>
              <Text style={s.oppAgent}>{op.agent_name}</Text>
              <Text style={s.oppProduct}>{op.product}</Text>
            </View>
            <Text style={s.oppHeadline}>{op.headline}</Text>
            <Text style={s.oppWhy}>{op.why}</Text>
            <Text style={s.oppListLabel}>What {op.agent_name} does</Text>
            {op.what_it_does.map((line, j) => (
              <Text key={j} style={s.oppListItem}>· {line}</Text>
            ))}
            <Text style={s.oppHours}>≈ {op.estimated_hours_saved_per_week} hours saved per week</Text>
          </View>
        ))}

        <View style={s.closing}>
          <Text style={s.closingLabel}>From June</Text>
          <Text style={s.closingBody}>{audit.closing_note}</Text>
          <Text style={s.signature}>— June, on behalf of GB2GLLC</Text>
        </View>

        <View style={s.footer} fixed>
          <Text>gb2gllc.com · hello@gb2gllc.com</Text>
          <Text>Source: {websiteUrl}</Text>
        </View>
      </Page>
    </Document>
  );
}

export async function renderAuditPdf(audit: AuditData, websiteUrl: string): Promise<Buffer> {
  return renderToBuffer(<AuditDoc audit={audit} websiteUrl={websiteUrl} />);
}
