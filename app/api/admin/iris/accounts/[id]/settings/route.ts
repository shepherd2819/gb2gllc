import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-auth";
import { supabaseAdmin } from "@/lib/supabase";
import { CATEGORIES } from "@/lib/iris/classify";

const VALID = new Set<string>(CATEGORIES);

export async function PUT(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;
  const { id } = await ctx.params;
  const body = await req.json().catch(() => ({}));

  const draft_categories: string[] = Array.isArray(body.draft_categories)
    ? body.draft_categories.filter((c: unknown): c is string => typeof c === "string" && VALID.has(c))
    : ["lead", "support", "internal"];

  const ignore_from_patterns: string[] = Array.isArray(body.ignore_from_patterns)
    ? body.ignore_from_patterns
        .filter((p: unknown): p is string => typeof p === "string")
        .map((p: string) => p.trim())
        .filter((p: string) => p.length > 0)
        .slice(0, 50)
    : [];

  const voice_notes = typeof body.voice_notes === "string" ? body.voice_notes.slice(0, 4000) : null;
  const signature   = typeof body.signature   === "string" ? body.signature.slice(0, 2000) : null;

  const { error } = await supabaseAdmin
    .from("iris_settings")
    .upsert({
      account_id: id,
      draft_categories,
      ignore_from_patterns,
      voice_notes,
      signature,
      updated_at: new Date().toISOString(),
    }, { onConflict: "account_id" });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
