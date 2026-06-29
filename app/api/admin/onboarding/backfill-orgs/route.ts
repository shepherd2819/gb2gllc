import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { requireAdmin } from "@/lib/admin-auth";
import { ensureWorkosOrg } from "@/lib/onboarding/provision";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// POST /api/admin/onboarding/backfill-orgs
// One-time (re-runnable) backfill: create a WorkOS Organization for every client
// that predates workos_org_id. Idempotent — ensureWorkosOrg skips clients that
// already have an org. Processes a bounded batch per call; re-run until 0 remain.
export async function POST() {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;

  const { data: clients } = await supabaseAdmin
    .from("clients")
    .select("id")
    .is("workos_org_id", null)
    .limit(50);

  const ids = (clients ?? []).map((c) => c.id as string);
  let created = 0;
  let failed = 0;
  for (const id of ids) {
    const orgId = await ensureWorkosOrg(id);
    if (orgId) created++;
    else failed++;
  }

  return NextResponse.json({ ok: true, processed: ids.length, created, failed, remaining_hint: ids.length === 50 ? "run again" : "done" });
}
