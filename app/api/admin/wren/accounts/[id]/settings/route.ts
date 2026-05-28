import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { requireAdmin } from "@/lib/admin-auth";

type Params = { params: Promise<{ id: string }> };

const ARRAY_FIELDS = ["draft_categories", "ignore_from_patterns"] as const;
const TEXT_FIELDS  = ["voice_notes", "signature"] as const;

export async function GET(_req: NextRequest, { params }: Params) {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;
  const { id } = await params;
  const { data, error } = await supabaseAdmin
    .from("wren_settings")
    .select("*")
    .eq("account_id", id)
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ settings: data ?? null });
}

export async function PATCH(req: NextRequest, { params }: Params) {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;
  const { id } = await params;
  const body = await req.json();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const row: Record<string, any> = { account_id: id, updated_at: new Date().toISOString() };
  for (const f of ARRAY_FIELDS) if (f in body) row[f] = sanitizeArray(body[f]);
  for (const f of TEXT_FIELDS)  if (f in body) row[f] = sanitizeText(body[f]);

  const { error } = await supabaseAdmin
    .from("wren_settings")
    .upsert(row, { onConflict: "account_id" });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

function sanitizeArray(v: unknown): string[] {
  if (Array.isArray(v)) return v.map((x) => String(x).trim()).filter((x) => x.length > 0);
  if (typeof v === "string") return v.split(/[,\n]/).map((x) => x.trim()).filter((x) => x.length > 0);
  return [];
}
function sanitizeText(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t.length ? t : null;
}
