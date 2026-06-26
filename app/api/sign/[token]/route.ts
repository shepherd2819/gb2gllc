import { NextResponse } from "next/server";
import { after } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { logEvent } from "@/lib/logger";
import { loadMasterTemplate, type SubstitutionVars } from "@/lib/vera/template";
import { renderContractPdf } from "@/lib/vera/pdf";
import { uploadContractPdf } from "@/lib/vera/storage";
import { createSignedContractNotionPage } from "@/lib/vera/notion";
import { sendSignedToClient, sendSignedToAdmin, pingSlackOnSign } from "@/lib/vera/notify";
import { formatAmount, cadenceLabel, type Cadence } from "@/lib/vera/format";
import { DEFAULT_SCOPE, PRODUCT_LABELS, type Product } from "@/lib/vera/product-scopes";
import { validateSignBody } from "@/lib/vera/sign-validation";
import { inngest } from "@/lib/inngest/client";
import { ONBOARDING_EVENTS } from "@/lib/onboarding/events";

export async function POST(req: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;

  let rawBody: unknown;
  try { rawBody = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  const validation = validateSignBody(rawBody);
  if (!validation.ok) {
    return NextResponse.json({ error: validation.error }, { status: validation.status });
  }
  const body = validation.body;

  const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || null;
  const ua = req.headers.get("user-agent") || null;
  const now = new Date();

  // Atomic transition: only update if status='sent' AND not expired
  const { data: updated, error: upErr } = await supabaseAdmin
    .from("contracts")
    .update({
      status: "signed",
      signed_at: now.toISOString(),
      signer_name: body.signer_name,
      signer_representing: body.signer_representing,
      signer_ip: ip,
      signer_user_agent: ua,
      updated_at: now.toISOString(),
    })
    .eq("token", token)
    .eq("status", "sent")
    .gt("expires_at", now.toISOString())
    .select("id, client_id, product, amount_cents, cadence, scope_notes, template_version, sent_at, clients(name, email, company)")
    .maybeSingle();

  if (upErr) return NextResponse.json({ error: "Sign failed", detail: upErr.message }, { status: 500 });
  if (!updated) {
    // either token not found, expired, voided, or already signed
    const { data: existing } = await supabaseAdmin.from("contracts").select("status").eq("token", token).maybeSingle();
    if (!existing)                       return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (existing.status === "expired")   return NextResponse.json({ error: "This contract has expired" }, { status: 410 });
    if (existing.status === "voided")    return NextResponse.json({ error: "This contract was voided" }, { status: 410 });
    if (existing.status === "signed")    return NextResponse.json({ error: "Already signed" }, { status: 409 });
    return NextResponse.json({ error: "Not signable" }, { status: 409 });
  }

  // Onboarding: kick off the provisioning pipeline (journey + invite + invoice).
  // Idempotent downstream; failure here must not affect the sign response.
  after(async () => {
    try {
      await inngest.send({
        name: ONBOARDING_EVENTS.CONTRACT_SIGNED,
        data: {
          clientId: updated.client_id as string,
          contractId: updated.id as string,
          product: updated.product as string,
          amountCents: updated.amount_cents as number,
          cadence: updated.cadence as string,
        },
      });
    } catch (err) {
      console.error("[sign] onboarding contract.signed emit failed:", err instanceof Error ? err.message : err);
    }
  });

  // after() — generate countersigned PDF, store, Notion, notifications
  after(async () => {
    try {
      const client = updated.clients as unknown as { name: string | null; email: string; company: string | null };
      const tmpl = await loadMasterTemplate();
      const product = updated.product as Product;
      const cadence = updated.cadence as Cadence;
      const sentAt = updated.sent_at ? new Date(updated.sent_at as string) : now;
      const vars: SubstitutionVars = {
        client_company:       client.company || client.name || client.email,
        product_label:        PRODUCT_LABELS[product],
        scope_paragraph:      (updated.scope_notes as string | null)?.trim() || DEFAULT_SCOPE[product],
        amount_formatted:     formatAmount(updated.amount_cents as number),
        cadence_label:        cadenceLabel(cadence),
        generated_date:       sentAt.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" }),
        signer_name:          body.signer_name,
        signer_representing:  body.signer_representing,
        signed_date:          now.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" }),
      };

      const pdf = await renderContractPdf({ sections: tmpl.sections, vars, signed: true });
      const path = await uploadContractPdf(updated.id as string, "signed", pdf);

      const args = {
        clientName:       client.name || "there",
        clientCompany:    client.company || client.name || "",
        productLabel:     PRODUCT_LABELS[product],
        amountFormatted:  formatAmount(updated.amount_cents as number),
        cadenceLabel:     cadenceLabel(cadence),
        signingUrl:       "", // not needed for post-sign emails
        signerName:       body.signer_name,
      };

      // Best-effort: log on any failure but don't fail the whole batch
      const safelyRun = async (label: string, fn: () => Promise<void>) => {
        try { await fn(); } catch (err) {
          await logEvent({
            clientId: updated.client_id as string, category: "vera", level: "warn",
            message: `signed: ${label} failed`,
            metadata: { contract_id: updated.id, error: err instanceof Error ? err.message : String(err) },
          });
        }
      };

      await supabaseAdmin.from("contracts").update({ signed_pdf_path: path, updated_at: new Date().toISOString() }).eq("id", updated.id);
      await safelyRun("email-client",    () => sendSignedToClient(client.email, args, pdf));
      await safelyRun("email-admin",     () => sendSignedToAdmin(args, pdf));
      await safelyRun("slack",           () => pingSlackOnSign(args));
      await safelyRun("notion", async () => {
        const notionId = await createSignedContractNotionPage({
          contractId:          updated.id as string,
          clientName:          client.name ?? "",
          clientCompany:       client.company ?? client.name ?? "",
          productLabel:        PRODUCT_LABELS[product],
          amountFormatted:     formatAmount(updated.amount_cents as number),
          cadenceLabel:        cadenceLabel(cadence),
          signerName:          body.signer_name,
          signerRepresenting:  body.signer_representing,
          signedAt:            now.toISOString(),
          signedPdfPath:       path,
        });
        await supabaseAdmin.from("contracts").update({ notion_page_id: notionId, updated_at: new Date().toISOString() }).eq("id", updated.id);
      });

      await logEvent({ clientId: updated.client_id as string, category: "vera", message: "contract signed", metadata: { contract_id: updated.id } });
    } catch (err) {
      await logEvent({
        clientId: updated.client_id as string, category: "vera", level: "error",
        message: "post-sign processing failed",
        metadata: { contract_id: updated.id, error: err instanceof Error ? err.message : String(err) },
      });
    }
  });

  return NextResponse.json({ ok: true });
}

// PATCH marks viewed_at (idempotent). The page itself loads via the page.tsx route.
export async function PATCH(_req: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  const now = new Date().toISOString();
  await supabaseAdmin
    .from("contracts")
    .update({ viewed_at: now, updated_at: now })
    .eq("token", token)
    .eq("status", "sent")
    .is("viewed_at", null);
  return NextResponse.json({ ok: true });
}
