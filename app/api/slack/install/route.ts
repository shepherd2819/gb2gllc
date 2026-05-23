import { NextRequest, NextResponse } from "next/server";
import { refreshSession } from "@workos-inc/authkit-nextjs";
import { supabaseAdmin } from "@/lib/supabase";
import { slackInstallUrl } from "@/lib/slack";
import crypto from "node:crypto";

const ADMIN_EMAIL = process.env.ADMIN_EMAIL ?? "john@gb2gllc.com";
const HOME_URL = process.env.NEXT_PUBLIC_HOME_URL ?? "https://home.gb2gllc.com";
const ADMIN_URL = process.env.NEXT_PUBLIC_ADMIN_URL ?? "https://admin.gb2gllc.com";

// Two install paths:
//   1. Client self-install: signed-in client clicks "Install Slack" in their portal.
//      No query params needed; we use their session.
//   2. Admin install-on-behalf-of: admin passes ?clientId=<uuid> to install Slack
//      into ANY workspace the admin can sign into, with the resulting bot token
//      stored under that client. Useful when the client hasn't set up their portal
//      account yet but their Slack workspace is ready.
export async function GET(req: NextRequest) {
  const { user } = await refreshSession({ ensureSignedIn: false });
  if (!user) return NextResponse.redirect(new URL("/auth/signin?next=/connections", req.url));

  const requestedClientId = req.nextUrl.searchParams.get("clientId");
  let clientId: string | null = null;
  let mode: "client" | "admin" = "client";

  if (requestedClientId && user.email === ADMIN_EMAIL) {
    // Admin path: verify the client exists, then use it.
    const { data: client } = await supabaseAdmin
      .from("clients")
      .select("id")
      .eq("id", requestedClientId)
      .maybeSingle();
    if (!client) {
      return NextResponse.redirect(`${ADMIN_URL}/clients?slack_install=client_not_found`);
    }
    clientId = client.id;
    mode = "admin";
  } else {
    // Client path: find the client this user owns or is a member of.
    const { data: owner } = await supabaseAdmin
      .from("clients")
      .select("id")
      .eq("workos_user_id", user.id)
      .maybeSingle();
    if (owner) {
      clientId = owner.id;
    } else {
      const { data: member } = await supabaseAdmin
        .from("client_members")
        .select("client_id")
        .eq("workos_user_id", user.id)
        .maybeSingle();
      clientId = member?.client_id ?? null;
    }
    if (!clientId) return NextResponse.redirect(`${HOME_URL}/auth/no-account`);
  }

  const nonce = crypto.randomBytes(16).toString("hex");
  const state = `${clientId}:${nonce}:${mode}`;
  const url = slackInstallUrl(state);
  const res = NextResponse.redirect(url);

  // Use a parent-domain cookie so the callback on admin.gb2gllc.com can read it
  // even when the install was initiated from home.gb2gllc.com.
  res.cookies.set("slack_install_state", state, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    maxAge: 600,
    path: "/",
    domain: ".gb2gllc.com",
  });
  return res;
}
