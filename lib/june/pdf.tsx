import { Document, Page, Text, View, Image, StyleSheet, Font, renderToBuffer } from "@react-pdf/renderer";
import type { AuditData } from "./audit";

// Brand fonts via @fontsource on jsdelivr's CDN. Pinned to specific package
// versions so the URLs are immutable (Google's font CDN rotates hashes; this
// one doesn't). PNG/JPG only — no SVG.
const FONT_CDN = "https://cdn.jsdelivr.net/npm";

Font.register({
  family: "EB Garamond",
  fonts: [
    { src: `${FONT_CDN}/@fontsource/eb-garamond@5.2.5/files/eb-garamond-latin-400-normal.ttf`, fontWeight: 400 },
    { src: `${FONT_CDN}/@fontsource/eb-garamond@5.2.5/files/eb-garamond-latin-500-normal.ttf`, fontWeight: 500 },
    { src: `${FONT_CDN}/@fontsource/eb-garamond@5.2.5/files/eb-garamond-latin-400-italic.ttf`, fontWeight: 400, fontStyle: "italic" },
  ],
});
Font.register({
  family: "Inter",
  fonts: [
    { src: `${FONT_CDN}/@fontsource/inter@5.0.20/files/inter-latin-400-normal.ttf`, fontWeight: 400 },
    { src: `${FONT_CDN}/@fontsource/inter@5.0.20/files/inter-latin-500-normal.ttf`, fontWeight: 500 },
    { src: `${FONT_CDN}/@fontsource/inter@5.0.20/files/inter-latin-600-normal.ttf`, fontWeight: 600 },
  ],
});
Font.register({
  family: "JetBrains Mono",
  fonts: [
    { src: `${FONT_CDN}/@fontsource/jetbrains-mono@5.0.20/files/jetbrains-mono-latin-400-normal.ttf`, fontWeight: 400 },
    { src: `${FONT_CDN}/@fontsource/jetbrains-mono@5.0.20/files/jetbrains-mono-latin-500-normal.ttf`, fontWeight: 500 },
  ],
});

// Brand palette (matches workbench.html)
const PARCHMENT   = "#FAF6EC";
const PARCHMENT_2 = "#F4EEE2";
const INK         = "#1C1E1B";
const INK_SOFT    = "#4A4D47";
const INK_MUTE    = "#8A8C85";
const GOLD        = "#C9A961";
const SAGE        = "#6FA36A";
const DUSTY_BLUE  = "#7F9DB9";
const RULE        = "#E5DECF";

const s = StyleSheet.create({
  page: {
    padding: 0,
    backgroundColor: PARCHMENT,
    fontFamily: "Inter",
    color: INK,
    fontSize: 11,
  },

  // ── Co-branded header ────────────────────────────────────────────
  header: {
    paddingTop: 48,
    paddingBottom: 28,
    paddingHorizontal: 56,
    borderBottomWidth: 1,
    borderBottomColor: RULE,
  },
  cobrand: {
    flexDirection: "row",
    alignItems: "center",
    gap: 18,
    justifyContent: "center",
  },
  cobrandWordmark: {
    fontSize: 28,
    fontFamily: "Inter",
    fontWeight: 500,
    letterSpacing: -0.6,
    color: INK,
  },
  cobrandTwo: {
    fontFamily: "EB Garamond",
    fontStyle: "italic",
    color: GOLD,
    fontWeight: 400,
  },
  cobrandX: {
    fontFamily: "EB Garamond",
    fontStyle: "italic",
    fontSize: 22,
    color: INK_MUTE,
    paddingHorizontal: 4,
  },
  cobrandLogo: {
    width: 44,
    height: 44,
    objectFit: "contain",
  },
  cobrandCompany: {
    fontFamily: "EB Garamond",
    fontSize: 22,
    color: INK,
    maxWidth: 240,
  },

  headerSubLine: {
    fontFamily: "JetBrains Mono",
    fontSize: 9,
    letterSpacing: 1.4,
    textTransform: "uppercase",
    color: INK_MUTE,
    textAlign: "center",
    marginTop: 18,
  },

  // ── Body container ───────────────────────────────────────────────
  body: { paddingHorizontal: 56, paddingTop: 28 },

  // ── Hero block (about the company) ───────────────────────────────
  hero: {
    marginBottom: 30,
    paddingBottom: 22,
    borderBottomWidth: 1,
    borderBottomColor: RULE,
  },
  heroEyebrow: {
    fontFamily: "JetBrains Mono",
    fontSize: 9,
    letterSpacing: 1.6,
    textTransform: "uppercase",
    color: INK_MUTE,
    marginBottom: 12,
  },
  heroTitle: {
    fontFamily: "EB Garamond",
    fontWeight: 400,
    fontSize: 32,
    lineHeight: 1.1,
    letterSpacing: -0.5,
    color: INK,
    marginBottom: 6,
  },
  heroSub: {
    fontFamily: "EB Garamond",
    fontStyle: "italic",
    fontSize: 14,
    color: GOLD,
    marginBottom: 14,
  },
  heroBody: {
    fontSize: 12,
    lineHeight: 1.6,
    color: INK_SOFT,
  },

  // ── Section label ────────────────────────────────────────────────
  sectionLabel: {
    fontFamily: "JetBrains Mono",
    fontSize: 9,
    letterSpacing: 1.6,
    textTransform: "uppercase",
    color: INK_MUTE,
    marginBottom: 16,
    marginTop: 4,
  },

  // ── Opportunity card ─────────────────────────────────────────────
  opp: {
    marginBottom: 16,
    padding: 18,
    backgroundColor: PARCHMENT_2,
    borderRadius: 10,
    borderLeftWidth: 3,
    borderLeftColor: GOLD,
  },
  oppHead: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "baseline",
    marginBottom: 8,
  },
  oppAgent: {
    fontFamily: "EB Garamond",
    fontSize: 20,
    fontWeight: 500,
    color: INK,
  },
  oppProductPill: {
    fontFamily: "JetBrains Mono",
    fontSize: 8,
    letterSpacing: 1.4,
    color: GOLD,
    backgroundColor: PARCHMENT,
    borderWidth: 1,
    borderColor: GOLD,
    borderRadius: 100,
    paddingHorizontal: 8,
    paddingTop: 3,
    paddingBottom: 2,
    textTransform: "uppercase",
  },
  oppHeadline: {
    fontSize: 12,
    fontFamily: "Inter",
    fontWeight: 500,
    marginBottom: 10,
    color: INK,
    lineHeight: 1.4,
  },
  oppWhy: {
    fontSize: 10.5,
    color: INK_SOFT,
    marginBottom: 12,
    lineHeight: 1.55,
    fontStyle: "italic",
    fontFamily: "EB Garamond",
  },
  oppListLabel: {
    fontFamily: "JetBrains Mono",
    fontSize: 8,
    letterSpacing: 1.4,
    textTransform: "uppercase",
    color: INK_MUTE,
    marginBottom: 6,
  },
  oppListItem: {
    fontSize: 10.5,
    marginBottom: 4,
    color: INK,
    flexDirection: "row",
    gap: 6,
  },
  oppListBullet: { color: GOLD, fontWeight: 600 },
  oppListText: { flex: 1, lineHeight: 1.5 },
  oppHours: {
    fontFamily: "JetBrains Mono",
    fontSize: 9,
    color: SAGE,
    marginTop: 10,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: RULE,
  },

  // ── Closing note from June ───────────────────────────────────────
  closing: {
    marginTop: 8,
    padding: 22,
    borderRadius: 10,
    backgroundColor: INK,
    color: PARCHMENT,
  },
  closingLabel: {
    fontFamily: "JetBrains Mono",
    fontSize: 9,
    letterSpacing: 1.6,
    textTransform: "uppercase",
    color: GOLD,
    marginBottom: 10,
  },
  closingBody: {
    fontFamily: "EB Garamond",
    fontStyle: "italic",
    fontSize: 14,
    lineHeight: 1.55,
    color: PARCHMENT,
    marginBottom: 14,
  },
  closingSignature: {
    fontFamily: "JetBrains Mono",
    fontSize: 10,
    color: GOLD,
    letterSpacing: 0.5,
  },
  closingAnchor: {
    fontFamily: "EB Garamond",
    fontStyle: "italic",
    fontSize: 11,
    color: INK_MUTE,
    marginTop: 10,
  },

  // ── Footer ───────────────────────────────────────────────────────
  footer: {
    position: "absolute",
    bottom: 28,
    left: 56,
    right: 56,
    flexDirection: "row",
    justifyContent: "space-between",
    fontFamily: "JetBrains Mono",
    fontSize: 8,
    color: INK_MUTE,
    letterSpacing: 0.6,
    paddingTop: 14,
    borderTopWidth: 1,
    borderTopColor: RULE,
  },
});

// Extend the audit type with the optional logo we tucked onto it from the audit pipeline
type AuditWithLogo = AuditData & { _logoDataUrl?: string | null };

export function AuditDoc({ audit, websiteUrl }: { audit: AuditWithLogo; websiteUrl: string }) {
  const logo = audit._logoDataUrl ?? null;
  const today = new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });

  return (
    <Document title={`AI Opportunity Audit · ${audit.company_name}`} author="GB2GLLC" subject="Custom AI Opportunity Audit">
      <Page size="LETTER" style={s.page}>

        {/* Co-branded header */}
        <View style={s.header}>
          <View style={s.cobrand}>
            <Text style={s.cobrandWordmark}>
              gb<Text style={s.cobrandTwo}>2</Text>g
            </Text>
            <Text style={s.cobrandX}>×</Text>
            {logo ? (
              <Image src={logo} style={s.cobrandLogo} />
            ) : (
              <Text style={s.cobrandCompany} wrap={false}>{audit.company_name}</Text>
            )}
          </View>
          <Text style={s.headerSubLine}>
            AI Opportunity Audit · prepared {today}
          </Text>
        </View>

        <View style={s.body}>

          {/* Hero — about the company */}
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
                <Text style={s.oppProductPill}>{op.product}</Text>
              </View>
              <Text style={s.oppHeadline}>{op.headline}</Text>
              <Text style={s.oppWhy}>{op.why}</Text>
              <Text style={s.oppListLabel}>What {op.agent_name} does</Text>
              {op.what_it_does.map((line, j) => (
                <View key={j} style={s.oppListItem}>
                  <Text style={s.oppListBullet}>·</Text>
                  <Text style={s.oppListText}>{line}</Text>
                </View>
              ))}
              <Text style={s.oppHours}>
                ≈ {op.estimated_hours_saved_per_week} hours saved per week
              </Text>
            </View>
          ))}

          {/* Closing note from June */}
          <View style={s.closing} wrap={false}>
            <Text style={s.closingLabel}>A note from June</Text>
            <Text style={s.closingBody}>"{audit.closing_note}"</Text>
            <Text style={s.closingSignature}>— June · GB2GLLC</Text>
            <Text style={s.closingAnchor}>"Work as for the Lord" · Col. 3:23</Text>
          </View>
        </View>

        {/* Footer (fixed) */}
        <View style={s.footer} fixed>
          <Text>gb2gllc.com  ·  hello@gb2gllc.com</Text>
          <Text>Source: {websiteUrl}</Text>
        </View>
      </Page>
    </Document>
  );
}

export async function renderAuditPdf(audit: AuditWithLogo, websiteUrl: string): Promise<Buffer> {
  return renderToBuffer(<AuditDoc audit={audit} websiteUrl={websiteUrl} />);
}
