import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-auth";
import { supabaseAdmin } from "@/lib/supabase";
import { logEvent } from "@/lib/logger";

type VoidBody = { reason?: string };

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;
  const { id } = await ctx.params;

  let body: VoidBody = {};
  try { body = await req.json(); } catch { /* empty body is fine */ }

  const { data: c } = await supabaseAdmin
    .from("contracts")
    .select("id, status, client_id")
    .eq("id", id)
    .maybeSingle();
  if (!c) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (c.status === "signed") return NextResponse.json({ error: "Cannot void a signed contract" }, { status: 409 });
  if (c.status === "voided") return NextResponse.json({ error: "Already voided" }, { status: 409 });

  const now = new Date().toISOString();
  const { error } = await supabaseAdmin
    .from("contracts")
    .update({ status: "voided", voided_at: now, voided_reason: body.reason ?? null, updated_at: now })
    .eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await logEvent({ clientId: c.client_id as string, category: "vera", message: "contract voided", metadata: { contract_id: id, reason: body.reason } });
  return NextResponse.json({ ok: true });
}
