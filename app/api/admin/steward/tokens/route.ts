import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

// POST { clientId, platform, tokenData: { api_key: "..." } }
export async function POST(req: NextRequest) {
  const { clientId, platform, tokenData } = await req.json();

  if (!clientId || !platform || !tokenData) {
    return NextResponse.json({ error: "clientId, platform, and tokenData required" }, { status: 400 });
  }

  const { error } = await supabaseAdmin
    .from("steward_platform_tokens")
    .upsert(
      { client_id: clientId, platform, token_data: tokenData },
      { onConflict: "client_id,platform" }
    );

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

// DELETE ?clientId=X&platform=Y
export async function DELETE(req: NextRequest) {
  const clientId = req.nextUrl.searchParams.get("clientId");
  const platform = req.nextUrl.searchParams.get("platform");
  if (!clientId || !platform) return NextResponse.json({ error: "clientId and platform required" }, { status: 400 });

  const { error } = await supabaseAdmin
    .from("steward_platform_tokens")
    .delete()
    .eq("client_id", clientId)
    .eq("platform", platform);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
