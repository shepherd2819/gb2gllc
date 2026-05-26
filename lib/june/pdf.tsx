import { Document, Page, Text, View, Image, StyleSheet, renderToBuffer } from "@react-pdf/renderer";
import type { AuditData } from "./audit";

// PDF built-in fonts only — @fontsource dropped TTF starting in v5 (woff/woff2
// only, which @react-pdf can't read) and Google's font CDN rotates hashes
// unpredictably. Sticking to the three PDF built-ins (Helvetica, Times, Courier)
// means the renderer can never fail on a missing font. Important: Helvetica's
// built-in glyph set is narrow — DO NOT use characters like ≈ — , ’ etc.
// Stick to plain ASCII + standard punctuation in the rendered strings.
const SANS         = "Helvetica";
const SANS_BOLD    = "Helvetica-Bold";
const SANS_OBLIQUE = "Helvetica-Oblique";
const SERIF        = "Times-Roman";
const SERIF_BOLD   = "Times-Bold";
const SERIF_ITAL   = "Times-Italic";
const MONO         = "Courier";

// Brand palette (matches workbench.html)
const PARCHMENT   = "#FAF6EC";
const PARCHMENT_2 = "#F4EEE2";
const INK         = "#1C1E1B";
const INK_SOFT    = "#4A4D47";
const INK_MUTE    = "#8A8C85";
const GOLD        = "#C9A961";
const SAGE        = "#6FA36A";
const RULE        = "#E5DECF";

const s = StyleSheet.create({
  page: {
    padding: 0,
    backgroundColor: PARCHMENT,
    fontFamily: SANS,
    color: INK,
    fontSize: 10,
  },

  // ── Co-branded header ───────────────────────────────────────────
  header: {
    paddingTop: 36,
    paddingBottom: 18,
    paddingHorizontal: 48,
    borderBottomWidth: 1,
    borderBottomColor: RULE,
  },
  cobrand: {
    flexDirection: "row",
    alignItems: "center",
    gap: 16,
    justifyContent: "center",
  },
  cobrandWordmark: {
    fontSize: 24,
    fontFamily: SANS_BOLD,
    letterSpacing: -0.6,
    color: INK,
  },
  cobrandTwo: {
    fontFamily: SERIF_ITAL,
    color: GOLD,
  },
  cobrandX: {
    fontFamily: SERIF_ITAL,
    fontSize: 18,
    color: INK_MUTE,
    paddingHorizontal: 4,
  },
  cobrandLogo: {
    width: 36,
    height: 36,
    objectFit: "contain",
  },
  cobrandCompany: {
    fontFamily: SERIF,
    fontSize: 20,
    color: INK,
    maxWidth: 280,
  },
  headerSubLine: {
    fontFamily: MONO,
    fontSize: 8,
    letterSpacing: 1.4,
    color: INK_MUTE,
    textAlign: "center",
    marginTop: 12,
  },

  // ── Body container ──────────────────────────────────────────────
  body: { paddingHorizontal: 48, paddingTop: 22 },

  // ── Hero block (about the company) ──────────────────────────────
  hero: {
    marginBottom: 22,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: RULE,
  },
  heroEyebrow: {
    fontFamily: MONO,
    fontSize: 8,
    letterSpacing: 1.6,
    color: INK_MUTE,
    marginBottom: 8,
  },
  heroTitle: {
    fontFamily: SERIF,
    fontSize: 26,
    lineHeight: 1.12,
    letterSpacing: -0.4,
    color: INK,
    marginBottom: 4,
  },
  heroSub: {
    fontFamily: SERIF_ITAL,
    fontSize: 12,
    color: GOLD,
    marginBottom: 10,
  },
  heroBody: {
    fontSize: 11,
    lineHeight: 1.5,
    color: INK_SOFT,
  },

  // ── Section label ───────────────────────────────────────────────
  sectionLabel: {
    fontFamily: MONO,
    fontSize: 8,
    letterSpacing: 1.6,
    color: INK_MUTE,
    marginBottom: 12,
  },

  // ── Opportunity card (compact) ──────────────────────────────────
  opp: {
    marginBottom: 10,
    paddingTop: 12,
    paddingBottom: 12,
    paddingLeft: 14,
    paddingRight: 14,
    backgroundColor: PARCHMENT_2,
    borderRadius: 8,
    borderLeftWidth: 3,
    borderLeftColor: GOLD,
  },
  oppHead: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 4,
  },
  oppHeadLeft: {
    flexDirection: "row",
    alignItems: "baseline",
    gap: 10,
    flex: 1,
  },
  oppAgent: {
    fontFamily: SERIF,
    fontSize: 16,
    color: INK,
  },
  oppHoursInline: {
    fontFamily: MONO,
    fontSize: 8,
    letterSpacing: 1,
    color: SAGE,
  },
  oppProductPill: {
    fontFamily: MONO,
    fontSize: 7,
    letterSpacing: 1.4,
    color: GOLD,
    borderWidth: 1,
    borderColor: GOLD,
    borderRadius: 100,
    paddingHorizontal: 7,
    paddingTop: 3,
    paddingBottom: 2,
  },
  oppHeadline: {
    fontSize: 11,
    fontFamily: SANS_BOLD,
    marginBottom: 6,
    color: INK,
    lineHeight: 1.35,
  },
  oppWhy: {
    fontSize: 9.5,
    color: INK_SOFT,
    marginBottom: 8,
    lineHeight: 1.5,
    fontFamily: SERIF_ITAL,
  },
  oppListLabel: {
    fontFamily: MONO,
    fontSize: 7,
    letterSpacing: 1.4,
    color: INK_MUTE,
    marginBottom: 3,
  },
  oppListItem: {
    fontSize: 9.5,
    marginBottom: 2,
    color: INK,
    flexDirection: "row",
    gap: 6,
    paddingLeft: 2,
  },
  oppListBullet: { color: GOLD },
  oppListText: { flex: 1, lineHeight: 1.4 },

  // ── Closing note from June ──────────────────────────────────────
  closing: {
    marginTop: 14,
    padding: 18,
    borderRadius: 8,
    backgroundColor: INK,
    color: PARCHMENT,
  },
  closingLabel: {
    fontFamily: MONO,
    fontSize: 8,
    letterSpacing: 1.6,
    color: GOLD,
    marginBottom: 8,
  },
  closingBody: {
    fontFamily: SERIF_ITAL,
    fontSize: 12,
    lineHeight: 1.55,
    color: PARCHMENT,
    marginBottom: 10,
  },
  closingSignature: {
    fontFamily: MONO,
    fontSize: 9,
    color: GOLD,
    letterSpacing: 0.5,
  },
  closingAnchor: {
    fontFamily: SERIF_ITAL,
    fontSize: 10,
    color: INK_MUTE,
    marginTop: 6,
  },

  // ── Footer ──────────────────────────────────────────────────────
  footer: {
    position: "absolute",
    bottom: 24,
    left: 48,
    right: 48,
    flexDirection: "row",
    justifyContent: "space-between",
    fontFamily: MONO,
    fontSize: 7,
    color: INK_MUTE,
    letterSpacing: 0.5,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: RULE,
  },
});

type AuditWithLogo = AuditData & { _logoDataUrl?: string | null };

export function AuditDoc({ audit, websiteUrl }: { audit: AuditWithLogo; websiteUrl: string }) {
  const logo = audit._logoDataUrl ?? null;
  const today = new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" }).toUpperCase();

  return (
    <Document title={`AI Opportunity Audit - ${audit.company_name}`} author="GB2GLLC" subject="Custom AI Opportunity Audit">
      <Page size="LETTER" style={s.page}>

        {/* Co-branded header */}
        <View style={s.header}>
          <View style={s.cobrand}>
            <Text style={s.cobrandWordmark}>
              gb<Text style={s.cobrandTwo}>2</Text>g
            </Text>
            <Text style={s.cobrandX}>x</Text>
            {logo ? (
              <Image src={logo} style={s.cobrandLogo} />
            ) : (
              <Text style={s.cobrandCompany} wrap={false}>{audit.company_name}</Text>
            )}
          </View>
          <Text style={s.headerSubLine}>
            AI OPPORTUNITY AUDIT  ·  PREPARED {today}
          </Text>
        </View>

        <View style={s.body}>

          {/* Hero — about the company */}
          <View style={s.hero}>
            <Text style={s.heroEyebrow}>PREPARED FOR</Text>
            <Text style={s.heroTitle}>{audit.company_name}</Text>
            <Text style={s.heroSub}>{audit.tagline}</Text>
            <Text style={s.heroBody}>{audit.what_they_do_summary}</Text>
          </View>

          <Text style={s.sectionLabel}>WHERE AI FITS IN</Text>
          {audit.opportunities.map((op, i) => (
            <View key={i} style={s.opp} wrap={true}>
              <View style={s.oppHead}>
                <View style={s.oppHeadLeft}>
                  <Text style={s.oppAgent}>{op.agent_name}</Text>
                  <Text style={s.oppHoursInline}>
                    ~{op.estimated_hours_saved_per_week} HRS / WEEK SAVED
                  </Text>
                </View>
                <Text style={s.oppProductPill}>{op.product.toUpperCase()}</Text>
              </View>
              <Text style={s.oppHeadline}>{op.headline}</Text>
              <Text style={s.oppWhy}>{op.why}</Text>
              <Text style={s.oppListLabel}>WHAT {op.agent_name.toUpperCase()} DOES</Text>
              {op.what_it_does.map((line, j) => (
                <View key={j} style={s.oppListItem}>
                  <Text style={s.oppListBullet}>·</Text>
                  <Text style={s.oppListText}>{line}</Text>
                </View>
              ))}
            </View>
          ))}

          {/* Closing note from June */}
          <View style={s.closing} wrap={false}>
            <Text style={s.closingLabel}>A NOTE FROM JUNE</Text>
            <Text style={s.closingBody}>&quot;{audit.closing_note}&quot;</Text>
            <Text style={s.closingSignature}>- June  ·  GB2GLLC</Text>
            <Text style={s.closingAnchor}>&quot;Work as for the Lord&quot; · Col. 3:23</Text>
          </View>
        </View>

        {/* Footer (fixed on every page) */}
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
