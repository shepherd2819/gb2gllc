import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { requireAdmin } from "@/lib/admin-auth";

export async function POST(req: NextRequest) {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;
  const body = await req.json().catch(() => ({} as Record<string, unknown>));
  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name) return NextResponse.json({ error: "Campaign name required" }, { status: 400 });

  const { data, error } = await supabaseAdmin
    .from("avery_campaigns")
    .insert({
      name,
      briefing_text: typeof body.briefing_text === "string" ? body.briefing_text : null,
      sender_email: typeof body.sender_email === "string" ? body.sender_email : "hello@gb2gllc.com",
      sender_name:  typeof body.sender_name  === "string" ? body.sender_name  : "Avery at GB2G",
      daily_send_cap: Math.min(100, Math.max(1, parseInt(String(body.daily_send_cap ?? 20), 10))),
      created_by: guard.user.email,
    })
    .select("*")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ campaign: data }, { status: 201 });
}

export async function GET() {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;
  const { data } = await supabaseAdmin
    .from("avery_campaigns")
    .select("id, name, status, sender_email, daily_send_cap, created_at, updated_at")
    .order("updated_at", { ascending: false });
  return NextResponse.json({ campaigns: data ?? [] });
}
