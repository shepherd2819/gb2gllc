import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

type Params = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, { params }: Params) {
  const { id } = await params;
  const { status } = await req.json();

  if (!["active", "paused", "disabled"].includes(status)) {
    return NextResponse.json({ error: "Invalid status" }, { status: 400 });
  }

  await supabaseAdmin.from("clients").update({ status }).eq("id", id);
  return NextResponse.json({ ok: true });
}
