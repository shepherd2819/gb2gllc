import { NextRequest, NextResponse } from "next/server";
import { refreshSession } from "@workos-inc/authkit-nextjs";
import { supabaseAdmin } from "@/lib/supabase";
import { linkedinInstallUrl } from "@/lib/linkedin";
import crypto from "node:crypto";

const ADMIN_EMAIL = process.env.ADMIN_EMAIL ?? "john@gb2gllc.com";
const HOME_URL = process.env.NEXT_PUBLIC_HOME_URL ?? "https://home.gb2gllc.com";
const ADMIN_URL = process.env.NEXT_PUBLIC_ADMIN_URL ?? "https://admin.gb2gllc.com";

// Same install pattern as Slack + Meta: admin can pass ?clientId=<uuid> to
// install on behalf of any client; otherwise we use the signed-in client's
// own session.
export async function GET(req: NextRequest) {
  const { user } = await refreshSession({ ensureSignedIn: false });
  if (!user) return NextResponse.redirect(new URL("/auth/signin?next=/connections", req.url));

  const requestedClientId = req.nextUrl.searchParams.get("clientId");
  let clientId: string | null = null;
  let mode: "client" | "admin" = "client";

  if (requestedClientId && user.email === ADMIN_EMAIL) {
    const { data: client } = await supabaseAdmin
      .from("clients").select("id").eq("id", requestedClientId).maybeSingle();
    if (!client) return NextResponse.redirect(`${ADMIN_URL}/clients?linkedin_install=client_not_found`);
    clientId = client.id;
    mode = "admin";
  } else {
    const { data: owner } = await supabaseAdmin
      .from("clients").select("id").eq("workos_user_id", user.id).maybeSingle();
    if (owner) {
      clientId = owner.id;
    } else {
      const { data: member } = await supabaseAdmin
        .from("client_members").select("client_id").eq("workos_user_id", user.id).maybeSingle();
      clientId = member?.client_id ?? null;
    }
    if (!clientId) return NextResponse.redirect(`${HOME_URL}/auth/no-account`);
  }

  const nonce = crypto.randomBytes(16).toString("hex");
  const state = `${clientId}:${nonce}:${mode}`;
  const url = linkedinInstallUrl(state);

  const res = NextResponse.redirect(url);
  res.cookies.set("linkedin_install_state", state, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    maxAge: 600,
    path: "/",
    domain: ".gb2gllc.com",
  });
  return res;
}
