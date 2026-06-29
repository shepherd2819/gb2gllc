// lib/sawyer/render.tsx
import { Document, Page, Text, View, StyleSheet, renderToBuffer } from "@react-pdf/renderer";
import type { Proposal, ProposalSection } from "./types";

const SECTION_ORDER = ["cover", "about", "understanding", "scope", "pricing", "timeline", "terms"];

export function orderedSections(sections: ProposalSection[]): ProposalSection[] {
  return [...sections].sort((a, b) => {
    const ia = SECTION_ORDER.indexOf(a.key);
    const ib = SECTION_ORDER.indexOf(b.key);
    return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
  });
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

const CADENCE_SUFFIX: Record<string, string> = { monthly: "/mo", annual: "/yr", one_time: "" };
function money(amount: number | null, cadence: string): string {
  if (amount == null) return "To confirm";
  return `$${amount.toLocaleString("en-US")}${CADENCE_SUFFIX[cadence] ?? ""}`;
}

function pricingRows(p: Proposal): Array<{ label: string; value: string; note?: string }> {
  if (!p.pricing) return [];
  return p.pricing.items.map((i) => ({ label: i.label, value: money(i.amount, i.cadence), note: i.note }));
}

export function renderProposalHtml(p: Proposal): string {
  const secs = orderedSections(p.sections);
  const body = secs
    .map((s) => `<section><h2>${esc(s.heading)}</h2><div class="body">${esc(s.body).replace(/\n/g, "<br/>")}</div></section>`)
    .join("\n");
  const pricing = p.pricing
    ? `<section class="pricing"><h2>Pricing</h2><table>${pricingRows(p)
        .map((r) => `<tr><td>${esc(r.label)}${r.note ? ` <span class="note">(${esc(r.note)})</span>` : ""}</td><td class="amt">${esc(r.value)}</td></tr>`)
        .join("")}</table>${p.pricing.summary ? `<p class="summary">${esc(p.pricing.summary)}</p>` : ""}</section>`
    : "";
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>${esc(p.title)}</title>
<style>
  :root { --ink:#1a1a1a; --muted:#6b6b6b; --line:#e6e6e6; }
  body { font-family: ui-sans-serif, system-ui, -apple-system, sans-serif; color:var(--ink); max-width:760px; margin:0 auto; padding:48px 24px; line-height:1.6; }
  .brand { font-weight:700; letter-spacing:0.02em; color:var(--ink); }
  h1 { font-size:28px; margin:8px 0 32px; }
  h2 { font-size:18px; margin:32px 0 8px; border-bottom:1px solid var(--line); padding-bottom:6px; }
  .body { white-space:normal; }
  table { width:100%; border-collapse:collapse; margin-top:8px; }
  td { padding:8px 0; border-bottom:1px solid var(--line); }
  .amt { text-align:right; font-variant-numeric:tabular-nums; font-weight:600; }
  .note, .summary, .muted { color:var(--muted); }
  footer { margin-top:48px; color:var(--muted); font-size:13px; }
</style></head>
<body>
  <div class="brand">GB2G — GloryBe2God LLC</div>
  <h1>${esc(p.title)}</h1>
  ${body}
  ${pricing}
  <footer>Prepared by GB2G. Clients keep all code and data. Questions? Reply to the email this was sent with.</footer>
</body></html>`;
}

const pdf = StyleSheet.create({
  page: { padding: 48, fontSize: 11, fontFamily: "Helvetica", color: "#1a1a1a", lineHeight: 1.5 },
  brand: { fontSize: 10, fontFamily: "Helvetica-Bold", marginBottom: 6 },
  title: { fontSize: 20, fontFamily: "Helvetica-Bold", marginBottom: 18 },
  h2: { fontSize: 13, fontFamily: "Helvetica-Bold", marginTop: 16, marginBottom: 4 },
  body: { marginBottom: 4 },
  row: { flexDirection: "row", justifyContent: "space-between", borderBottom: "1px solid #e6e6e6", paddingVertical: 4 },
  amt: { fontFamily: "Helvetica-Bold" },
  footer: { marginTop: 28, fontSize: 9, color: "#6b6b6b" },
});

export async function renderProposalPdf(p: Proposal): Promise<Buffer> {
  const secs = orderedSections(p.sections);
  const doc = (
    <Document>
      <Page size="A4" style={pdf.page}>
        <Text style={pdf.brand}>GB2G — GloryBe2God LLC</Text>
        <Text style={pdf.title}>{p.title}</Text>
        {secs.map((s, i) => (
          <View key={i} wrap={false}>
            <Text style={pdf.h2}>{s.heading}</Text>
            <Text style={pdf.body}>{s.body}</Text>
          </View>
        ))}
        {p.pricing && (
          <View>
            <Text style={pdf.h2}>Pricing</Text>
            {pricingRows(p).map((r, i) => (
              <View key={i} style={pdf.row}>
                <Text>{r.label}{r.note ? ` (${r.note})` : ""}</Text>
                <Text style={pdf.amt}>{r.value}</Text>
              </View>
            ))}
            {p.pricing.summary ? <Text style={pdf.body}>{p.pricing.summary}</Text> : null}
          </View>
        )}
        <Text style={pdf.footer}>Prepared by GB2G. Clients keep all code and data.</Text>
      </Page>
    </Document>
  );
  return renderToBuffer(doc);
}
