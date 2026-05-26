import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { requireAdmin } from "@/lib/admin-auth";
import { draftLinkedinPost } from "@/lib/reese";

type Params = { params: Promise<{ id: string }> };

// POST /api/admin/clients/[id]/reese/draft  body: { pillar?: string }
// Generates a new draft and stores it with status='draft' for admin review.
export async function POST(req: NextRequest, { params }: Params) {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;

  const { id } = await params;
  const body = await req.json().catch(() => ({} as { pillar?: string }));
  const result = await draftLinkedinPost({ clientId: id, pillar: body.pillar });

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }

  const { data: row, error } = await supabaseAdmin
    .from("linkedin_posts")
    .insert({
      client_id: id,
      pillar: result.pillar,
      draft_text: result.text,
      status: "draft",
      draft_model: result.model,
      draft_tokens: result.tokens,
    })
    .select("*")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ post: row });
}
