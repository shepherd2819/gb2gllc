import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { getWorkOS } from "@workos-inc/authkit-nextjs";
import { requireAdmin } from "@/lib/admin-auth";

export async function POST(req: NextRequest) {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;

  try {
    const { email, name, company, products = [], sendInvite = true } = await req.json();
    const normalizedEmail = email?.trim() || null;

    // Must have at least one of email / name / company to identify the draft
    if (!normalizedEmail && !name?.trim() && !company?.trim()) {
      return NextResponse.json({ error: "Provide at least an email, name, or company" }, { status: 400 });
    }

    // Create client record
    const { data: client, error: dbErr } = await supabaseAdmin
      .from("clients")
      .insert({ email: normalizedEmail, name: name?.trim() || null, company: company?.trim() || null })
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

    // Send WorkOS invitation only if we have an email AND caller wants it
    if (normalizedEmail && sendInvite) {
      try {
        const workos = getWorkOS();
        await workos.userManagement.sendInvitation({ email: normalizedEmail });
        await supabaseAdmin.from("clients").update({ invited_at: new Date().toISOString() }).eq("id", client.id);
      } catch (e) {
        console.warn("WorkOS invitation failed (may already exist):", e);
      }
    }

    return NextResponse.json({ client }, { status: 201 });
  } catch (err) {
    console.error("create client error:", err);
    return NextResponse.json({ error: "Failed to create client" }, { status: 500 });
  }
}
