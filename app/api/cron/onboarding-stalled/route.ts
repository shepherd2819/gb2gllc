import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { logEvent } from "@/lib/logger";
import { emitEvent } from "@/lib/onboarding/audit";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Daily sweep: flag journeys past their time-to-value target that haven't
// reached an end state, so the admin (and concierge) can intervene.
export async function GET(req: Request) {
  if (req.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const now = new Date().toISOString();
  const { data: stuck } = await supabaseAdmin
    .from("onboarding_journeys")
    .select("id, client_id, stage")
    .lt("ttv_target_at", now)
    .not("stage", "in", "(complete,adopted,stalled)");

  let flagged = 0;
  for (const j of (stuck ?? []) as { id: string; client_id: string; stage: string }[]) {
    await supabaseAdmin.from("onboarding_journeys").update({ stage: "stalled", updated_at: now }).eq("id", j.id);
    await emitEvent({ journeyId: j.id, clientId: j.client_id, kind: "stage_changed", payload: { from: j.stage, to: "stalled", reason: "ttv_passed" } });
    await logEvent({ clientId: j.client_id, category: "onboarding", level: "warn", message: "onboarding stalled — TTV target passed", metadata: { journeyId: j.id } });
    flagged++;
  }

  return NextResponse.json({ ok: true, stalled: flagged });
}
