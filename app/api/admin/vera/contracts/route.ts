import { NextResponse } from "next/server";
import { after } from "next/server";
import { requireAdmin } from "@/lib/admin-auth";
import { supabaseAdmin } from "@/lib/supabase";
import { logEvent } from "@/lib/logger";
import { mintToken } from "@/lib/vera/tokens";
import { loadMasterTemplate, type SubstitutionVars } from "@/lib/vera/template";
import { renderContractPdf } from "@/lib/vera/pdf";
import { uploadContractPdf } from "@/lib/vera/storage";
import { sendForSignature } from "@/lib/vera/notify";
import { formatAmount, cadenceLabel, type Cadence } from "@/lib/vera/format";
import { DEFAULT_SCOPE, PRODUCT_LABELS, type Product } from "@/lib/vera/product-scopes";

type CreateBody = {
  client_id: string;
  product: Product;
  amount_cents: number;
  cadence: Cadence;
  scope_notes?: string;
};

export async function POST(req: Request) {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;

  let body: CreateBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!body.client_id || !body.product || typeof body.amount_cents !== "number" || !body.cadence) {
    return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
  }
  if (!Number.isInteger(body.amount_cents) || body.amount_cents <= 0) {
    return NextResponse.json({ error: "Amount must be a positive whole number of cents" }, { status: 400 });
  }
  if (!["herald", "atrium", "steward", "custom"].includes(body.product)) {
    return NextResponse.json({ error: "Invalid product" }, { status: 400 });
  }
  if (!["monthly", "one_time", "hourly"].includes(body.cadence)) {
    return NextResponse.json({ error: "Invalid cadence" }, { status: 400 });
  }

  const { data: client, error: clientErr } = await supabaseAdmin
    .from("clients")
    .select("id, name, email, company")
    .eq("id", body.client_id)
    .single();
  if (clientErr || !client) return NextResponse.json({ error: "Client not found" }, { status: 404 });
  if (!client.email) return NextResponse.json({ error: "Client has no email on file" }, { status: 400 });

  const token = mintToken();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000);

  const { data: inserted, error: insertErr } = await supabaseAdmin
    .from("contracts")
    .insert({
      client_id:     body.client_id,
      product:       body.product,
      amount_cents:  body.amount_cents,
      cadence:       body.cadence,
      scope_notes:   body.scope_notes || null,
      token,
      expires_at:    expiresAt.toISOString(),
      status:        "draft",
    })
    .select("id")
    .single();
  if (insertErr || !inserted) return NextResponse.json({ error: "Insert failed", detail: insertErr?.message }, { status: 500 });

  const contractId = inserted.id;

  try {
    const tmpl = await loadMasterTemplate();
    const vars: SubstitutionVars = {
      client_company:    client.company || client.name || client.email,
      product_label:     PRODUCT_LABELS[body.product],
      scope_paragraph:   body.scope_notes?.trim() || DEFAULT_SCOPE[body.product],
      amount_formatted:  formatAmount(body.amount_cents),
      cadence_label:     cadenceLabel(body.cadence),
      generated_date:    now.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" }),
      signer_name:       "",
      signer_representing: "",
      signed_date:       "",
    };

    const pdf = await renderContractPdf({ sections: tmpl.sections, vars, signed: false });
    const path = await uploadContractPdf(contractId, "unsigned", pdf);
    const signingUrl = `${process.env.NEXT_PUBLIC_BASE_URL ?? "https://gb2gllc.com"}/sign/${token}`;

    await sendForSignature(client.email, {
      clientName:       client.name || "there",
      clientCompany:    client.company || client.name || "",
      productLabel:     PRODUCT_LABELS[body.product],
      amountFormatted:  formatAmount(body.amount_cents),
      cadenceLabel:     cadenceLabel(body.cadence),
      signingUrl,
    });

    await supabaseAdmin
      .from("contracts")
      .update({
        status: "sent",
        sent_at: now.toISOString(),
        unsigned_pdf_path: path,
        template_version: tmpl.version,
        updated_at: now.toISOString(),
      })
      .eq("id", contractId);

    after(() => logEvent({ clientId: body.client_id, category: "vera", message: "contract sent", metadata: { contract_id: contractId, product: body.product } }));

    return NextResponse.json({ id: contractId, status: "sent", signing_url: signingUrl });
  } catch (err) {
    await supabaseAdmin.from("contracts").update({ status: "draft", updated_at: new Date().toISOString() }).eq("id", contractId);
    await logEvent({
      clientId: body.client_id, category: "vera", level: "error",
      message: "contract generation failed",
      metadata: { contract_id: contractId, error: err instanceof Error ? err.message : String(err) },
    });
    return NextResponse.json({ error: "Generation failed", detail: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
