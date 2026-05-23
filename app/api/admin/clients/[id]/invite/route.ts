import { NextResponse } from "next/server";
import { getWorkOS } from "@workos-inc/authkit-nextjs";
import { supabaseAdmin } from "@/lib/supabase";
import { requireAdmin } from "@/lib/admin-auth";

type Params = { params: Promise<{ id: string }> };

// POST /api/admin/clients/[id]/invite — send the WorkOS invitation now,
// for clients that were created in draft mode without an email.
export async function POST(_req: Request, { params }: Params) {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;

  const { id } = await params;
  const { data: client } = await supabaseAdmin
    .from("clients").select("id, email").eq("id", id).single();

  if (!client) return NextResponse.json({ error: "Client not found" }, { status: 404 });
  if (!client.email) return NextResponse.json({ error: "Set an email on this client first" }, { status: 400 });

  try {
    const workos = getWorkOS();
    await workos.userManagement.sendInvitation({ email: client.email });
    await supabaseAdmin.from("clients").update({ invited_at: new Date().toISOString() }).eq("id", id);
    return NextResponse.json({ ok: true, email: client.email });
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: reason }, { status: 500 });
  }
}
