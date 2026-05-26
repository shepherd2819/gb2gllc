import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { requireAdmin } from "@/lib/admin-auth";

type Params = { params: Promise<{ id: string }> };

const ARRAY_FIELDS = ["content_pillars", "ctas", "hashtags", "banned_words"] as const;

export async function PUT(req: NextRequest, { params }: Params) {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;

  const { id } = await params;
  const body = await req.json();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const row: Record<string, any> = { client_id: id, updated_at: new Date().toISOString() };
  for (const f of ARRAY_FIELDS) {
    if (f in body) row[f] = sanitizeArray(body[f]);
  }
  if ("voice_notes" in body) row.voice_notes = sanitizeText(body.voice_notes);
  if ("posting_cadence" in body) row.posting_cadence = sanitizeText(body.posting_cadence) ?? "weekdays";
  if ("posting_time_local" in body) row.posting_time_local = sanitizeText(body.posting_time_local) ?? "08:30";
  if ("timezone" in body) row.timezone = sanitizeText(body.timezone) ?? "America/Chicago";
  if ("auto_publish" in body) row.auto_publish = !!body.auto_publish;

  const { error } = await supabaseAdmin
    .from("client_linkedin_configs")
    .upsert(row, { onConflict: "client_id" });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

function sanitizeArray(v: unknown): string[] {
  if (Array.isArray(v)) {
    return v.map((x) => String(x).trim()).filter((x) => x.length > 0);
  }
  if (typeof v === "string") {
    return v.split(/[,\n]/).map((x) => x.trim()).filter((x) => x.length > 0);
  }
  return [];
}
function sanitizeText(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t.length ? t : null;
}
