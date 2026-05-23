import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { requireAdmin } from "@/lib/admin-auth";

type Params = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, { params }: Params) {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;

  const { id } = await params;
  const { product, active } = await req.json();

  if (active) {
    await supabaseAdmin.from("client_products").upsert(
      { client_id: id, product, active: true },
      { onConflict: "client_id,product" }
    );
  } else {
    await supabaseAdmin.from("client_products")
      .update({ active: false })
      .eq("client_id", id)
      .eq("product", product);
  }

  return NextResponse.json({ ok: true });
}
