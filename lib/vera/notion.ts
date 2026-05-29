import { notion } from "@/lib/notion";
import { signedContractPdfUrl } from "./storage";

export type SignedContractArgs = {
  contractId: string;
  clientName: string;
  clientCompany: string;
  productLabel: string;
  amountFormatted: string;
  cadenceLabel: string;
  signerName: string;
  signerRepresenting: string;
  signedAt: string;          // ISO
  signedPdfPath: string;     // storage path
};

export async function createSignedContractNotionPage(a: SignedContractArgs): Promise<string> {
  const dbId = process.env.NOTION_CONTRACTS_DATABASE_ID;
  if (!dbId) throw new Error("NOTION_CONTRACTS_DATABASE_ID not set");

  const pdfUrl = await signedContractPdfUrl(a.signedPdfPath, 60 * 60 * 24 * 7); // 7-day signed URL

  const page = await notion.pages.create({
    parent: { database_id: dbId },
    properties: {
      Name: {
        title: [{ text: { content: `${a.clientCompany} · ${a.productLabel} · ${new Date(a.signedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}` } }],
      },
      Product:        { select: { name: a.productLabel } },
      Amount:         { rich_text: [{ text: { content: `${a.amountFormatted} ${a.cadenceLabel}` } }] },
      Status:         { select: { name: "Signed" } },
      "Signed by":    { rich_text: [{ text: { content: a.signerName } }] },
      "Signed at":    { date: { start: a.signedAt } },
      "Contract ID":  { rich_text: [{ text: { content: a.contractId } }] },
      "Signed PDF":   { files: [{ name: "GB2GLLC-Services-Agreement.pdf", external: { url: pdfUrl } }] },
    },
  });

  return page.id;
}
