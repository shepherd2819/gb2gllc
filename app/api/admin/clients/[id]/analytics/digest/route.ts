// app/api/admin/clients/[id]/analytics/digest/route.ts
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { requireAdmin } from "@/lib/admin-auth";
import { recordEvent } from "@/lib/analytics/store";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export async function PATCH(req: NextRequest, { params }: Params) {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;
  const { id } = await params;

  const body = (await req.json().catch(() => null)) as { enabled?: unknown } | null;
  if (!body || typeof body.enabled !== "boolean") {
    return NextResponse.json({ error: "body must be { enabled: boolean }" }, { status: 400 });
  }

  const { error } = await supabaseAdmin
    .from("clients")
    .update({ analytics_digest_enabled: body.enabled })
    .eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await recordEvent(id, "digest.toggled", guard.user.email, { enabled: body.enabled });
  return NextResponse.json({ ok: true, enabled: body.enabled });
}
