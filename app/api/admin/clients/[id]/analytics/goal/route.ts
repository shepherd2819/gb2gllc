// app/api/admin/clients/[id]/analytics/goal/route.ts
import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-auth";
import { validateGoalPatch } from "@/lib/analytics/goal";
import { setClientGoal, recordEvent } from "@/lib/analytics/store";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export async function PATCH(req: NextRequest, { params }: Params) {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;
  const { id } = await params;

  const body = await req.json().catch(() => null);
  const parsed = validateGoalPatch(body);
  if (!parsed.ok) return NextResponse.json({ error: parsed.reason }, { status: 400 });

  try {
    // setClientGoal upserts goal_json only, preserving payload/insights/briefing.
    await setClientGoal(id, { revenue: parsed.value.revenue });
    await recordEvent(id, "goal.set", guard.user.email, { revenue: parsed.value.revenue });
    return NextResponse.json({ ok: true, goal: { revenue: parsed.value.revenue } });
  } catch (err) {
    console.error("[analytics/goal]", err);
    return NextResponse.json({ error: "Failed to save goal" }, { status: 500 });
  }
}
