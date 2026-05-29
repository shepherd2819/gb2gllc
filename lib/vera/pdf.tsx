import { Document, Page, Text, View, StyleSheet, renderToBuffer } from "@react-pdf/renderer";
import { SECTION_ORDER, SECTION_TITLES, type SectionKey } from "./master-template-defaults";
import { substituteSection, type SubstitutionVars } from "./template";

const styles = StyleSheet.create({
  page:        { padding: 56, fontFamily: "Helvetica", fontSize: 11, lineHeight: 1.5, color: "#1c1c1c" },
  title:       { fontSize: 18, marginBottom: 6, fontFamily: "Helvetica-Bold" },
  effective:   { fontSize: 10, marginBottom: 20, color: "#555" },
  sectionTitle:{ fontSize: 11, marginTop: 14, marginBottom: 4, fontFamily: "Helvetica-Bold" },
  paragraph:   { marginBottom: 6 },
  sigBlock:    { marginTop: 28, borderTopWidth: 1, borderTopColor: "#bbb", paddingTop: 16 },
  sigHeader:   { fontFamily: "Helvetica-Bold", marginBottom: 4 },
  sigLine:     { marginBottom: 2 },
  muted:       { color: "#777" },
});

type Props = {
  sections: Record<SectionKey, string>;
  vars: SubstitutionVars;
  signed: boolean; // true → render typed-signature lines filled in; false → blank lines
};

export function ContractDocument({ sections, vars, signed }: Props) {
  return (
    <Document>
      <Page size="LETTER" style={styles.page}>
        <Text style={styles.title}>GB2GLLC Services Agreement</Text>
        <Text style={styles.effective}>Effective: upon signing by Client</Text>

        <Text style={styles.paragraph}>{substituteSection(sections.preamble, vars)}</Text>

        {SECTION_ORDER.filter((k) => k !== "preamble").map((key) => (
          <View key={key}>
            <Text style={styles.sectionTitle}>{SECTION_TITLES[key]}</Text>
            <Text style={styles.paragraph}>{substituteSection(sections[key], vars)}</Text>
          </View>
        ))}

        <View style={styles.sigBlock}>
          <Text style={styles.sigHeader}>On behalf of GB2GLLC</Text>
          <Text style={styles.sigLine}>John McCully · Founder</Text>
          <Text style={styles.sigLine}>Oberon Analytics LLC d/b/a GB2GLLC</Text>
          <Text style={styles.sigLine}>Date: {vars.generated_date}</Text>
        </View>

        <View style={styles.sigBlock}>
          <Text style={styles.sigHeader}>On behalf of Client</Text>
          <Text style={styles.sigLine}>
            Signature: <Text style={signed ? undefined : styles.muted}>{signed ? vars.signer_name : "_______________________________"}</Text>
          </Text>
          <Text style={styles.sigLine}>
            Representing: <Text style={signed ? undefined : styles.muted}>{signed ? `${vars.signer_representing} on behalf of ${vars.client_company}` : "_______________________________"}</Text>
          </Text>
          <Text style={styles.sigLine}>
            Date: <Text style={signed ? undefined : styles.muted}>{signed ? vars.signed_date : "_______________________________"}</Text>
          </Text>
        </View>
      </Page>
    </Document>
  );
}

export async function renderContractPdf(props: Props): Promise<Buffer> {
  return await renderToBuffer(<ContractDocument {...props} />);
}
