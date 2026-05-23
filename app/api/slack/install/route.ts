import { NextRequest, NextResponse } from "next/server";
import { refreshSession } from "@workos-inc/authkit-nextjs";
import { supabaseAdmin } from "@/lib/supabase";
import { slackInstallUrl } from "@/lib/slack";
import crypto from "node:crypto";

// Client-initiated: the signed-in client clicks "Install Slack" in their portal.
// We stash their client_id in a short-lived state cookie so the callback knows
// who they are. State is also random to prevent CSRF.
export async function GET(req: NextRequest) {
  const { user } = await refreshSession({ ensureSignedIn: false });
  if (!user) return NextResponse.redirect(new URL("/auth/signin?next=/connections", req.url));

  const { data: client } = await supabaseAdmin
    .from("clients")
    .select("id")
    .eq("workos_user_id", user.id)
    .single();

  if (!client) return NextResponse.redirect(new URL("/auth/no-account", req.url));

  const nonce = crypto.randomBytes(16).toString("hex");
  const state = `${client.id}:${nonce}`;
  const url = slackInstallUrl(state);
  const res = NextResponse.redirect(url);
  res.cookies.set("slack_install_state", state, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    maxAge: 600,
    path: "/",
  });
  return res;
}
