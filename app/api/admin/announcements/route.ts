import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { requireAdmin } from "@/lib/admin-auth";

export async function POST(req: NextRequest) {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;

  const { client_id, title, body, type } = await req.json();
  if (!title) return NextResponse.json({ error: "Title required" }, { status: 400 });

  const { data, error } = await supabaseAdmin
    .from("announcements")
    .insert({ client_id: client_id || null, title, body: body || null, type: type || "info" })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ announcement: data }, { status: 201 });
}
