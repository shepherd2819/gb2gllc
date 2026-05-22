import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { getWorkOS } from "@workos-inc/authkit-nextjs";

export async function POST(req: NextRequest) {
  try {
    const { email, name, company, products = [] } = await req.json();
    if (!email) return NextResponse.json({ error: "Email required" }, { status: 400 });

    // Create client record
    const { data: client, error: dbErr } = await supabaseAdmin
      .from("clients")
      .insert({ email, name: name || null, company: company || null })
      .select()
      .single();

    if (dbErr) {
      if (dbErr.code === "23505") return NextResponse.json({ error: "A client with that email already exists" }, { status: 409 });
      throw dbErr;
    }

    // Assign products
    if (products.length > 0) {
      await supabaseAdmin.from("client_products").insert(
        products.map((p: string) => ({ client_id: client.id, product: p, active: true }))
      );
    }

    // Send WorkOS invitation
    const workos = getWorkOS();
    await workos.userManagement.sendInvitation({ email });

    return NextResponse.json({ client }, { status: 201 });
  } catch (err) {
    console.error("create client error:", err);
    return NextResponse.json({ error: "Failed to create client" }, { status: 500 });
  }
}
