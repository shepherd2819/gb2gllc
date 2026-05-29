import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { requireAdmin } from "@/lib/admin-auth";

type Params = { params: Promise<{ id: string }> };
const VALID = new Set(["open", "in_progress", "resolved", "awaiting_review"]);

export async function PATCH(req: NextRequest, { params }: Params) {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;
  const { id } = await params;
  const body = await req.json();
  const next = String(body.status ?? "");
  if (!VALID.has(next)) return NextResponse.json({ error: "invalid status" }, { status: 400 });

  // Preserve resolved_at on non-resolved transitions (don't clobber prior resolutions).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const patch: Record<string, any> = { status: next };
  if (next === "resolved") patch.resolved_at = new Date().toISOString();

  const { error } = await supabaseAdmin.from("tickets").update(patch).eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
