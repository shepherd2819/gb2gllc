import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-auth";
import { supabaseAdmin } from "@/lib/supabase";
import { CATEGORIES_VALID_FOR_URGENT } from "./categories";

export async function PUT(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;
  const { id } = await ctx.params;
  const body = await req.json().catch(() => ({}));

  const dunning_enabled = typeof body.dunning_enabled === "boolean" ? body.dunning_enabled : true;
  const dunning_voice_notes = typeof body.dunning_voice_notes === "string" ? body.dunning_voice_notes.slice(0, 4000) : null;
  const dunning_signature   = typeof body.dunning_signature   === "string" ? body.dunning_signature.slice(0, 2000) : null;
  const urgent_alert_categories: string[] = Array.isArray(body.urgent_alert_categories)
    ? body.urgent_alert_categories.filter((c: unknown): c is string => typeof c === "string" && CATEGORIES_VALID_FOR_URGENT.has(c))
    : ["payment_failed", "charge_disputed", "payout_failed"];
  const delivery_email = typeof body.delivery_email === "string" && body.delivery_email.includes("@") ? body.delivery_email.trim().toLowerCase() : null;
  const weekly_digest_enabled = typeof body.weekly_digest_enabled === "boolean" ? body.weekly_digest_enabled : true;
  const weekly_digest_dow = Number.isInteger(body.weekly_digest_dow) && body.weekly_digest_dow >= 0 && body.weekly_digest_dow <= 6 ? body.weekly_digest_dow : 1;
  const weekly_digest_local_hour = Number.isInteger(body.weekly_digest_local_hour) && body.weekly_digest_local_hour >= 0 && body.weekly_digest_local_hour <= 23 ? body.weekly_digest_local_hour : 8;
  const timezone = typeof body.timezone === "string" && body.timezone.trim() ? body.timezone.trim() : "America/Chicago";
  const monthly_burn_cents = Number.isFinite(body.monthly_burn_cents) && body.monthly_burn_cents > 0 ? Math.round(body.monthly_burn_cents) : null;

  const { error } = await supabaseAdmin.from("nora_settings").upsert({
    account_id: id,
    dunning_enabled, dunning_voice_notes, dunning_signature,
    urgent_alert_categories, delivery_email,
    weekly_digest_enabled, weekly_digest_dow, weekly_digest_local_hour, timezone,
    monthly_burn_cents,
    updated_at: new Date().toISOString(),
  }, { onConflict: "account_id" });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
