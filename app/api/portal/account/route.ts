import { NextRequest, NextResponse } from "next/server";
import { refreshSession } from "@workos-inc/authkit-nextjs";
import { getWorkOS } from "@workos-inc/authkit-nextjs";
import { supabaseAdmin } from "@/lib/supabase";

export async function PATCH(req: NextRequest) {
  const { user } = await refreshSession({ ensureSignedIn: false });
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const { name, company, email, password } = body as {
    name?: string; company?: string; email?: string; password?: string;
  };

  // Update Supabase profile
  const dbUpdates: Record<string, string | null> = {};
  if (name !== undefined) dbUpdates.name = name.trim() || null;
  if (company !== undefined) dbUpdates.company = company.trim() || null;
  if (email !== undefined) dbUpdates.email = email.trim() || null;

  if (Object.keys(dbUpdates).length > 0) {
    const { error } = await supabaseAdmin
      .from("clients")
      .update(dbUpdates)
      .eq("workos_user_id", user.id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Update WorkOS user (email and/or password)
  const workosUpdates: { email?: string; password?: string } = {};
  if (email && email.trim() !== user.email) workosUpdates.email = email.trim();
  if (password) workosUpdates.password = password;

  if (Object.keys(workosUpdates).length > 0) {
    try {
      const workos = getWorkOS();
      await workos.userManagement.updateUser({ userId: user.id, ...workosUpdates });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "WorkOS update failed";
      return NextResponse.json({ error: msg }, { status: 500 });
    }
  }

  return NextResponse.json({ ok: true });
}
