import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { refreshSession } from "@workos-inc/authkit-nextjs";
import { googleInstallUrl } from "@/lib/gmail";
import { HOLT_GOOGLE_SCOPES } from "@/lib/holt/calendar";

const ADMIN_EMAIL = process.env.ADMIN_EMAIL ?? "john@gb2gllc.com";
const ADMIN_URL = process.env.NEXT_PUBLIC_ADMIN_URL ?? "https://admin.gb2gllc.com";
const HOLT_REDIRECT_URI = `${ADMIN_URL}/api/holt/oauth/callback`;

// refreshSession (not withAuth) — /api/* isn't in proxy.ts's matcher.
export async function GET(req: NextRequest) {
  let user;
  try { user = (await refreshSession({ ensureSignedIn: false })).user; }
  catch { user = null; }
  if (!user) return NextResponse.redirect(new URL("/auth/signin?next=/agents/holt", req.url));
  if (user.email !== ADMIN_EMAIL) return NextResponse.redirect(new URL("/auth/no-account", req.url));

  const nonce = randomBytes(16).toString("hex");
  const state = `${user.id}:${nonce}`;
  const url = googleInstallUrl({ state, redirectUri: HOLT_REDIRECT_URI, scopes: HOLT_GOOGLE_SCOPES });

  const res = NextResponse.redirect(url);
  res.cookies.set("holt_install_state", state, {
    httpOnly: true, secure: true, sameSite: "lax", maxAge: 600, path: "/", domain: ".gb2gllc.com",
  });
  return res;
}
