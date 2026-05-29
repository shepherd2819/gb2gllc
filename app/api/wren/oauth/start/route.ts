import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { withAuth } from "@workos-inc/authkit-nextjs";
import { googleInstallUrl } from "@/lib/gmail";
import { WREN_REDIRECT_URI } from "@/lib/wren/oauth-config";

const ADMIN_EMAIL = process.env.ADMIN_EMAIL ?? "john@gb2gllc.com";

// GET /api/wren/oauth/start
// Admin clicks "Connect mailbox" → generate state nonce, set cookie, redirect to Google.
export async function GET(_req: NextRequest) {
  const { user } = await withAuth();
  if (!user) return NextResponse.redirect(new URL("/auth/signin?next=/agents/wren", _req.url));
  if (user.email !== ADMIN_EMAIL) return NextResponse.redirect(new URL("/auth/no-account", _req.url));

  const nonce = randomBytes(16).toString("hex");
  const state = `${user.id}:${nonce}`;
  const url = googleInstallUrl({ state, redirectUri: WREN_REDIRECT_URI });

  const res = NextResponse.redirect(url);
  res.cookies.set("wren_install_state", state, {
    httpOnly: true, secure: true, sameSite: "lax", maxAge: 600, path: "/", domain: ".gb2gllc.com",
  });
  return res;
}
