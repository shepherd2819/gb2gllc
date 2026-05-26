import { Document, Page, Text, View, StyleSheet, renderToBuffer } from "@react-pdf/renderer";
import type { AuditData } from "./audit";

// Built-in PDF fonts: Helvetica (sans) + Times-Roman (serif). No external
// font fetches means no 404s when Google rotates its font CDN hashes.
const SANS  = "Helvetica";
const SANS_BOLD = "Helvetica-Bold";
const SERIF = "Times-Roman";
const SERIF_ITAL = "Times-Italic";

const PARCHMENT = "#FAF6EC";
const INK = "#1C1E1B";
const INK_MUTE = "#6B6E66";
const GOLD = "#C9A961";
const RULE = "#E5DECF";

const s = StyleSheet.create({
  page: { padding: 56, backgroundColor: PARCHMENT, fontFamily: SANS, color: INK, fontSize: 11 },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 28 },
  wordmark: { fontSize: 18, fontFamily: SANS_BOLD, letterSpacing: -0.3, color: INK },
  wordmarkItalic: { fontFamily: SERIF_ITAL, color: GOLD },
  eyebrow: { fontSize: 8, letterSpacing: 1, color: INK_MUTE },
  hero: { marginBottom: 28, paddingBottom: 18, borderBottomWidth: 1, borderBottomColor: RULE },
  heroEyebrow: { fontSize: 9, letterSpacing: 1.5, color: INK_MUTE, marginBottom: 10 },
  heroTitle: { fontFamily: SERIF, fontSize: 26, lineHeight: 1.15, marginBottom: 6 },
  heroSub: { fontSize: 11, color: INK_MUTE, marginBottom: 14, fontFamily: SERIF_ITAL },
  heroBody: { fontSize: 12, lineHeight: 1.55 },
  sectionLabel: { fontSize: 9, letterSpacing: 1.5, color: INK_MUTE, marginBottom: 14, marginTop: 10 },
  opp: { marginBottom: 18, padding: 14, backgroundColor: "#FFFFFF", borderRadius: 8, borderWidth: 1, borderColor: RULE },
  oppHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 6 },
  oppAgent: { fontFamily: SERIF, fontSize: 16, color: INK },
  oppProduct: { fontSize: 8, letterSpacing: 1, color: GOLD, paddingTop: 4 },
  oppHeadline: { fontSize: 11, marginBottom: 8, color: INK, lineHeight: 1.4, fontFamily: SANS_BOLD },
  oppWhy: { fontSize: 10, color: INK_MUTE, marginBottom: 8, lineHeight: 1.5 },
  oppListLabel: { fontSize: 8, letterSpacing: 1, color: INK_MUTE, marginBottom: 4, marginTop: 4 },
  oppListItem: { fontSize: 10, marginBottom: 3, paddingLeft: 8, color: INK },
  oppHours: { fontSize: 9, color: GOLD, marginTop: 6, fontFamily: SANS_BOLD },
  closing: { marginTop: 14, padding: 14, borderRadius: 8, borderWidth: 1, borderColor: RULE, backgroundColor: "#FFFFFF" },
  closingLabel: { fontSize: 8, letterSpacing: 1, color: INK_MUTE, marginBottom: 6 },
  closingBody: { fontSize: 11, lineHeight: 1.55, color: INK, marginBottom: 10 },
  signature: { fontSize: 10, color: INK_MUTE, marginTop: 4, fontFamily: SERIF_ITAL },
  footer: { position: "absolute", bottom: 36, left: 56, right: 56, flexDirection: "row", justifyContent: "space-between", fontSize: 8, color: INK_MUTE, letterSpacing: 0.5 },
});

export function AuditDoc({ audit, websiteUrl }: { audit: AuditData; websiteUrl: string }) {
  return (
    <Document title={`AI Opportunity Audit · ${audit.company_name}`} author="GB2GLLC">
      <Page size="LETTER" style={s.page}>
        <View style={s.header}>
          <Text style={s.wordmark}>
            GB<Text style={s.wordmarkItalic}>2</Text>G
          </Text>
          <Text style={s.eyebrow}>AI OPPORTUNITY AUDIT</Text>
        </View>

        <View style={s.hero}>
          <Text style={s.heroEyebrow}>PREPARED FOR</Text>
          <Text style={s.heroTitle}>{audit.company_name}</Text>
          <Text style={s.heroSub}>{audit.tagline}</Text>
          <Text style={s.heroBody}>{audit.what_they_do_summary}</Text>
        </View>

        <Text style={s.sectionLabel}>WHERE AI FITS IN</Text>
        {audit.opportunities.map((op, i) => (
          <View key={i} style={s.opp} wrap={false}>
            <View style={s.oppHead}>
              <Text style={s.oppAgent}>{op.agent_name}</Text>
              <Text style={s.oppProduct}>{op.product.toUpperCase()}</Text>
            </View>
            <Text style={s.oppHeadline}>{op.headline}</Text>
            <Text style={s.oppWhy}>{op.why}</Text>
            <Text style={s.oppListLabel}>WHAT {op.agent_name.toUpperCase()} DOES</Text>
            {op.what_it_does.map((line, j) => (
              <Text key={j} style={s.oppListItem}>· {line}</Text>
            ))}
            <Text style={s.oppHours}>≈ {op.estimated_hours_saved_per_week} hours saved per week</Text>
          </View>
        ))}

        <View style={s.closing}>
          <Text style={s.closingLabel}>FROM JUNE</Text>
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
