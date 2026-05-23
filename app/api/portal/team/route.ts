import { NextRequest, NextResponse } from "next/server";
import { refreshSession, getWorkOS } from "@workos-inc/authkit-nextjs";
import { supabaseAdmin } from "@/lib/supabase";
import { isClientOwner } from "@/lib/portal-auth";

const MAX_TEAMMATES = 1;

export async function POST(req: NextRequest) {
  const { user } = await refreshSession({ ensureSignedIn: false });
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { email } = await req.json();
  const normalized = (email ?? "").trim().toLowerCase();
  if (!normalized || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(normalized)) {
    return NextResponse.json({ error: "Valid email required" }, { status: 400 });
  }

  // Find the client this user owns (only owners can invite)
  const { data: client } = await supabaseAdmin
    .from("clients")
    .select("id, email, company")
    .eq("workos_user_id", user.id)
    .single();
  if (!client) {
    return NextResponse.json({ error: "Only the account owner can invite teammates" }, { status: 403 });
  }

  // Can't invite yourself
  if (normalized === client.email?.toLowerCase()) {
    return NextResponse.json({ error: "That email is already the account owner" }, { status: 400 });
  }

  // Enforce cap
  const { count: existingCount } = await supabaseAdmin
    .from("client_members")
    .select("id", { count: "exact", head: true })
    .eq("client_id", client.id);
  if ((existingCount ?? 0) >= MAX_TEAMMATES) {
    return NextResponse.json({ error: `You can invite at most ${MAX_TEAMMATES} teammate.` }, { status: 400 });
  }

  // Check duplicate
  const { data: existing } = await supabaseAdmin
    .from("client_members")
    .select("id")
    .eq("client_id", client.id)
    .ilike("email", normalized)
    .maybeSingle();
  if (existing) {
    return NextResponse.json({ error: "That teammate has already been invited" }, { status: 409 });
  }

  // Insert member row
  const { data: member, error: insertErr } = await supabaseAdmin
    .from("client_members")
    .insert({
      client_id: client.id,
      email: normalized,
      invited_by: client.id,
    })
    .select("id, email, invited_at, joined_at")
    .single();
  if (insertErr) {
    return NextResponse.json({ error: insertErr.message }, { status: 500 });
  }

  // Send WorkOS invitation (best-effort; safe if user already exists)
  try {
    const workos = getWorkOS();
    await workos.userManagement.sendInvitation({ email: normalized });
  } catch (e) {
    console.warn("[team invite] WorkOS invitation failed (may already exist):", e);
  }

  return NextResponse.json({ member }, { status: 201 });
}

export async function DELETE(req: NextRequest) {
  const { user } = await refreshSession({ ensureSignedIn: false });
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const memberId = req.nextUrl.searchParams.get("memberId");
  if (!memberId) return NextResponse.json({ error: "memberId required" }, { status: 400 });

  // Verify the user owns the client this member belongs to
  const { data: member } = await supabaseAdmin
    .from("client_members")
    .select("id, client_id")
    .eq("id", memberId)
    .single();
  if (!member) return NextResponse.json({ error: "Member not found" }, { status: 404 });

  const owns = await isClientOwner(user.id, member.client_id);
  if (!owns) return NextResponse.json({ error: "Only the account owner can remove teammates" }, { status: 403 });

  await supabaseAdmin.from("client_members").delete().eq("id", memberId);
  return NextResponse.json({ ok: true });
}
