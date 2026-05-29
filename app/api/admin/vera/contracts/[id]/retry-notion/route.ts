import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-auth";
import { supabaseAdmin } from "@/lib/supabase";
import { createSignedContractNotionPage } from "@/lib/vera/notion";
import { PRODUCT_LABELS, type Product } from "@/lib/vera/product-scopes";
import { formatAmount, cadenceLabel, type Cadence } from "@/lib/vera/format";

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;
  const { id } = await ctx.params;

  const { data: c } = await supabaseAdmin
    .from("contracts")
    .select("id, status, product, amount_cents, cadence, signer_name, signer_representing, signed_at, signed_pdf_path, clients(name, company)")
    .eq("id", id)
    .maybeSingle();
  if (!c || c.status !== "signed" || !c.signed_pdf_path) {
    return NextResponse.json({ error: "Contract is not in a signed state with a PDF" }, { status: 409 });
  }
  const client = c.clients as unknown as { name: string | null; company: string | null };

  const notionId = await createSignedContractNotionPage({
    contractId:          c.id as string,
    clientName:          client?.name ?? "",
    clientCompany:       client?.company ?? client?.name ?? "",
    productLabel:        PRODUCT_LABELS[c.product as Product],
    amountFormatted:     formatAmount(c.amount_cents as number),
    cadenceLabel:        cadenceLabel(c.cadence as Cadence),
    signerName:          (c.signer_name as string) ?? "",
    signerRepresenting:  (c.signer_representing as string) ?? "",
    signedAt:            (c.signed_at as string) ?? new Date().toISOString(),
    signedPdfPath:       c.signed_pdf_path as string,
  });

  await supabaseAdmin.from("contracts").update({ notion_page_id: notionId, updated_at: new Date().toISOString() }).eq("id", id);
  return NextResponse.json({ notion_page_id: notionId });
}
