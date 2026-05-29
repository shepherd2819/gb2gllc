import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-auth";
import { supabaseAdmin } from "@/lib/supabase";
import { sendForSignature } from "@/lib/vera/notify";
import { formatAmount, cadenceLabel, type Cadence } from "@/lib/vera/format";
import { PRODUCT_LABELS, type Product } from "@/lib/vera/product-scopes";

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;
  const { id } = await ctx.params;

  const { data: c } = await supabaseAdmin
    .from("contracts")
    .select("id, status, token, amount_cents, cadence, product, expires_at, clients(id, name, email, company)")
    .eq("id", id)
    .maybeSingle();
  if (!c) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (c.status !== "sent") return NextResponse.json({ error: `Cannot resend (status: ${c.status})` }, { status: 409 });
  if (new Date(c.expires_at as string) < new Date()) return NextResponse.json({ error: "Contract has expired" }, { status: 409 });

  const client = c.clients as unknown as { id: string; name: string | null; email: string; company: string | null };
  if (!client?.email) return NextResponse.json({ error: "Client has no email" }, { status: 400 });

  const signingUrl = `${process.env.NEXT_PUBLIC_BASE_URL ?? "https://gb2gllc.com"}/sign/${c.token}`;

  await sendForSignature(client.email, {
    clientName:       client.name || "there",
    clientCompany:    client.company || client.name || "",
    productLabel:     PRODUCT_LABELS[c.product as Product],
    amountFormatted:  formatAmount(c.amount_cents as number),
    cadenceLabel:     cadenceLabel(c.cadence as Cadence),
    signingUrl,
  });

  return NextResponse.json({ ok: true });
}
