import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-auth";
import { nightlyReconcile, maybeSendWeeklyDigest } from "@/lib/nora/orchestrate";
import { fetchMetrics } from "@/lib/nora/stripe";
import { getStripeSecretOrThrow } from "@/lib/nora/env";
import { supabaseAdmin } from "@/lib/supabase";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;
  const { id } = await ctx.params;
  const url = new URL(req.url);
  const doDigest = url.searchParams.get("digest") === "1";

  const recon = await nightlyReconcile(id);

  // Refresh metrics
  try {
    const m = await fetchMetrics(getStripeSecretOrThrow());
    await supabaseAdmin.from("nora_accounts").update({ last_metrics_json: m, last_metrics_at: new Date().toISOString() }).eq("id", id);
  } catch { /* surfaced via last_poll_error */ }

  let digestResult: { sent: boolean; reason?: string } | null = null;
  if (doDigest) digestResult = await maybeSendWeeklyDigest(id, { force: true });

  return NextResponse.json({ ok: true, reconcile: recon, digest: digestResult });
}
