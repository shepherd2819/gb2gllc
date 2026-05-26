import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { requireAdmin } from "@/lib/admin-auth";
import { extractIp } from "@/lib/june/store";

export const dynamic = "force-dynamic";

// POST /api/admin/june/reset
//   body: { ip?: string, attemptId?: string, self?: boolean }
//   self=true deletes the row matching the caller's own IP (handy for repeat testing)
export async function POST(req: NextRequest) {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;

  const body = await req.json().catch(() => ({} as Record<string, unknown>));
  const self = !!body.self;
  const explicitIp = typeof body.ip === "string" ? body.ip.trim() : null;
  const attemptId = typeof body.attemptId === "string" ? body.attemptId : null;

  let q = supabaseAdmin.from("june_demo_attempts").delete();
  if (attemptId) {
    q = q.eq("id", attemptId);
  } else if (self) {
    q = q.eq("ip", extractIp(req));
  } else if (explicitIp) {
    q = q.eq("ip", explicitIp);
  } else {
    return NextResponse.json({ error: "Provide self, ip, or attemptId" }, { status: 400 });
  }

  const { data, error } = await q.select("id");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, deleted: data?.length ?? 0 });
}
