import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { requireAdmin } from "@/lib/admin-auth";

type Params = { params: Promise<{ id: string }> };

export async function PUT(req: NextRequest, { params }: Params) {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;

  const { id } = await params;
  const body = await req.json();

  const norm = (v: unknown): string | null => {
    if (typeof v !== "string") return null;
    const t = v.trim();
    return t.length ? t : null;
  };

  const row = {
    client_id: id,
    website_url:         norm(body.website_url),
    booking_url:         norm(body.booking_url),
    order_url:           norm(body.order_url),
    custom_link_label:   norm(body.custom_link_label),
    custom_link_url:     norm(body.custom_link_url),
    custom_instructions: norm(body.custom_instructions),
    business_hours:      norm(body.business_hours),
    escalation_channel:  norm(body.escalation_channel),
    reply_to_dms:        body.reply_to_dms !== false,
    reply_to_comments:   body.reply_to_comments !== false,
    updated_at:          new Date().toISOString(),
  };

  const { error } = await supabaseAdmin
    .from("client_social_configs")
    .upsert(row, { onConflict: "client_id" });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
