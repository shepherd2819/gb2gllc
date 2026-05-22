import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { withAuth } from "@workos-inc/authkit-nextjs";

type Params = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, { params }: Params) {
  const { id: announcementId } = await params;
  const { user } = await withAuth();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: client } = await supabaseAdmin
    .from("clients")
    .select("id")
    .eq("workos_user_id", user.id)
    .single();

  if (!client) return NextResponse.json({ error: "Client not found" }, { status: 404 });

  await supabaseAdmin
    .from("announcement_dismissals")
    .upsert({ announcement_id: announcementId, client_id: client.id }, { onConflict: "announcement_id,client_id" });

  return NextResponse.json({ ok: true });
}
