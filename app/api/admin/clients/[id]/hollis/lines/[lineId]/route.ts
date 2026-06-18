import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { requireAdmin } from "@/lib/admin-auth";
import { deletePhoneNumber } from "@/lib/hollis/retell";

type Params = { params: Promise<{ id: string; lineId: string }> };

// PATCH /api/admin/clients/[id]/hollis/lines/[lineId]  body: { action: 'pause'|'resume'|'release' }
export async function PATCH(req: NextRequest, { params }: Params) {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;

  const { id, lineId } = await params;
  const { action } = (await req.json().catch(() => ({}))) as { action?: string };

  const statusByAction: Record<string, "paused" | "active" | "released"> = {
    pause: "paused",
    resume: "active",
    release: "released",
  };
  const status = action ? statusByAction[action] : undefined;
  if (!status) return NextResponse.json({ error: "Invalid action" }, { status: 400 });

  if (action === "release") {
    const { data: line } = await supabaseAdmin
      .from("hollis_lines")
      .select("phone_number")
      .eq("id", lineId)
      .eq("client_id", id)
      .maybeSingle<{ phone_number: string | null }>();
    if (line?.phone_number) {
      try {
        await deletePhoneNumber(line.phone_number);
      } catch (err) {
        console.error("[hollis/lines] Retell number release failed:", err instanceof Error ? err.message : err);
      }
    }
  }

  const { error } = await supabaseAdmin
    .from("hollis_lines")
    .update({ status, updated_at: new Date().toISOString() })
    .eq("id", lineId)
    .eq("client_id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true, status });
}
