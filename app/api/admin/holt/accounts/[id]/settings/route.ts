import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-auth";
import { supabaseAdmin } from "@/lib/supabase";

export async function PUT(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;
  const { id } = await ctx.params;
  const body = await req.json().catch(() => ({}));

  const internal_domains: string[] = Array.isArray(body.internal_domains)
    ? body.internal_domains
        .filter((d: unknown): d is string => typeof d === "string")
        .map((d: string) => d.trim().toLowerCase().replace(/^@/, ""))
        .filter((d: string) => d.length > 0)
        .slice(0, 20)
    : [];
  const evening_digest_enabled = typeof body.evening_digest_enabled === "boolean" ? body.evening_digest_enabled : true;
  const evening_digest_local_hour = Number.isInteger(body.evening_digest_local_hour) && body.evening_digest_local_hour >= 0 && body.evening_digest_local_hour <= 23
    ? body.evening_digest_local_hour : 21;
  const prebrief_minutes_before = Number.isInteger(body.prebrief_minutes_before) && body.prebrief_minutes_before >= 15 && body.prebrief_minutes_before <= 720
    ? body.prebrief_minutes_before : 120;
  const enable_web_research = typeof body.enable_web_research === "boolean" ? body.enable_web_research : true;
  const voice_notes = typeof body.voice_notes === "string" ? body.voice_notes.slice(0, 4000) : null;
  const delivery_email = typeof body.delivery_email === "string" && body.delivery_email.includes("@") ? body.delivery_email.trim().toLowerCase() : null;

  const { error } = await supabaseAdmin
    .from("holt_settings")
    .upsert({
      account_id: id,
      internal_domains, evening_digest_enabled, evening_digest_local_hour,
      prebrief_minutes_before, enable_web_research, voice_notes, delivery_email,
      updated_at: new Date().toISOString(),
    }, { onConflict: "account_id" });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
