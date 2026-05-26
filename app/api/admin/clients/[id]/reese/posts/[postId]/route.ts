import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { requireAdmin } from "@/lib/admin-auth";
import { publishLinkedinTextPost } from "@/lib/linkedin";

type Params = { params: Promise<{ id: string; postId: string }> };

// PATCH /api/admin/clients/[id]/reese/posts/[postId]
//   { action: 'approve_and_publish' }      → posts to LinkedIn now
//   { action: 'reject', reason?: string }  → marks rejected
//   { edited_text: string }                → save edits to the draft
export async function PATCH(req: NextRequest, { params }: Params) {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;

  const { id, postId } = await params;
  const body = await req.json();

  // Load post + verify client match
  const { data: post } = await supabaseAdmin
    .from("linkedin_posts")
    .select("*")
    .eq("id", postId)
    .eq("client_id", id)
    .single();
  if (!post) return NextResponse.json({ error: "Post not found" }, { status: 404 });

  // ── Save edits ────────────────────────────────────────────────────────
  if (typeof body.edited_text === "string") {
    const { error } = await supabaseAdmin
      .from("linkedin_posts")
      .update({ edited_text: body.edited_text.trim(), updated_at: new Date().toISOString() })
      .eq("id", postId);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  }

  // ── Reject ───────────────────────────────────────────────────────────
  if (body.action === "reject") {
    const { error } = await supabaseAdmin
      .from("linkedin_posts")
      .update({
        status: "rejected",
        rejected_reason: typeof body.reason === "string" ? body.reason : null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", postId);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  }

  // ── Approve + publish immediately ────────────────────────────────────
  if (body.action === "approve_and_publish") {
    if (post.status !== "draft" && post.status !== "approved") {
      return NextResponse.json({ error: `Cannot publish a post in '${post.status}' state` }, { status: 400 });
    }

    const { data: tokenRow } = await supabaseAdmin
      .from("steward_platform_tokens")
      .select("token_data")
      .eq("client_id", id)
      .eq("platform", "linkedin")
      .maybeSingle();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const td = tokenRow?.token_data as any | undefined;
    if (!td?.access_token || !td?.member_urn) {
      return NextResponse.json({ error: "LinkedIn not connected for this client" }, { status: 400 });
    }
    // Token freshness check
    if (td.expires_at && new Date(td.expires_at) < new Date()) {
      return NextResponse.json({ error: "LinkedIn token has expired; reconnect required" }, { status: 400 });
    }

    const textToPublish = (post.edited_text ?? post.draft_text).trim();
    const pub = await publishLinkedinTextPost({
      accessToken: td.access_token,
      authorUrn: td.member_urn,
      text: textToPublish,
    });
    if (!pub.ok) {
      await supabaseAdmin
        .from("linkedin_posts")
        .update({ status: "failed", rejected_reason: pub.error, updated_at: new Date().toISOString() })
        .eq("id", postId);
      return NextResponse.json({ error: pub.error }, { status: 500 });
    }

    await supabaseAdmin
      .from("linkedin_posts")
      .update({
        status: "published",
        published_at: new Date().toISOString(),
        posted_as: "member",
        linkedin_urn: pub.urn,
        linkedin_url: pub.url,
        approved_by: guard.user.email,
        approved_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", postId);

    return NextResponse.json({ ok: true, url: pub.url, urn: pub.urn });
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
